from __future__ import annotations

from functools import lru_cache
from os import name as os_name
from pathlib import Path

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent

for env_path in (PROJECT_ROOT / ".env", BACKEND_DIR / ".env"):
    if env_path.exists():
        load_dotenv(env_path, override=False)


class Settings(BaseSettings):
    jwt_secret: str = "dev-jwt-secret-change-me"
    access_token_expire_minutes: int = 60
    backend_base_url: str = "http://localhost:8000"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://0.0.0.0:5173",
    ]

    database_url: str = "postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent"
    artifacts_root: str = "data/artifacts"
    research_agent_root: str = str((PROJECT_ROOT.parent / "ResearchAgent" / "ResearchAgent").resolve())
    research_agent_config_path: str = ""
    research_agent_python: str = ""
    research_agent_runs_root: str = "data/research_runs"

    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_seconds: float = 120.0
    deepseek_max_retries: int = 1
    deepseek_retry_backoff_seconds: float = 1.5

    admin_email: str = "admin"
    admin_password: str = "admin"
    demo_email: str = "demo"
    demo_password: str = "demo"

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return value
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @field_validator(
        "artifacts_root",
        "research_agent_root",
        "research_agent_config_path",
        "research_agent_python",
        "research_agent_runs_root",
        mode="before",
    )
    @classmethod
    def normalize_optional_paths(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


def default_research_agent_python(root: Path) -> Path:
    if os_name == "nt":
        return root / ".venv" / "Scripts" / "python.exe"
    return root / ".venv" / "bin" / "python"


@lru_cache
def get_settings() -> Settings:
    return Settings()
