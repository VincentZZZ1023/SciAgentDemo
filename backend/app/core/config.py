from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
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
    cors_origins: list[str] = ["http://localhost:5173"]

    database_url: str = "sqlite:///./data.db"
    artifacts_root: str = "data/artifacts"

    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_seconds: float = 120.0
    deepseek_max_retries: int = 1
    deepseek_retry_backoff_seconds: float = 1.5

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
