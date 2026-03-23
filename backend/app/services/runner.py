from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

from app.core.config import get_settings
from app.core.run_config import get_default_run_config
from app.db import SessionLocal
from app.models.schemas import AgentId, ArtifactRef, Event, EventKind, RunConfig, Severity
from app.services.approval_manager import ApprovalDecision, approval_manager
from app.services.deepseek_client import DeepSeekClientError, deepseek_client
from app.services.event_bus import event_bus
from app.services.history_title_service import history_title_service
from app.services.prompt_builder import build_agent_prompt_context, infer_language_code
from app.store import store

logger = logging.getLogger(__name__)

SubtaskStatus = Literal["pending", "running", "completed", "failed"]
StageName = Literal["review", "ideation", "experiment", "feedback"]
ModuleName = Literal["review", "ideation", "experiment"]


@dataclass
class ModuleRuntime:
    module: ModuleName
    enabled: bool
    require_human: bool
    requested_model: str
    resolved_model: str
    model_fallback_used: bool



def now_ms() -> int:
    return int(time.time() * 1000)


def build_event(
    *,
    topic_id: str,
    run_id: str,
    agent_id: AgentId,
    kind: EventKind,
    severity: Severity,
    summary: str,
    payload: dict | None = None,
    artifacts: list[ArtifactRef] | None = None,
    trace_id: str | None = None,
) -> Event:
    return Event(
        eventId=str(uuid4()),
        ts=now_ms(),
        topicId=topic_id,
        runId=run_id,
        agentId=agent_id,
        kind=kind,
        severity=severity,
        summary=summary,
        payload=payload,
        artifacts=artifacts,
        traceId=trace_id,
    )


