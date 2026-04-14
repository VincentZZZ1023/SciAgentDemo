from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.models.schemas import RunConfig


DEFAULT_RUN_CONFIG: dict[str, Any] = {
    "thinkingMode": "quick",
    "online": True,
    "presetName": "full-demo",
    "selectedAgents": ["review", "ideation", "experiment"],
    "modules": {
        "review": {
            "enabled": True,
            "model": "deepseek-chat",
            "requireHuman": False,
        },
        "ideation": {
            "enabled": True,
            "model": "deepseek-chat",
            "requireHuman": False,
            "idea_taste_mode": "evidence_first",
        },
        "experiment": {
            "enabled": True,
            "model": "deepseek-chat",
            "requireHuman": False,
        },
    },
}


def get_default_run_config() -> RunConfig:
    return RunConfig.model_validate(deepcopy(DEFAULT_RUN_CONFIG))
