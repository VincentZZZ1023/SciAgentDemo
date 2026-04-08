from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import traceback
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from app.core.run_config import get_default_run_config
from app.models.schemas import AgentId, ArtifactRef, EventKind, RunConfig, Severity
from app.services.approval_manager import approval_manager
from app.services.runner import build_event, fake_runner
from app.services.runtime_config_builder import (
    ResearchAgentRuntime,
    ResearchAgentRuntimeConfigBuilder,
)
from app.store import store

logger = logging.getLogger(__name__)


def _safe_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _artifact_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "application/json"
    if suffix in {".md", ".markdown"}:
        return "text/markdown"
    if suffix in {".log", ".txt"}:
        return "text/plain"
    return "text/plain"


class ResearchAgentExecutionError(RuntimeError):
    def __init__(self, stage: str, message: str, *, log_path: Path | None = None) -> None:
        super().__init__(message)
        self.stage = stage
        self.log_path = log_path


class ResearchAgentPipelineRunner:
    def __init__(self) -> None:
        self._runtime_builder = ResearchAgentRuntimeConfigBuilder()

    @staticmethod
    def _load_run_config(raw_config: object) -> RunConfig:
        if isinstance(raw_config, dict):
            try:
                return RunConfig.model_validate(raw_config)
            except Exception:
                logger.warning("Failed to parse run config; falling back to default")
        return get_default_run_config()

    @staticmethod
    def _module_runtime(
        *,
        module: AgentId,
        run_config: RunConfig,
        actual_model: str,
    ) -> SimpleNamespace:
        cfg = run_config.modules[module.value]
        requested_model = cfg.model.strip() if isinstance(cfg.model, str) and cfg.model.strip() else actual_model
        return SimpleNamespace(
            module=module.value,
            enabled=bool(cfg.enabled),
            require_human=bool(cfg.requireHuman),
            requested_model=requested_model,
            resolved_model=actual_model,
            model_fallback_used=requested_model != actual_model,
        )

    @staticmethod
    def _topic_payload_text(topic: dict[str, Any]) -> str:
        title = _safe_text(topic.get("title") or topic.get("name"))
        description = _safe_text(topic.get("description"))
        objective = _safe_text(topic.get("objective"))
        lines = [title]
        if description:
            lines.append(f"Description: {description}")
        if objective:
            lines.append(f"Objective: {objective}")
        return "\n".join(line for line in lines if line)

    async def _run_command(
        self,
        *,
        args: list[str],
        cwd: Path,
        env: dict[str, str],
        log_path: Path,
    ) -> subprocess.CompletedProcess[str]:
        log_path.parent.mkdir(parents=True, exist_ok=True)

        def _invoke() -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                args,
                cwd=str(cwd),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

        try:
            result = await asyncio.to_thread(_invoke)
        except Exception:
            log_path.write_text(traceback.format_exc(), encoding="utf-8")
            raise
        combined = ((result.stdout or "") + ("\n" if result.stdout and result.stderr else "") + (result.stderr or "")).strip()
        log_path.write_text(combined, encoding="utf-8")
        return result

    async def _emit_event(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        summary: str,
        severity: Severity = Severity.info,
        payload: dict[str, Any] | None = None,
    ) -> None:
        await fake_runner._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                kind=EventKind.event_emitted,
                severity=severity,
                summary=summary,
                payload=payload,
                trace_id=trace_id,
            )
        )

    async def _register_artifact(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        path: Path,
        handoff_to: str | None = None,
        artifact_role: str | None = None,
        emit_event: bool = True,
        summary: str | None = None,
    ) -> ArtifactRef:
        content_type = _artifact_content_type(path)
        raw = path.read_text(encoding="utf-8")
        content: str | dict[str, Any]
        if content_type == "application/json":
            try:
                content = json.loads(raw)
            except json.JSONDecodeError:
                content = raw
        else:
            content = raw

        artifact = await fake_runner._create_artifact(
            topic_id=topic_id,
            run_id=run_id,
            name=path.name,
            content_type=content_type,
            content=content,
        )

        if emit_event:
            payload: dict[str, Any] = {}
            if handoff_to:
                payload["handoffTo"] = handoff_to
            if artifact_role:
                payload["artifactRole"] = artifact_role
            await fake_runner._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=agent_id,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary=summary or f"{agent_id.value} produced {path.name}",
                    payload=payload or None,
                    artifacts=[artifact],
                    trace_id=trace_id,
                )
            )

        return artifact

    async def _emit_stage_skipped(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: SimpleNamespace,
        reason: str,
    ) -> None:
        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId(module_runtime.module),
            status="completed",
            progress=1.0,
            summary=f"{module_runtime.module} skipped",
            trace_id=trace_id,
        )
        await fake_runner._emit_module_skipped(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            reason=reason,
        )

    async def _await_approval_if_needed(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: SimpleNamespace,
        artifact_name: str,
    ) -> bool:
        decision = await fake_runner._wait_if_human_required(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            summary=f"{module_runtime.module} is ready to start",
            artifact_name=artifact_name,
        )
        if decision.approved:
            return True
        await self._emit_stage_skipped(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            reason=decision.note or "Not approved",
        )
        return False

    async def _run_survey_stage(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        runtime: ResearchAgentRuntime,
        run_config: RunConfig,
    ) -> list[str]:
        module_runtime = self._module_runtime(
            module=AgentId.review,
            run_config=run_config,
            actual_model=runtime.survey_model,
        )

        if not module_runtime.enabled:
            await self._emit_stage_skipped(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                module_runtime=module_runtime,
                reason="Disabled in run config",
            )
            return []

        if not await self._await_approval_if_needed(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            artifact_name="survey.md",
        ):
            return []

        await store.update_run_runtime(
            run_id,
            topic_id=topic_id,
            current_module=module_runtime.module,
        )
        await fake_runner._emit_module_started(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            run_config=run_config,
        )
        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.review,
            status="running",
            progress=0.1,
            summary="review running",
            trace_id=trace_id,
        )
        await self._emit_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.review,
            trace_id=trace_id,
            summary="launching survey agent",
            payload={"stage": "review", "topic": runtime.topic_text},
        )

        env = os.environ.copy()
        env["PYTHONPATH"] = (
            str(runtime.research_agent_root)
            if not env.get("PYTHONPATH")
            else f"{runtime.research_agent_root}{os.pathsep}{env['PYTHONPATH']}"
        )
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env["MINERU_MODEL_SOURCE"] = "modelscope"
        for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
            env.pop(key, None)
        env["no_proxy"] = "58.210.177.113,localhost,127.0.0.1"

        result = await self._run_command(
            args=[
                str(runtime.python_executable),
                str(runtime.survey_adapter_path),
                "--workspace",
                str(runtime.run_dir),
                "--config",
                str(runtime.survey_runtime_config_path),
            ],
            cwd=runtime.research_agent_root,
            env=env,
            log_path=runtime.logs_dir / "survey.log",
        )
        if result.returncode != 0:
            raise ResearchAgentExecutionError(
                "survey",
                "Survey agent failed",
                log_path=runtime.logs_dir / "survey.log",
            )

        artifact_names: list[str] = []
        for file_name, artifact_role in (
            ("survey.md", "survey_markdown"),
            ("survey.json", "survey_json"),
            ("evaluation.txt", "survey_evaluation"),
        ):
            path = runtime.survey_output_dir / file_name
            if not path.exists():
                continue
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                trace_id=trace_id,
                path=path,
                handoff_to="ideation",
                artifact_role=artifact_role,
            )
            artifact_names.append(file_name)

        if (runtime.logs_dir / "survey.log").exists():
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                trace_id=trace_id,
                path=runtime.logs_dir / "survey.log",
                emit_event=False,
            )

        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.review,
            status="completed",
            progress=1.0,
            summary="review completed",
            trace_id=trace_id,
        )
        await fake_runner._emit_module_finished(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            status="success",
            artifact_names=artifact_names,
            metrics={"model": module_runtime.resolved_model},
        )
        return artifact_names

    async def _run_idea_stage(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        runtime: ResearchAgentRuntime,
        run_config: RunConfig,
    ) -> tuple[list[str], Path | None]:
        module_runtime = self._module_runtime(
            module=AgentId.ideation,
            run_config=run_config,
            actual_model=runtime.idea_model,
        )

        if not module_runtime.enabled:
            await self._emit_stage_skipped(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                module_runtime=module_runtime,
                reason="Disabled in run config",
            )
            return [], None

        if not await self._await_approval_if_needed(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            artifact_name="idea_result.json",
        ):
            return [], None

        await store.update_run_runtime(
            run_id,
            topic_id=topic_id,
            current_module=module_runtime.module,
        )
        await fake_runner._emit_module_started(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            run_config=run_config,
        )
        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.ideation,
            status="running",
            progress=0.1,
            summary="ideation running",
            trace_id=trace_id,
        )
        await self._emit_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.ideation,
            trace_id=trace_id,
            summary="launching idea agent",
            payload={"stage": "ideation", "topic": runtime.topic_text},
        )

        env = os.environ.copy()
        env["PYTHONPATH"] = (
            str(runtime.research_agent_root)
            if not env.get("PYTHONPATH")
            else f"{runtime.research_agent_root}{os.pathsep}{env['PYTHONPATH']}"
        )
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env["IDEA_AGENT_CONFIG"] = str(runtime.runtime_config_path)

        result = await self._run_command(
            args=[
                str(runtime.python_executable),
                str(runtime.idea_adapter_path),
                "--workspace",
                str(runtime.run_dir),
                "--config",
                str(runtime.runtime_config_path),
            ],
            cwd=runtime.research_agent_root,
            env=env,
            log_path=runtime.logs_dir / "idea.log",
        )
        if result.returncode != 0:
            raise ResearchAgentExecutionError(
                "idea",
                "Idea agent failed",
                log_path=runtime.logs_dir / "idea.log",
            )

        result_dir = runtime.idea_output_root / "output"
        if not result_dir.exists():
            raise ResearchAgentExecutionError(
                "idea",
                "Idea adapter finished but output directory is missing",
                log_path=runtime.logs_dir / "idea.log",
            )

        idea_result_path = result_dir / "idea_result.json"
        if not idea_result_path.exists():
            raise ResearchAgentExecutionError(
                "idea",
                "Idea agent finished but idea_result.json is missing",
                log_path=runtime.logs_dir / "idea.log",
            )

        artifact_names: list[str] = []
        for file_name, artifact_role in (
            ("idea_result.json", "idea_result"),
            ("idea_candidate.json", "idea_candidate"),
            ("replanned_idea_result.json", "idea_replan"),
            ("logs__ligagent.log", "idea_log"),
        ):
            path = result_dir / file_name
            if not path.exists():
                continue
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                trace_id=trace_id,
                path=path,
                handoff_to="experiment",
                artifact_role=artifact_role,
            )
            artifact_names.append(file_name)

        if (runtime.logs_dir / "idea.log").exists():
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                trace_id=trace_id,
                path=runtime.logs_dir / "idea.log",
                emit_event=False,
            )
            artifact_names.append("idea.log")

        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.ideation,
            status="completed",
            progress=1.0,
            summary="ideation completed",
            trace_id=trace_id,
        )
        await fake_runner._emit_module_finished(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            status="success",
            artifact_names=artifact_names,
            metrics={"model": module_runtime.resolved_model},
        )
        return artifact_names, idea_result_path

    async def _run_experiment_stage(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        runtime: ResearchAgentRuntime,
        run_config: RunConfig,
        idea_result_path: Path,
    ) -> list[str]:
        module_runtime = self._module_runtime(
            module=AgentId.experiment,
            run_config=run_config,
            actual_model=runtime.experiment_model,
        )

        if not module_runtime.enabled:
            await self._emit_stage_skipped(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                module_runtime=module_runtime,
                reason="Disabled in run config",
            )
            return []

        if not await self._await_approval_if_needed(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            artifact_name="ablation_results.json",
        ):
            return []

        await store.update_run_runtime(
            run_id,
            topic_id=topic_id,
            current_module=module_runtime.module,
        )
        await fake_runner._emit_module_started(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            run_config=run_config,
        )
        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.experiment,
            status="running",
            progress=0.1,
            summary="experiment running",
            trace_id=trace_id,
        )
        await self._emit_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.experiment,
            trace_id=trace_id,
            summary="launching experiment agent",
            payload={"stage": "experiment"},
        )

        target_idea_json = runtime.experiment_workspace_dir / "idea.json"
        target_idea_result_json = runtime.experiment_workspace_dir / "idea_result.json"
        shutil.copy(idea_result_path, target_idea_json)
        shutil.copy(idea_result_path, target_idea_result_json)

        env = os.environ.copy()
        env["PYTHONPATH"] = (
            str(runtime.research_agent_root)
            if not env.get("PYTHONPATH")
            else f"{runtime.research_agent_root}{os.pathsep}{env['PYTHONPATH']}"
        )
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env["EXPERIMENT_AGENT_WORKSPACE_DIR"] = str(runtime.experiment_workspace_dir)

        result = await self._run_command(
            args=[
                str(runtime.python_executable),
                str(runtime.experiment_adapter_path),
                "--workspace",
                str(runtime.experiment_workspace_dir),
                "--config",
                str(runtime.runtime_config_path),
            ],
            cwd=runtime.research_agent_root,
            env=env,
            log_path=runtime.logs_dir / "experiment.log",
        )
        if result.returncode != 0:
            raise ResearchAgentExecutionError(
                "experiment",
                "Experiment agent failed",
                log_path=runtime.logs_dir / "experiment.log",
            )

        artifact_names: list[str] = []
        for file_name, artifact_role in (
            ("ablation_results.json", "experiment_results"),
            ("final_report.md", "experiment_report"),
        ):
            path = runtime.experiment_workspace_dir / file_name
            if not path.exists():
                continue
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                trace_id=trace_id,
                path=path,
                artifact_role=artifact_role,
            )
            artifact_names.append(file_name)

        if (runtime.logs_dir / "experiment.log").exists():
            await self._register_artifact(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                trace_id=trace_id,
                path=runtime.logs_dir / "experiment.log",
                emit_event=False,
            )
            artifact_names.append("experiment.log")

        await fake_runner._update_agent(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=AgentId.experiment,
            status="completed",
            progress=1.0,
            summary="experiment completed",
            trace_id=trace_id,
        )
        await fake_runner._emit_module_finished(
            topic_id=topic_id,
            run_id=run_id,
            trace_id=trace_id,
            module_runtime=module_runtime,
            status="success",
            artifact_names=artifact_names,
            metrics={"model": module_runtime.resolved_model},
        )
        return artifact_names

    async def run_pipeline(self, topic_id: str, run_id: str) -> None:
        trace_id = str(uuid4())
        active_agent = AgentId.review
        active_runtime: SimpleNamespace | None = None

        topic = await store.get_topic(topic_id)
        run = await store.get_run(run_id)
        if topic is None or run is None:
            logger.warning("Skipping pipeline start because topic or run was not found (%s, %s)", topic_id, run_id)
            return

        run_config = self._load_run_config(run.get("config"))

        try:
            runtime = self._runtime_builder.build(
                topic=topic,
                run_id=run_id,
                run_config=run_config,
            )

            await store.update_run_runtime(
                run_id,
                topic_id=topic_id,
                status="running",
                current_module=None,
                awaiting_approval=False,
                awaiting_module=None,
                touch_started_at=True,
            )

            await self._emit_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                trace_id=trace_id,
                summary="real agent pipeline started",
                payload={
                    "runtimeConfig": str(runtime.runtime_config_path),
                    "workspace": str(runtime.run_dir),
                },
            )

            review_runtime = self._module_runtime(
                module=AgentId.review,
                run_config=run_config,
                actual_model=runtime.survey_model,
            )
            active_agent = AgentId.review
            active_runtime = review_runtime
            await self._run_survey_stage(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                runtime=runtime,
                run_config=run_config,
            )

            ideation_runtime = self._module_runtime(
                module=AgentId.ideation,
                run_config=run_config,
                actual_model=runtime.idea_model,
            )
            active_agent = AgentId.ideation
            active_runtime = ideation_runtime
            _, idea_result_path = await self._run_idea_stage(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                runtime=runtime,
                run_config=run_config,
            )

            experiment_runtime = self._module_runtime(
                module=AgentId.experiment,
                run_config=run_config,
                actual_model=runtime.experiment_model,
            )
            active_agent = AgentId.experiment
            active_runtime = experiment_runtime
            if idea_result_path is None:
                await self._emit_stage_skipped(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    module_runtime=experiment_runtime,
                    reason="Upstream ideation output unavailable",
                )
            else:
                await self._run_experiment_stage(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    runtime=runtime,
                    run_config=run_config,
                    idea_result_path=idea_result_path,
                )

            await store.update_run_runtime(
                run_id,
                topic_id=topic_id,
                status="succeeded",
                current_module=None,
                awaiting_approval=False,
                awaiting_module=None,
                touch_ended_at=True,
            )
            await self._emit_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                trace_id=trace_id,
                summary="real agent pipeline completed",
                payload={"status": "succeeded"},
            )
        except Exception as exc:
            logger.exception("Research agent pipeline failed (topic=%s run=%s)", topic_id, run_id)
            await store.update_run_runtime(
                run_id,
                topic_id=topic_id,
                status="failed",
                current_module=active_runtime.module if active_runtime is not None else None,
                awaiting_approval=False,
                awaiting_module=None,
                touch_ended_at=True,
            )
            if active_runtime is not None:
                await fake_runner._emit_module_failed(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    module_runtime=active_runtime,
                    exc=exc,
                )
            await fake_runner._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=active_agent,
                status="failed",
                progress=1.0,
                summary="pipeline failed",
                trace_id=trace_id,
            )

            payload: dict[str, Any] = {
                "error": str(exc) or exc.__class__.__name__,
                "errorType": exc.__class__.__name__,
            }
            if isinstance(exc, ResearchAgentExecutionError) and exc.log_path is not None:
                payload["logPath"] = str(exc.log_path)
            await self._emit_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=active_agent,
                trace_id=trace_id,
                summary="real agent pipeline failed",
                severity=Severity.error,
                payload=payload,
            )
        finally:
            await approval_manager.clear_run(run_id)


research_agent_runner = ResearchAgentPipelineRunner()