class FakePipelineRunner:
    def __init__(self) -> None:
        self._step_sleep = 0.8

    @staticmethod
    def _pick_by_lang(language: str, zh_text: str, en_text: str) -> str:
        return zh_text if language == "zh" else en_text

    @staticmethod
    def _safe_text(value: object, fallback: str = "") -> str:
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
        return fallback

    @staticmethod
    def _build_topic_anchor(
        *,
        topic_id: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        return (
            "<topic_context>\n"
            f"<topic_id>{topic_id}</topic_id>\n"
            f"<title>{topic_title}</title>\n"
            f"<description>{topic_description or 'N/A'}</description>\n"
            f"<objective>{topic_objective or 'N/A'}</objective>\n"
            "</topic_context>"
        )

    @staticmethod
    def _error_payload(exc: Exception) -> dict:
        message = str(exc).strip()
        return {
            "error": message or repr(exc),
            "errorType": exc.__class__.__name__,
        }

    @staticmethod
    def _module_agent(module: ModuleName) -> AgentId:
        return AgentId(module)

    @staticmethod
    def _load_run_config(raw_config: object) -> tuple[RunConfig, bool]:
        if isinstance(raw_config, dict):
            try:
                return RunConfig.model_validate(raw_config), False
            except Exception:
                pass
        return get_default_run_config(), True

    @staticmethod
    def _resolve_model_name(requested_model: object) -> tuple[str, str, bool]:
        configured = requested_model.strip() if isinstance(requested_model, str) else ""
        if not configured:
            configured = get_settings().deepseek_model

        lowered = configured.lower()
        if lowered.startswith("deepseek"):
            return configured, configured, False

        fallback_model = get_settings().deepseek_model
        return configured, fallback_model, True

    def _build_module_runtime(self, module: ModuleName, run_config: RunConfig) -> ModuleRuntime:
        cfg = run_config.modules[module]
        requested_model, resolved_model, model_fallback_used = self._resolve_model_name(cfg.model)
        return ModuleRuntime(
            module=module,
            enabled=bool(cfg.enabled),
            require_human=bool(cfg.requireHuman),
            requested_model=requested_model,
            resolved_model=resolved_model,
            model_fallback_used=model_fallback_used,
        )

    async def _emit_module_started(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: ModuleRuntime,
        run_config: RunConfig,
    ) -> None:
        payload: dict[str, Any] = {
            "runId": run_id,
            "module": module_runtime.module,
            "model": module_runtime.resolved_model,
            "thinkingMode": run_config.thinkingMode,
            "online": run_config.online,
        }
        if module_runtime.model_fallback_used:
            payload["requestedModel"] = module_runtime.requested_model
            payload["fallbackUsed"] = True

        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=self._module_agent(module_runtime.module),
                kind=EventKind.module_started,
                severity=Severity.info,
                summary=f"{module_runtime.module} module started",
                payload=payload,
                trace_id=trace_id,
            )
        )

    async def _emit_module_finished(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: ModuleRuntime,
        status: Literal["success", "failed", "skipped"],
        artifact_names: list[str],
        metrics: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "runId": run_id,
            "module": module_runtime.module,
            "status": status,
            "artifactNames": artifact_names,
        }
        if metrics:
            payload["metrics"] = metrics

        if status == "success":
            artifact_summary = ", ".join(name for name in artifact_names if isinstance(name, str) and name.strip())
            assistant_text = (
                f"{module_runtime.module} 输出已生成"
                + (f"：{artifact_summary}" if artifact_summary else "")
            )
            await history_title_service.maybe_generate_for_run_output(
                topic_id=topic_id,
                run_id=run_id,
                assistant_text=assistant_text,
            )

        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=self._module_agent(module_runtime.module),
                kind=EventKind.module_finished,
                severity=Severity.info if status == "success" else Severity.warn,
                summary=f"{module_runtime.module} module {status}",
                payload=payload,
                trace_id=trace_id,
            )
        )

    async def _emit_module_skipped(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: ModuleRuntime,
        reason: str,
    ) -> None:
        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=self._module_agent(module_runtime.module),
                kind=EventKind.module_skipped,
                severity=Severity.warn,
                summary=f"{module_runtime.module} module skipped",
                payload={
                    "runId": run_id,
                    "module": module_runtime.module,
                    "reason": reason,
                },
                trace_id=trace_id,
            )
        )

    async def _emit_module_failed(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: ModuleRuntime,
        exc: Exception,
    ) -> None:
        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=self._module_agent(module_runtime.module),
                kind=EventKind.module_failed,
                severity=Severity.error,
                summary=f"{module_runtime.module} module failed",
                payload={
                    "runId": run_id,
                    "module": module_runtime.module,
                    "error": {
                        "message": str(exc) or exc.__class__.__name__,
                        "code": exc.__class__.__name__,
                    },
                    "retryable": False,
                },
                trace_id=trace_id,
            )
        )

    async def _wait_if_human_required(
        self,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        module_runtime: ModuleRuntime,
        summary: str,
        artifact_name: str | None = None,
    ) -> ApprovalDecision:
        if not module_runtime.require_human:
            return ApprovalDecision(approved=True, note=None)

        await approval_manager.create_pending(run_id, module_runtime.module)

        await store.update_run_runtime(
            run_id,
            topic_id=topic_id,
            status="paused",
            current_module=module_runtime.module,
            awaiting_approval=True,
            awaiting_module=module_runtime.module,
            approval_resolved_at=None,
        )

        payload: dict[str, Any] = {
            "runId": run_id,
            "module": module_runtime.module,
            "summary": summary,
        }
        if artifact_name:
            payload["artifactName"] = artifact_name

        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=self._module_agent(module_runtime.module),
                kind=EventKind.approval_required,
                severity=Severity.warn,
                summary=f"{module_runtime.module} requires human approval",
                payload=payload,
                trace_id=trace_id,
            )
        )

        decision = await approval_manager.wait_for_decision(run_id, module_runtime.module)
        await store.update_run_runtime(
            run_id,
            topic_id=topic_id,
            status="running",
            current_module=module_runtime.module,
            awaiting_approval=False,
            awaiting_module=None,
        )
        return decision

    @staticmethod
    def _sanitize_subtask_status(value: object) -> SubtaskStatus:
        if isinstance(value, str) and value in {"pending", "running", "completed", "failed"}:
            return value
        return "pending"

    @staticmethod
    def _sanitize_subtask_progress(value: object, *, default: float = 0.0) -> float:
        if isinstance(value, (int, float)):
            return max(0.0, min(float(value), 1.0))
        return default

    @staticmethod
    def _fallback_subtasks(
        *,
        agent_id: AgentId,
        stage: StageName,
        language_code: str,
    ) -> list[dict]:
        use_zh = language_code == "zh"
        fallback_map: dict[tuple[AgentId, StageName], list[str]] = {
            (AgentId.review, "review"): [
                "Clarify research scope and constraints",
                "Collect representative literature",
                "Compare methods and identify gaps",
                "Draft survey and hand off to ideation",
            ],
            (AgentId.ideation, "ideation"): [
                "Extract actionable constraints from survey",
                "Generate candidate research ideas",
                "Evaluate risks and expected metrics",
                "Finalize ideas and hand off to experiment",
            ],
            (AgentId.experiment, "experiment"): [
                "Convert ideas into experiment plan",
                "Prepare metrics and baseline assumptions",
                "Run simulation and collect outputs",
                "Summarize results and produce report",
            ],
            (AgentId.ideation, "feedback"): [
                "Review experiment outcomes",
                "Identify what to keep or change",
                "Define next-iteration validation plan",
                "Publish feedback loop summary",
            ],
        }

        names = fallback_map.get((agent_id, stage), [])
        if use_zh:
            zh_map = {
                "Clarify research scope and constraints": "明确研究范围与约束",
                "Collect representative literature": "收集代表性文献",
                "Compare methods and identify gaps": "对比方法并识别空白",
                "Draft survey and hand off to ideation": "整理综述并交接给 ideation",
                "Extract actionable constraints from survey": "从综述中提炼可执行约束",
                "Generate candidate research ideas": "生成候选研究构思",
                "Evaluate risks and expected metrics": "评估风险与预期指标",
                "Finalize ideas and hand off to experiment": "固化方案并交接给 experiment",
                "Convert ideas into experiment plan": "将构思转成实验计划",
                "Prepare metrics and baseline assumptions": "准备指标与基线假设",
                "Run simulation and collect outputs": "执行模拟并收集输出",
                "Summarize results and produce report": "汇总结果并输出报告",
                "Review experiment outcomes": "审阅实验结果",
                "Identify what to keep or change": "识别保留项与调整项",
                "Define next-iteration validation plan": "定义下一轮验证计划",
                "Publish feedback loop summary": "发布反馈闭环总结",
            }
            names = [zh_map.get(name, name) for name in names]

        subtasks: list[dict] = []
        for index, name in enumerate(names):
            subtasks.append(
                {
                    "id": f"{stage}-{index + 1}",
                    "name": name,
                    "status": "pending",
                    "progress": 0.0,
                }
            )
        return subtasks

    def _normalize_subtasks(
        self,
        *,
        raw_subtasks: object,
        fallback_subtasks: list[dict],
        stage: StageName,
    ) -> list[dict]:
        normalized: list[dict] = []

        if isinstance(raw_subtasks, list):
            for index, item in enumerate(raw_subtasks):
                if not isinstance(item, dict):
                    continue

                name = item.get("name")
                if not isinstance(name, str) or not name.strip():
                    continue

                item_id = item.get("id")
                subtask_id = item_id.strip() if isinstance(item_id, str) and item_id.strip() else f"{stage}-{index + 1}"

                normalized.append(
                    {
                        "id": subtask_id,
                        "name": name.strip(),
                        "status": self._sanitize_subtask_status(item.get("status")),
                        "progress": self._sanitize_subtask_progress(item.get("progress")),
                    }
                )

        # Hard guardrails: 4~8 entries, and start from pending state.
        if len(normalized) < 4:
            seen_ids = {item["id"] for item in normalized}
            for fallback_item in fallback_subtasks:
                if len(normalized) >= 4:
                    break
                if fallback_item["id"] in seen_ids:
                    continue
                normalized.append(dict(fallback_item))
                seen_ids.add(fallback_item["id"])

        if len(normalized) > 8:
            normalized = normalized[:8]

        for item in normalized:
            item["status"] = "pending"
            item["progress"] = 0.0

        return normalized

    @staticmethod
    def _patch_subtask_state(
        subtasks: list[dict],
        index: int,
        *,
        status: SubtaskStatus,
        progress: float | None = None,
    ) -> list[dict]:
        next_subtasks = [dict(item) for item in subtasks]
        if index < 0 or index >= len(next_subtasks):
            return next_subtasks

        next_subtasks[index]["status"] = status
        if progress is not None:
            next_subtasks[index]["progress"] = max(0.0, min(float(progress), 1.0))
        elif status == "completed":
            next_subtasks[index]["progress"] = 1.0
        elif status == "failed":
            current = next_subtasks[index].get("progress")
            next_subtasks[index]["progress"] = (
                max(0.0, min(float(current), 1.0)) if isinstance(current, (int, float)) else 0.0
            )

        return next_subtasks

    @staticmethod
    def _mark_running_subtasks_failed(subtasks: list[dict]) -> list[dict]:
        patched = [dict(item) for item in subtasks]
        for item in patched:
            if item.get("status") == "running":
                item["status"] = "failed"
        return patched

    async def _emit_subtasks_update(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        stage: StageName,
        subtasks: list[dict],
        trace_id: str,
        severity: Severity = Severity.info,
        summary: str | None = None,
    ) -> None:
        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                kind=EventKind.agent_subtasks_updated,
                severity=severity,
                summary=summary or f"{agent_id.value} subtasks updated ({stage})",
                payload={
                    "subtasks": subtasks,
                    "subtaskCount": len(subtasks),
                    "stage": stage,
                },
                trace_id=trace_id,
            )
        )

    async def generate_subtasks_plan(
        self,
        agent_id: AgentId,
        stage: StageName,
        topic_anchor: str,
        upstream_ref: str,
        language_code: str,
        *,
        topic_id: str,
        run_id: str,
        trace_id: str,
        llm_model: str | None = None,
    ) -> list[dict]:
        fallback_subtasks = self._fallback_subtasks(
            agent_id=agent_id,
            stage=stage,
            language_code=language_code,
        )

        planner_task = (
            "Return strict JSON only:\n"
            "{\n"
            '  "subtasks": [\n'
            '    {"id":"...", "name":"...", "status":"pending", "progress":0}\n'
            "  ]\n"
            "}\n"
            f"Constraints: generate 4-8 subtasks for stage={stage} and agent={agent_id.value}. "
            "Each subtask must be concrete and execution-ready."
        )

        planner_result = await self._generate_json_content(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            system_policy="You are a planning module that decomposes agent work into executable subtasks.",
            upstream_content=(
                f"{topic_anchor}\n\n"
                "<upstream_reference>\n"
                f"{upstream_ref}\n"
                "</upstream_reference>"
            ),
            final_task=planner_task,
            fallback_content={"subtasks": fallback_subtasks},
            llm_model=llm_model,
            max_tokens=700,
        )

        raw_subtasks = planner_result.get("subtasks") if isinstance(planner_result, dict) else None
        normalized = self._normalize_subtasks(
            raw_subtasks=raw_subtasks,
            fallback_subtasks=fallback_subtasks,
            stage=stage,
        )
        return normalized

    async def _emit(self, event: Event) -> None:
        await store.add_event(event)
        await event_bus.publish(event.topicId, event)

    async def _create_artifact(
        self,
        *,
        topic_id: str,
        run_id: str,
        name: str,
        content_type: str,
        content: str | dict,
    ) -> ArtifactRef:
        return await store.create_artifact(
            topic_id=topic_id,
            run_id=run_id,
            name=name,
            content_type=content_type,
            content=content,
        )

    async def _update_agent(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        status: str,
        progress: float,
        summary: str,
        trace_id: str,
    ) -> None:
        await store.set_agent_status(
            topic_id,
            agent_id=agent_id,
            status=status,
            progress=progress,
            run_id=run_id,
            summary=summary,
        )

        severity = Severity.error if status == "failed" else Severity.info
        event = build_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            kind=EventKind.agent_status_updated,
            severity=severity,
            summary=summary,
            payload={"status": status, "progress": progress},
            trace_id=trace_id,
        )
        await self._emit(event)

    async def _emit_llm_stage(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        summary: str,
        severity: Severity = Severity.info,
        payload: dict | None = None,
    ) -> None:
        await self._emit(
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

    @staticmethod
    def _strip_markdown_fence(content: str) -> str:
        text = content.strip()
        if not text.startswith("```"):
            return text

        lines = text.splitlines()
        if len(lines) >= 2 and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()

        return text

    @classmethod
    def _parse_json_payload(cls, content: str) -> dict | None:
        raw = cls._strip_markdown_fence(content)
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end <= start:
            return None

        try:
            parsed = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    @staticmethod
    def _fallback_review_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 文献综述（回退）\n\n"
                "## 主题对齐\n"
                f"- 研究主题：{topic_title}\n"
                f"- 场景描述：{topic_description or '未提供'}\n"
                f"- 核心目标：{topic_objective or '未提供'}\n\n"
                "## 现状观察\n"
                "- 该方向常见方案包括检索增强、知识蒸馏与评估闭环。\n"
                "- 实际落地中最常见瓶颈是数据质量与评测口径不一致。\n"
                "- 需要明确在线约束，避免实验结果不可复现。\n\n"
                "## 方法对比\n"
                "- 规则驱动：可控但覆盖有限。\n"
                "- 端到端模型：潜力高但解释性较弱。\n"
                "- 混合式架构：在稳定性与性能间更平衡。\n\n"
                "## 后续建议\n"
                "- 进入 ideation 阶段，先做 2-3 个可执行方案。\n"
                "- 同步定义实验指标、成本预算、失败回退机制。\n"
                "- 保留与主题目标直接相关的约束，减少泛化描述。\n"
            )
        return (
            f"# Literature Survey for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Topic: {topic_title}\n"
            f"- Description: {topic_description or 'N/A'}\n"
            f"- Objective: {topic_objective or 'N/A'}\n\n"
            "## Current Landscape\n"
            "- Typical directions include retrieval augmentation, distillation, and closed-loop evaluation.\n"
            "- Common production bottleneck is mismatch between data quality and evaluation protocol.\n"
            "- Online constraints must be explicit to keep experiments reproducible.\n\n"
            "## Method Comparison\n"
            "- Rule-driven: controllable but narrow coverage.\n"
            "- End-to-end: high performance ceiling but weaker interpretability.\n"
            "- Hybrid: balanced trade-off between reliability and performance.\n\n"
            "## Next Actions\n"
            "- Move to ideation with 2-3 executable proposals.\n"
            "- Define metrics, budget, and rollback policy together.\n"
            "- Keep constraints tightly bound to the topic objective.\n"
        )

    @staticmethod
    def _fallback_ideas_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 方案构思（回退）\n\n"
                "## 主题对齐\n"
                f"- 描述约束：{topic_description or '未提供'}\n"
                f"- 目标约束：{topic_objective or '未提供'}\n"
                "- 下述方案均围绕该主题目标设计，不做泛化扩展。\n\n"
                "## 方案 A：检索增强 + 质量门控\n"
                "- 假设：提升检索相关性能显著提高回答可靠性。\n"
                "- 执行：引入 query rewrite、rerank、低分拒答策略。\n"
                "- 指标：Hit@k、回答准确率、拒答正确率。\n\n"
                "## 方案 B：多路径推理 + 置信度路由\n"
                "- 假设：按任务难度路由可提升总体稳定性。\n"
                "- 执行：轻量路径与重路径并行，按置信度选择。\n"
                "- 指标：端到端延迟、失败率、复杂问题成功率。\n\n"
                "## 方案 C：反馈闭环优化\n"
                "- 假设：将失败样本回灌可持续提升表现。\n"
                "- 执行：沉淀 error cases，定期离线再评估。\n"
                "- 指标：迭代增益、回归率、维护成本。\n"
            )
        return (
            f"# Research Ideas for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Description constraints: {topic_description or 'N/A'}\n"
            f"- Objective constraints: {topic_objective or 'N/A'}\n"
            "- All ideas below are scoped to this topic and objective.\n\n"
            "## Idea A: Retrieval Augmentation + Quality Gates\n"
            "- Hypothesis: improving retrieval relevance lifts answer reliability.\n"
            "- Plan: add query rewrite, rerank, and low-score abstention.\n"
            "- Metrics: Hit@k, answer accuracy, abstention precision.\n\n"
            "## Idea B: Multi-path Reasoning + Confidence Routing\n"
            "- Hypothesis: route-by-difficulty improves stability.\n"
            "- Plan: lightweight and heavy paths, selected by confidence.\n"
            "- Metrics: latency, failure rate, hard-case success rate.\n\n"
            "## Idea C: Feedback-Driven Iteration\n"
            "- Hypothesis: replaying failure cases yields compounding gains.\n"
            "- Plan: collect error cases and run periodic offline reevaluation.\n"
            "- Metrics: iteration uplift, regression rate, maintenance overhead.\n"
        )

    @staticmethod
    def _fallback_result_report_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
        metrics: dict,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 实验结果报告（回退）\n\n"
                "## 主题对齐\n"
                f"- 场景描述：{topic_description or '未提供'}\n"
                f"- 目标说明：{topic_objective or '未提供'}\n"
                "- 本报告仅围绕主题目标解释实验结果。\n\n"
                "## 关键观察\n"
                "- 检索增强路线在稳定性上提升明显。\n"
                "- 置信度路由降低了高难样本的失败率。\n"
                "- 反馈闭环对迭代增益有正向作用。\n\n"
                "## 指标解读\n"
                f"- Accuracy: {metrics.get('accuracy', 'n/a')}\n"
                f"- F1: {metrics.get('f1', 'n/a')}\n"
                f"- Robustness: {metrics.get('robustness', 'n/a')}\n"
                "- 指标表明当前方案可进入下一轮优化。\n\n"
                "## 风险与下一步\n"
                "- 风险：数据分布漂移可能导致线上回落。\n"
                "- 风险：复杂路由策略增加维护成本。\n"
                "- 下一步：扩样本、做消融、补充成本收益分析。\n"
            )
        return (
            f"# Experiment Result Report for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Description: {topic_description or 'N/A'}\n"
            f"- Objective: {topic_objective or 'N/A'}\n"
            "- This report remains scoped to the topic constraints.\n\n"
            "## Key Observations\n"
            "- Retrieval-augmented setup improved reliability.\n"
            "- Confidence routing reduced failure rate on hard cases.\n"
            "- Feedback loop contributed to iterative gains.\n\n"
            "## Metrics Interpretation\n"
            f"- Accuracy: {metrics.get('accuracy', 'n/a')}\n"
            f"- F1: {metrics.get('f1', 'n/a')}\n"
            f"- Robustness: {metrics.get('robustness', 'n/a')}\n"
            "- Signals are positive for the next optimization cycle.\n\n"
            "## Risks and Next Steps\n"
            "- Risk: distribution shift can hurt online quality.\n"
            "- Risk: more complex routing increases maintenance burden.\n"
            "- Next: scale data, run ablations, add cost-benefit analysis.\n"
        )

    async def _generate_text_content(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        system_policy: str,
        upstream_content: str,
        final_task: str,
        fallback_content: str,
        llm_model: str | None = None,
        max_tokens: int | None = None,
    ) -> str:
        with SessionLocal() as db:
            messages = await build_agent_prompt_context(
                db=db,
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id.value,
                system_policy=system_policy,
                upstream_content=upstream_content,
                final_task=final_task,
            )

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} invoking DeepSeek",
            payload={
                "provider": "deepseek",
                "model": llm_model or get_settings().deepseek_model,
                "messageCount": len(messages),
                "maxTokens": max_tokens,
            },
        )

        if not deepseek_client.is_configured:
            logger.warning(
                "DeepSeek key missing; fallback text used (topic=%s run=%s agent=%s)",
                topic_id,
                run_id,
                agent_id.value,
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DEEPSEEK_API_KEY is missing, fallback content used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return fallback_content

        try:
            response = await deepseek_client.chat(messages, model=llm_model, max_tokens=max_tokens)
        except DeepSeekClientError as exc:
            error_payload = self._error_payload(exc)
            logger.warning(
                "DeepSeek text call failed (topic=%s run=%s agent=%s): %s",
                topic_id,
                run_id,
                agent_id.value,
                error_payload["error"],
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek request failed, fallback content used",
                severity=Severity.error,
                payload={"provider": "deepseek", "fallback": True, **error_payload},
            )
            return fallback_content

        normalized = self._strip_markdown_fence(response).strip()
        if not normalized:
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek returned empty content, fallback content used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return fallback_content

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} received DeepSeek response",
            payload={"provider": "deepseek", "fallback": False},
        )
        return normalized

    async def _generate_json_content(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        system_policy: str,
        upstream_content: str,
        final_task: str,
        fallback_content: dict,
        llm_model: str | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        with SessionLocal() as db:
            messages = await build_agent_prompt_context(
                db=db,
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id.value,
                system_policy=system_policy,
                upstream_content=upstream_content,
                final_task=final_task,
            )

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} invoking DeepSeek",
            payload={
                "provider": "deepseek",
                "model": llm_model or get_settings().deepseek_model,
                "messageCount": len(messages),
                "maxTokens": max_tokens,
            },
        )

        if not deepseek_client.is_configured:
            logger.warning(
                "DeepSeek key missing; fallback JSON used (topic=%s run=%s agent=%s)",
                topic_id,
                run_id,
                agent_id.value,
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DEEPSEEK_API_KEY is missing, fallback JSON used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return dict(fallback_content)

        try:
            response = await deepseek_client.chat(messages, model=llm_model, max_tokens=max_tokens)
        except DeepSeekClientError as exc:
            error_payload = self._error_payload(exc)
            logger.warning(
                "DeepSeek JSON call failed (topic=%s run=%s agent=%s): %s",
                topic_id,
                run_id,
                agent_id.value,
                error_payload["error"],
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek request failed, fallback JSON used",
                severity=Severity.error,
                payload={"provider": "deepseek", "fallback": True, **error_payload},
            )
            return dict(fallback_content)

        parsed = self._parse_json_payload(response)
        if parsed is None:
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek response is not valid JSON, fallback JSON used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return dict(fallback_content)

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} received DeepSeek response",
            payload={"provider": "deepseek", "fallback": False},
        )
        return parsed

    async def run_pipeline(self, topic_id: str, run_id: str) -> None:
        trace_id = f"trace-{uuid4()}"
        active_agent = AgentId.review
        active_stage: StageName = "review"
        active_module_runtime: ModuleRuntime | None = None
        module_failure_emitted = False

        async def prepare_module(
            module_runtime: ModuleRuntime,
            *,
            approval_summary: str,
            artifact_name: str,
        ) -> bool:
            await store.update_run_runtime(
                run_id,
                topic_id=topic_id,
                status="running",
                current_module=module_runtime.module,
                awaiting_approval=False,
                awaiting_module=None,
            )

            if not module_runtime.enabled:
                await self._emit_module_skipped(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    module_runtime=module_runtime,
                    reason="disabled_in_config",
                )
                await self._update_agent(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=self._module_agent(module_runtime.module),
                    status="skipped",
                    progress=1.0,
                    summary=f"{module_runtime.module} skipped (disabled_in_config)",
                    trace_id=trace_id,
                )
                return False

            if module_runtime.model_fallback_used:
                await self._emit_llm_stage(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=self._module_agent(module_runtime.module),
                    trace_id=trace_id,
                    summary="unsupported model configured, fallback model applied",
                    severity=Severity.warn,
                    payload={
                        "requestedModel": module_runtime.requested_model,
                        "resolvedModel": module_runtime.resolved_model,
                        "fallback": True,
                    },
                )

            decision = await self._wait_if_human_required(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                module_runtime=module_runtime,
                summary=approval_summary,
                artifact_name=artifact_name,
            )
            if not decision.approved:
                await self._emit_module_skipped(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    module_runtime=module_runtime,
                    reason="rejected_by_human",
                )
                await self._update_agent(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=self._module_agent(module_runtime.module),
                    status="skipped",
                    progress=1.0,
                    summary=f"{module_runtime.module} skipped (human rejected)",
                    trace_id=trace_id,
                )
                return False

            await self._emit_module_started(
                topic_id=topic_id,
                run_id=run_id,
                trace_id=trace_id,
                module_runtime=module_runtime,
                run_config=run_config,
            )
            return True

        try:
            run_record = await store.get_run(run_id)
            if run_record is None or run_record["topicId"] != topic_id:
                raise KeyError(run_id)

            await store.update_run_runtime(
                run_id,
                topic_id=topic_id,
                status="running",
                current_module=None,
                awaiting_approval=False,
                awaiting_module=None,
                approval_resolved_at=None,
                touch_started_at=True,
            )

            topic = await store.get_topic(topic_id)
            if topic is None:
                raise KeyError(topic_id)

            topic_title = self._safe_text(topic.get("title"), self._safe_text(topic.get("name"), topic_id))
            topic_description = self._safe_text(topic.get("description"))
            topic_objective = self._safe_text(topic.get("objective"))
            topic_anchor = self._build_topic_anchor(
                topic_id=topic_id,
                topic_title=topic_title,
                topic_description=topic_description,
                topic_objective=topic_objective,
            )
            preferred_language = infer_language_code(topic_title, topic_description, topic_objective)

            run_config, config_fallback_used = self._load_run_config(run_record.get("config"))

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run started",
                    payload={
                        "phase": "run_started",
                        "topicTitle": topic_title,
                        "thinkingMode": run_config.thinkingMode,
                        "online": run_config.online,
                    },
                    trace_id=trace_id,
                )
            )
            if config_fallback_used:
                await self._emit_llm_stage(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    trace_id=trace_id,
                    summary="run config invalid, default config applied",
                    severity=Severity.warn,
                    payload={"fallback": True},
                )

            review_runtime = self._build_module_runtime("review", run_config)
            ideation_runtime = self._build_module_runtime("ideation", run_config)
            experiment_runtime = self._build_module_runtime("experiment", run_config)

            survey_content = self._fallback_review_markdown(
                language=preferred_language,
                topic_title=topic_title,
                topic_description=topic_description,
                topic_objective=topic_objective,
            )
            ideas_content = self._fallback_ideas_markdown(
                language=preferred_language,
                topic_title=topic_title,
                topic_description=topic_description,
                topic_objective=topic_objective,
            )
            results_content: dict[str, Any] = {
                "topicId": topic_id,
                "topicTitle": topic_title,
                "runId": run_id,
                "metrics": {"accuracy": 0.78, "f1": 0.74, "robustness": 0.71},
                "notes": "Fallback result content",
                "next_actions": ["scale data", "run ablation", "track cost/quality"],
            }
            metrics: dict[str, Any] = dict(results_content["metrics"])
            result_report_content = self._fallback_result_report_markdown(
                language=preferred_language,
                topic_title=topic_title,
                topic_description=topic_description,
                topic_objective=topic_objective,
                metrics=metrics,
            )

            ideation_executed = False
            experiment_executed = False

            # review module
            active_agent = AgentId.review
            active_stage = "review"
            active_module_runtime = review_runtime
            if await prepare_module(
                review_runtime,
                approval_summary="Review module requires approval before generating survey.md",
                artifact_name="survey.md",
            ):
                try:
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.review,
                        status="running",
                        progress=0.1,
                        summary="review running",
                        trace_id=trace_id,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.review,
                            kind=EventKind.event_emitted,
                            severity=Severity.info,
                            summary="starting literature review",
                            payload={"stage": "review"},
                            trace_id=trace_id,
                        )
                    )
                    await asyncio.sleep(self._step_sleep)

                    survey_content = await self._generate_text_content(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.review,
                        trace_id=trace_id,
                        system_policy="You are the review agent. Produce a rigorous, topic-grounded literature survey in markdown.",
                        upstream_content=topic_anchor,
                        final_task="Generate survey.md using <upstream_reference>.",
                        fallback_content=survey_content,
                        llm_model=review_runtime.resolved_model,
                        max_tokens=1800,
                    )
                    survey_artifact = await self._create_artifact(
                        topic_id=topic_id,
                        run_id=run_id,
                        name="survey.md",
                        content_type="text/markdown",
                        content=survey_content,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.review,
                            kind=EventKind.artifact_created,
                            severity=Severity.info,
                            summary="review produced survey.md",
                            payload={"handoffTo": "ideation", "artifactRole": "survey"},
                            artifacts=[survey_artifact],
                            trace_id=trace_id,
                        )
                    )
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.review,
                        status="completed",
                        progress=1.0,
                        summary="review completed",
                        trace_id=trace_id,
                    )
                    await self._emit_module_finished(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=review_runtime,
                        status="success",
                        artifact_names=["survey.md"],
                        metrics={
                            "model": review_runtime.resolved_model,
                            "fallbackModelUsed": review_runtime.model_fallback_used,
                        },
                    )
                except Exception as exc:
                    module_failure_emitted = True
                    await self._emit_module_failed(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=review_runtime,
                        exc=exc,
                    )
                    raise

            # ideation module
            active_agent = AgentId.ideation
            active_stage = "ideation"
            active_module_runtime = ideation_runtime
            ideas_upstream = (
                f"{topic_anchor}\n\n"
                "<review_survey>\n"
                f"{survey_content}\n"
                "</review_survey>"
            )
            if await prepare_module(
                ideation_runtime,
                approval_summary="Ideation module requires approval before generating ideas.md",
                artifact_name="ideas.md",
            ):
                try:
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.ideation,
                        status="running",
                        progress=0.2,
                        summary="ideation running",
                        trace_id=trace_id,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.ideation,
                            kind=EventKind.event_emitted,
                            severity=Severity.info,
                            summary="generating ideas from survey",
                            payload={"stage": "ideation"},
                            trace_id=trace_id,
                        )
                    )
                    await asyncio.sleep(self._step_sleep)

                    ideas_content = await self._generate_text_content(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.ideation,
                        trace_id=trace_id,
                        system_policy="You are the ideation agent. Produce implementation-ready ideas.",
                        upstream_content=ideas_upstream,
                        final_task="Generate ideas.md from <upstream_reference>.",
                        fallback_content=ideas_content,
                        llm_model=ideation_runtime.resolved_model,
                        max_tokens=1800,
                    )
                    ideas_artifact = await self._create_artifact(
                        topic_id=topic_id,
                        run_id=run_id,
                        name="ideas.md",
                        content_type="text/markdown",
                        content=ideas_content,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.ideation,
                            kind=EventKind.artifact_created,
                            severity=Severity.info,
                            summary="ideation produced ideas.md",
                            payload={"handoffTo": "experiment", "artifactRole": "idea"},
                            artifacts=[ideas_artifact],
                            trace_id=trace_id,
                        )
                    )
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.ideation,
                        status="completed",
                        progress=1.0,
                        summary="ideation completed",
                        trace_id=trace_id,
                    )
                    await self._emit_module_finished(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=ideation_runtime,
                        status="success",
                        artifact_names=["ideas.md"],
                        metrics={
                            "model": ideation_runtime.resolved_model,
                            "fallbackModelUsed": ideation_runtime.model_fallback_used,
                        },
                    )
                    ideation_executed = True
                except Exception as exc:
                    module_failure_emitted = True
                    await self._emit_module_failed(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=ideation_runtime,
                        exc=exc,
                    )
                    raise

            # experiment module
            active_agent = AgentId.experiment
            active_stage = "experiment"
            active_module_runtime = experiment_runtime
            experiment_upstream = (
                f"{topic_anchor}\n\n"
                "<ideas_input>\n"
                f"{ideas_content}\n"
                "</ideas_input>"
            )
            if await prepare_module(
                experiment_runtime,
                approval_summary="Experiment module requires approval before execution",
                artifact_name="results.json",
            ):
                try:
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.experiment,
                        status="running",
                        progress=0.25,
                        summary="experiment running",
                        trace_id=trace_id,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.experiment,
                            kind=EventKind.event_emitted,
                            severity=Severity.info,
                            summary="running experiments for idea",
                            payload={"stage": "experiment"},
                            trace_id=trace_id,
                        )
                    )
                    await asyncio.sleep(self._step_sleep)
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.experiment,
                            kind=EventKind.event_emitted,
                            severity=Severity.error,
                            summary="experiment encountered temporary failure, retrying",
                            payload={"errorCode": "SIM_TEMP_FAILURE", "retryable": True},
                            trace_id=trace_id,
                        )
                    )

                    results_content = await self._generate_json_content(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.experiment,
                        trace_id=trace_id,
                        system_policy="You are the experiment agent. Return strict JSON only.",
                        upstream_content=experiment_upstream,
                        final_task="Generate strict JSON results from <upstream_reference>.",
                        fallback_content=results_content,
                        llm_model=experiment_runtime.resolved_model,
                        max_tokens=1200,
                    )
                    metrics = results_content.get("metrics") if isinstance(results_content.get("metrics"), dict) else {}
                    result_report_content = await self._generate_text_content(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.experiment,
                        trace_id=trace_id,
                        system_policy="You are the experiment reporting agent. Produce a detailed markdown report.",
                        upstream_content=(
                            f"{topic_anchor}\n\n"
                            "<results_json>\n"
                            f"{json.dumps(results_content, ensure_ascii=False)}\n"
                            "</results_json>"
                        ),
                        final_task="Generate result.md from <upstream_reference>.",
                        fallback_content=result_report_content,
                        llm_model=experiment_runtime.resolved_model,
                        max_tokens=1800,
                    )

                    results_artifact = await self._create_artifact(
                        topic_id=topic_id,
                        run_id=run_id,
                        name="results.json",
                        content_type="application/json",
                        content=results_content,
                    )
                    result_report_artifact = await self._create_artifact(
                        topic_id=topic_id,
                        run_id=run_id,
                        name="result.md",
                        content_type="text/markdown",
                        content=result_report_content,
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.experiment,
                            kind=EventKind.artifact_created,
                            severity=Severity.info,
                            summary="experiment produced results.json",
                            payload={"handoffTo": "ideation", "artifactRole": "results", "metrics": metrics},
                            artifacts=[results_artifact],
                            trace_id=trace_id,
                        )
                    )
                    await self._emit(
                        build_event(
                            topic_id=topic_id,
                            run_id=run_id,
                            agent_id=AgentId.experiment,
                            kind=EventKind.artifact_created,
                            severity=Severity.info,
                            summary="experiment produced result.md",
                            payload={"handoffTo": "ideation", "artifactRole": "result_report"},
                            artifacts=[result_report_artifact],
                            trace_id=trace_id,
                        )
                    )
                    await self._update_agent(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.experiment,
                        status="completed",
                        progress=1.0,
                        summary="experiment completed",
                        trace_id=trace_id,
                    )
                    await self._emit_module_finished(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=experiment_runtime,
                        status="success",
                        artifact_names=["results.json", "result.md"],
                        metrics={
                            "model": experiment_runtime.resolved_model,
                            "fallbackModelUsed": experiment_runtime.model_fallback_used,
                        },
                    )
                    experiment_executed = True
                except Exception as exc:
                    module_failure_emitted = True
                    await self._emit_module_failed(
                        topic_id=topic_id,
                        run_id=run_id,
                        trace_id=trace_id,
                        module_runtime=experiment_runtime,
                        exc=exc,
                    )
                    raise

            if ideation_executed and experiment_executed:
                active_agent = AgentId.ideation
                active_stage = "feedback"
                await self._update_agent(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    status="running",
                    progress=0.75,
                    summary="ideation refining from experiment feedback",
                    trace_id=trace_id,
                )
                await self._emit(
                    build_event(
                        topic_id=topic_id,
                        run_id=run_id,
                        agent_id=AgentId.ideation,
                        kind=EventKind.event_emitted,
                        severity=Severity.info,
                        summary="refining idea from results",
                        payload={"stage": "feedback"},
                        trace_id=trace_id,
                    )
                )
                await self._generate_text_content(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    trace_id=trace_id,
                    system_policy="You are the ideation feedback agent.",
                    upstream_content=(
                        f"{topic_anchor}\n\n"
                        "<result_report>\n"
                        f"{result_report_content}\n"
                        "</result_report>"
                    ),
                    final_task="Generate a concise feedback plan.",
                    fallback_content=self._pick_by_lang(
                        preferred_language,
                        "## Feedback Plan (Fallback)\n"
                        "- Keep effective paths\n"
                        "- Correct failed points\n"
                        "- Define next validation metrics\n",
                        "## Feedback Plan (Fallback)\n"
                        "- Keep effective paths\n"
                        "- Correct failed points\n"
                        "- Define next validation metrics\n",
                    ),
                    llm_model=ideation_runtime.resolved_model,
                    max_tokens=1000,
                )
                await self._update_agent(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    status="completed",
                    progress=1.0,
                    summary="ideation feedback loop completed",
                    trace_id=trace_id,
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
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run completed",
                    payload={"phase": "completed"},
                    trace_id=trace_id,
                )
            )
        except Exception as exc:
            logger.exception("Pipeline crashed (topic=%s run=%s)", topic_id, run_id)
            try:
                await store.update_run_runtime(
                    run_id,
                    topic_id=topic_id,
                    status="failed",
                    current_module=active_module_runtime.module if active_module_runtime else None,
                    awaiting_approval=False,
                    awaiting_module=None,
                    touch_ended_at=True,
                )
            except Exception:
                return

            if active_module_runtime is not None and not module_failure_emitted:
                await self._emit_module_failed(
                    topic_id=topic_id,
                    run_id=run_id,
                    trace_id=trace_id,
                    module_runtime=active_module_runtime,
                    exc=exc,
                )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=active_agent,
                status="failed",
                progress=1.0,
                summary="pipeline failed",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=active_agent,
                    kind=EventKind.event_emitted,
                    severity=Severity.error,
                    summary="pipeline crashed",
                    payload=self._error_payload(exc),
                    trace_id=trace_id,
                )
            )
        finally:
            await approval_manager.clear_run(run_id)


fake_runner = FakePipelineRunner()
