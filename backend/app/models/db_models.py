from __future__ import annotations

from sqlmodel import Field, SQLModel


class TopicTable(SQLModel, table=True):
    __tablename__ = "topics"

    id: str = Field(primary_key=True, index=True)
    name: str = Field(index=True)
    description: str = ""
    objective: str = ""
    tags_json: str = "[]"
    status: str = "active"
    created_at: int = Field(index=True)
    updated_at: int = Field(index=True)


class RunTable(SQLModel, table=True):
    __tablename__ = "runs"

    id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    status: str = Field(index=True)
    started_at: int = Field(index=True)
    ended_at: int | None = Field(default=None, index=True)


class EventTable(SQLModel, table=True):
    __tablename__ = "events"

    event_id: str = Field(primary_key=True, index=True)
    topic_id: str = Field(foreign_key="topics.id", index=True)
    run_id: str = Field(index=True)
    agent_id: str = Field(index=True)
    kind: str = Field(index=True)
    severity: str = Field(index=True)
    ts: int = Field(index=True)
    summary: str
    payload_json: str | None = None
    artifacts_json: str | None = None
    trace_id: str | None = Field(default=None, index=True)


class ArtifactTable(SQLModel, table=True):
    __tablename__ = "artifacts"

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
