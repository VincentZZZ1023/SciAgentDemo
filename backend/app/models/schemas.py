from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class AgentId(str, Enum):
    review = "review"
    ideation = "ideation"
    experiment = "experiment"


class EventKind(str, Enum):
    agent_status_updated = "agent_status_updated"
    event_emitted = "event_emitted"
    artifact_created = "artifact_created"
    message_created = "message_created"


class Severity(str, Enum):
    info = "info"
    warn = "warn"
    error = "error"


class ArtifactRef(BaseModel):
    artifactId: str = Field(min_length=1)
    name: str = Field(min_length=1)
    uri: str = Field(min_length=1)
    contentType: str = Field(min_length=1)


class Event(BaseModel):
    eventId: str = Field(min_length=8)
    ts: int = Field(ge=0)
    topicId: str = Field(min_length=1)
    runId: str = Field(min_length=1)
    agentId: AgentId
    kind: EventKind
    severity: Severity
    summary: str = Field(min_length=1)
    payload: dict[str, Any] | None = None
    artifacts: list[ArtifactRef] | None = None
    traceId: str | None = None

    @model_validator(mode="after")
    def validate_artifact_requirement(self) -> "Event":
        if self.kind == EventKind.artifact_created and not self.artifacts:
            raise ValueError("artifacts is required when kind=artifact_created")
        return self


class MessageRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class Message(BaseModel):
    messageId: str = Field(min_length=8)
    topicId: str = Field(min_length=1)
    runId: str | None = None
    agentId: AgentId
    role: MessageRole
    content: str = Field(min_length=1)
    ts: int = Field(ge=0)


class MessageListResponse(BaseModel):
    messages: list[Message] = Field(default_factory=list)


class MessageCreateRequest(BaseModel):
    content: str

    @model_validator(mode="after")
    def validate_content(self) -> "MessageCreateRequest":
        if not self.content or not self.content.strip():
            raise ValueError("content is required")
        self.content = self.content.strip()
        return self


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class AuthMeResponse(BaseModel):
    username: str


class TopicCreateRequest(BaseModel):
    title: str | None = None
    name: str | None = None
    description: str = ""
    objective: str = ""
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_name(self) -> "TopicCreateRequest":
        if not self.title and not self.name:
            raise ValueError("title or name is required")
        return self

    @property
    def resolved_title(self) -> str:
        return (self.title or self.name or "").strip()


class TopicSummary(BaseModel):
    topicId: str
    title: str
    status: str
    createdAt: int
    updatedAt: int
    lastRunId: str | None = None
    id: str | None = None
    name: str | None = None


class TopicListResponse(BaseModel):
    items: list[TopicSummary]
    total: int


class TopicDetail(TopicSummary):
    description: str = ""
    objective: str = ""
    tags: list[str] = Field(default_factory=list)
    activeRunId: str | None = None


class AgentSnapshot(BaseModel):
    agentId: AgentId
    status: str
    progress: float = Field(ge=0.0, le=1.0)
    lastUpdate: int
    runId: str | None = None
    lastSummary: str | None = None
    state: str | None = None
    updatedAt: int | None = None


class SnapshotResponse(BaseModel):
    topic: TopicDetail
    agents: list[AgentSnapshot]
    events: list[Event]
    artifacts: list[ArtifactRef] = Field(default_factory=list)


class RunCreateRequest(BaseModel):
    trigger: str = "manual"
    initiator: str = "user"
    note: str | None = None


class RunCreateResponse(BaseModel):
    runId: str
    topicId: str
    status: str
    createdAt: int
    startedAt: int | None = None


class AgentCommandRequest(BaseModel):
    text: str | None = None
    command: str | None = None
    runId: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_content(self) -> "AgentCommandRequest":
        if not self.text and not self.command:
            raise ValueError("text or command is required")
        return self


class AgentCommandResponse(BaseModel):
    ok: bool
    accepted: bool
    commandId: str
    topicId: str
    agentId: AgentId
    runId: str
    queuedAt: int


class HealthResponse(BaseModel):
    status: str
