from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import shutil
import sys
from typing import Any

import yaml

from app.core.config import BACKEND_DIR, default_research_agent_python, get_settings
from app.models.schemas import RunConfig


@dataclass(slots=True)
class ResearchAgentRuntime:
    research_agent_root: Path
    python_executable: Path
    container_research_agent_root: Path
    container_task_dir: Path
    container_python_executable: Path
    base_config_path: Path
    runtime_config_path: Path
    survey_runtime_config_path: Path
    container_runtime_config_path: Path
    container_survey_runtime_config_path: Path
    run_dir: Path
    config_dir: Path
    logs_dir: Path
    survey_output_dir: Path
    idea_output_root: Path
    experiment_workspace_dir: Path
    shared_dir: Path
    survey_adapter_path: Path
    idea_adapter_path: Path
    experiment_adapter_path: Path
    container_survey_adapter_path: Path
    container_idea_adapter_path: Path
    container_experiment_adapter_path: Path
    topic_text: str
    input_text: str
    mature_idea: str
    refinement_scope: str
    survey_model: str
    idea_model: str
    experiment_model: str


def _safe_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _ensure_absolute(path_value: str, *, base: Path) -> Path:
    candidate = Path(path_value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (base / candidate).resolve()


class ResearchAgentRuntimeConfigBuilder:
    def __init__(self) -> None:
        self._settings = get_settings()

    def _resolve_research_agent_root(self) -> Path:
        configured = _safe_text(self._settings.research_agent_root)
        if not configured:
            raise RuntimeError("research_agent_root is not configured")
        root = _ensure_absolute(configured, base=BACKEND_DIR)
        if not root.exists():
            raise FileNotFoundError(f"ResearchAgent repo not found: {root}")
        return root

    def _resolve_python(self, research_agent_root: Path) -> Path:
        configured = _safe_text(self._settings.research_agent_python)
        if configured:
            python_path = _ensure_absolute(configured, base=research_agent_root)
            if python_path.exists():
                return python_path

        candidates = [
            default_research_agent_python(research_agent_root),
            Path(sys.executable).resolve(),
        ]

        for candidate in candidates:
            if candidate.exists():
                return candidate

        resolved = shutil.which("python") or shutil.which("python3")
        if resolved:
            return Path(resolved).resolve()

        raise FileNotFoundError("Unable to resolve a Python executable for ResearchAgent")

    def _resolve_base_config_path(self, research_agent_root: Path) -> Path:
        configured = _safe_text(self._settings.research_agent_config_path)
        if configured:
            config_path = _ensure_absolute(configured, base=research_agent_root)
        else:
            config_path = research_agent_root / "src" / "config" / "default.yaml"

        if not config_path.exists():
            raise FileNotFoundError(f"ResearchAgent config not found: {config_path}")
        return config_path

    @staticmethod
    def _resolve_adapter_path(research_agent_root: Path, relative_path: str) -> Path:
        adapter_path = (research_agent_root / relative_path).resolve()
        if not adapter_path.exists():
            raise FileNotFoundError(f"ResearchAgent adapter not found: {adapter_path}")
        return adapter_path

    def _resolve_runs_root(self) -> Path:
        configured = _safe_text(self._settings.research_agent_runs_root) or "data/research_runs"
        return _ensure_absolute(configured, base=BACKEND_DIR)

    @staticmethod
    def _build_topic_text(topic: dict[str, Any]) -> str:
        title = _safe_text(topic.get("title") or topic.get("name"))
        if not title:
            raise ValueError("Topic title is required")
        return title

    @staticmethod
    def _build_free_text(topic: dict[str, Any]) -> tuple[str, str, str]:
        description = _safe_text(topic.get("description"))
        objective = _safe_text(topic.get("objective"))
        combined = "\n\n".join(part for part in (description, objective) if part)
        return combined, objective, description

    def build(
        self,
        *,
        topic: dict[str, Any],
        run_id: str,
        run_config: RunConfig,
    ) -> ResearchAgentRuntime:
        research_agent_root = self._resolve_research_agent_root()
        python_executable = self._resolve_python(research_agent_root)
        base_config_path = self._resolve_base_config_path(research_agent_root)
        runs_root = self._resolve_runs_root()
        container_research_agent_root = Path(
            _safe_text(self._settings.research_agent_container_code_dir) or "/workspace/ResearchAgent"
        )
        container_task_dir = Path(
            _safe_text(self._settings.research_agent_container_task_dir) or "/task"
        )
        container_python_executable = Path(
            _safe_text(self._settings.research_agent_container_python)
            or "/workspace/miniconda/envs/xcientist/bin/python"
        )

        run_dir = (runs_root / run_id).resolve()
        config_dir = run_dir / "config"
        logs_dir = run_dir / "logs"
        survey_output_dir = run_dir / "survey" / "output"
        idea_output_root = run_dir / "idea"
        experiment_workspace_dir = run_dir
        shared_dir = run_dir / "shared"

        for directory in (
            config_dir,
            logs_dir,
            survey_output_dir,
            idea_output_root,
            experiment_workspace_dir,
            shared_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

        runtime_config = deepcopy(
            yaml.safe_load(base_config_path.read_text(encoding="utf-8")) or {}
        )

        topic_text = self._build_topic_text(topic)
        input_text, mature_idea, refinement_scope = self._build_free_text(topic)

        runtime_config.setdefault("workspace", {})
        runtime_config["workspace"]["root"] = str(container_task_dir)

        runtime_config.setdefault("survey", {}).setdefault("BasicInfo", {})
        runtime_config["survey"]["BasicInfo"]["topic"] = topic_text
        runtime_config["survey"]["BasicInfo"]["base_dir"] = str(container_task_dir / "survey" / "output")
        runtime_config["survey"]["BasicInfo"]["cache_path"] = str(container_task_dir / "survey" / "output" / "database")
        runtime_config["survey"]["BasicInfo"]["save_path"] = str(container_task_dir / "survey" / "output" / "survey.md")
        runtime_config["survey"]["BasicInfo"]["save_json_path"] = str(container_task_dir / "survey" / "output" / "survey.json")
        runtime_config["survey"]["BasicInfo"]["evaluation_save_path"] = str(
            container_task_dir / "survey" / "output" / "evaluation.txt"
        )

        runtime_config.setdefault("idea", {})
        runtime_config["idea"]["input"] = input_text
        runtime_config["idea"]["topic"] = topic_text
        runtime_config["idea"]["mature_idea"] = mature_idea
        runtime_config["idea"]["refinement_scope"] = refinement_scope
        runtime_config["idea"].setdefault("run", {})
        runtime_config["idea"]["run"]["input"] = input_text
        runtime_config["idea"]["run"]["topic"] = topic_text
        runtime_config["idea"]["run"]["mature_idea"] = mature_idea
        runtime_config["idea"]["run"]["refinement_scope"] = refinement_scope
        runtime_config["idea"]["run"]["ablation_results_path"] = ""
        runtime_config["idea"]["run"]["output_root"] = str(container_task_dir / "idea")
        runtime_config["idea"]["run"]["rag_config"] = str(container_task_dir / "config" / "runtime_full.yaml")

        ideation_cfg = run_config.modules.get("ideation")
        if ideation_cfg and ideation_cfg.idea_taste_mode:
            runtime_config["idea"].setdefault("mcts", {})
            runtime_config["idea"]["mcts"]["idea_taste_mode"] = ideation_cfg.idea_taste_mode.value

        runtime_config.setdefault("experiment", {}).setdefault("workspace", {})
        runtime_config["experiment"]["workspace"]["root"] = str(container_task_dir)
        runtime_config["experiment"].setdefault("memory", {})
        runtime_config["experiment"]["memory"]["shared_dir"] = str(container_task_dir / "shared")

        runtime_config.setdefault("paper", {}).setdefault("workspace", {})
        runtime_config["paper"]["workspace"]["root"] = str(container_task_dir / "paper")
        runtime_config["paper"]["workspace"]["experiment_root"] = str(container_task_dir)

        runtime_config.setdefault("pipeline", {})
        runtime_config["pipeline"]["name"] = run_id
        runtime_config["pipeline"]["skip_survey"] = not run_config.modules["review"].enabled
        runtime_config.setdefault("pipeline", {}).setdefault("iterate", {})
        runtime_config["pipeline"]["iterate"]["max_iterations"] = 1
        runtime_config.setdefault("pipeline", {}).setdefault("output", {})
        runtime_config["pipeline"]["output"]["root"] = str(container_task_dir / "pipeline")
        runtime_config["pipeline"]["output"]["resume_from_iteration"] = None

        runtime_config_path = config_dir / "runtime_full.yaml"
        runtime_config_path.write_text(
            yaml.safe_dump(runtime_config, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

        survey_runtime_config = deepcopy(runtime_config.get("survey", {}) or {})
        survey_runtime_config_path = config_dir / "runtime.yaml"
        survey_runtime_config_path.write_text(
            yaml.safe_dump(survey_runtime_config, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

        survey_adapter_path = self._resolve_adapter_path(
            research_agent_root,
            "src/agents/survey_agent/scripts/run_deep_survey_adapter.py",
        )
        idea_adapter_path = self._resolve_adapter_path(
            research_agent_root,
            "src/agents/idea_agent/run_idea_adapter.py",
        )
        experiment_adapter_path = self._resolve_adapter_path(
            research_agent_root,
            "src/agents/experiment_agent/experiment_adapter.py",
        )

        container_runtime_config_path = container_task_dir / "config" / "runtime_full.yaml"
        container_survey_runtime_config_path = container_task_dir / "config" / "runtime.yaml"
        container_survey_adapter_path = container_research_agent_root / "src" / "agents" / "survey_agent" / "scripts" / "run_deep_survey_adapter.py"
        container_idea_adapter_path = container_research_agent_root / "src" / "agents" / "idea_agent" / "run_idea_adapter.py"
        container_experiment_adapter_path = container_research_agent_root / "src" / "agents" / "experiment_agent" / "experiment_adapter.py"

        survey_model = str(
            runtime_config.get("survey", {}).get("APIInfo", {}).get("llm_model_name", "survey")
        )
        idea_model = str(
            runtime_config.get("idea", {}).get("agent", {}).get("model", "idea")
        )
        experiment_model = str(
            runtime_config.get("experiment", {}).get("models", {}).get("default", "experiment")
        )

        return ResearchAgentRuntime(
            research_agent_root=research_agent_root,
            python_executable=python_executable,
            container_research_agent_root=container_research_agent_root,
            container_task_dir=container_task_dir,
            container_python_executable=container_python_executable,
            base_config_path=base_config_path,
            runtime_config_path=runtime_config_path,
            survey_runtime_config_path=survey_runtime_config_path,
            container_runtime_config_path=container_runtime_config_path,
            container_survey_runtime_config_path=container_survey_runtime_config_path,
            run_dir=run_dir,
            config_dir=config_dir,
            logs_dir=logs_dir,
            survey_output_dir=survey_output_dir,
            idea_output_root=idea_output_root,
            experiment_workspace_dir=experiment_workspace_dir,
            shared_dir=shared_dir,
            survey_adapter_path=survey_adapter_path,
            idea_adapter_path=idea_adapter_path,
            experiment_adapter_path=experiment_adapter_path,
            container_survey_adapter_path=container_survey_adapter_path,
            container_idea_adapter_path=container_idea_adapter_path,
            container_experiment_adapter_path=container_experiment_adapter_path,
            topic_text=topic_text,
            input_text=input_text,
            mature_idea=mature_idea,
            refinement_scope=refinement_scope,
            survey_model=survey_model,
            idea_model=idea_model,
            experiment_model=experiment_model,
        )
