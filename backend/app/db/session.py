from __future__ import annotations

from sqlalchemy.orm import sessionmaker
from sqlmodel import Session, create_engine

from app.core.config import get_settings


def _resolve_database_url() -> str:
    settings = get_settings()
    database_url = settings.database_url

    if database_url.startswith("sqlite"):
        raise RuntimeError(
            "SQLite is no longer supported. Set DATABASE_URL to PostgreSQL, "
            "for example: postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent"
        )

    if database_url.startswith("postgresql"):
        return database_url

    raise RuntimeError(
        f"Unsupported DATABASE_URL dialect: {database_url!r}. Only PostgreSQL is supported."
    )


DATABASE_URL = _resolve_database_url()

ENGINE = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=ENGINE,
    class_=Session,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)
