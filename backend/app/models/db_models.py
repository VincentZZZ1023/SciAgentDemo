from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Column, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

JSONType = JSON().with_variant(JSONB(), "postgresql")


class TopicTable(SQLModel, table=True):
    __tablename__ = "topics"

    id: str = Field(primary_key=True, index=True)
    name: str = Field(index=True)
    history_title: str | None = Field(default=None, index=True)
    description: str = ""
    objective: str = ""
    tags_json: str = "[]"
    status: str = "active"
    created_at: int = Field(index=True)
    updated_at: int = Field(index=True)


class RunTable(SQLModel, table=True):
    __tablename__ = "runs"
    __table_args__ = (Index("ix_runs_topic_created_at", "topic_id", "created_at"),)

    id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    history_title: str | None = Field(default=None, index=True)
    status: str = Field(index=True)
    created_at: int = Field(index=True)
    started_at: int = Field(index=True)
    ended_at: int | None = Field(default=None, index=True)
    current_module: str | None = Field(default=None, index=True)
    awaiting_approval: bool = Field(default=False, index=True)
    awaiting_module: str | None = Field(default=None, index=True)
    approval_resolved_at: int | None = Field(default=None, index=True)
    config_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONType, nullable=False),
    )


class EventTable(SQLModel, table=True):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_topic_created_at", "topic_id", "created_at"),
        Index("ix_events_run_created_at", "run_id", "created_at"),
    )

    event_id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    run_id: str = Field(index=True)
    agent_id: str = Field(index=True)
    kind: str = Field(index=True)
    severity: str = Field(index=True)
    ts: int = Field(index=True)
    created_at: int = Field(index=True)
    summary: str
    payload_json: str | None = None
    artifacts_json: str | None = None
    trace_id: str | None = Field(default=None, index=True)


class ArtifactTable(SQLModel, table=True):
    __tablename__ = "artifacts"
    __table_args__ = (Index("ix_artifacts_topic_run", "topic_id", "run_id"),)

    artifact_id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    run_id: str = Field(index=True)
    name: str = Field(index=True)
    content_type: str
    path: str
    created_at: int = Field(index=True)


class MessageTable(SQLModel, table=True):
    __tablename__ = "messages"

    message_id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    run_id: str | None = Field(default=None, index=True)
    agent_id: str = Field(index=True)
    role: str = Field(index=True)
    content: str
    ts: int = Field(index=True)


class UserTable(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True, index=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: str = Field(index=True)
    created_at: int = Field(index=True)
