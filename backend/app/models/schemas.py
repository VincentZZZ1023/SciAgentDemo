from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class AgentId(str, Enum):
    review = "review"
    ideation = "ideation"
    experiment = "experiment"


class IdeaTasteMode(str, Enum):
    moonshot_inventor = "moonshot_inventor"
    bridge_builder = "bridge_builder"
    steady_engineer = "steady_engineer"
    ambitious_realist = "ambitious_realist"
    evidence_first = "evidence_first"


class EventKind(str, Enum):
    agent_status_updated = "agent_status_updated"
    event_emitted = "event_emitted"
    artifact_created = "artifact_created"
    message_created = "message_created"
    agent_subtasks_updated = "agent_subtasks_updated"
    module_started = "module_started"
    module_finished = "module_finished"
    module_skipped = "module_skipped"
    module_failed = "module_failed"
    approval_required = "approval_required"
    approval_resolved = "approval_resolved"
    admin_metrics = "admin_metrics"


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


class TraceItemKind(str, Enum):
    message = "message"
    artifact = "artifact"
    status = "status"
    event = "event"


class TraceItem(BaseModel):
    id: str = Field(min_length=1)
    ts: int = Field(ge=0)
    agentId: AgentId
    kind: TraceItemKind
    summary: str = Field(min_length=1)
    payload: dict[str, Any] | None = None


class TraceResponse(BaseModel):
    topicId: str
    runId: str | None = None
    items: list[TraceItem] = Field(default_factory=list)


class UserRole(str, Enum):
    user = "user"
    admin = "admin"


class LoginRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str

    @model_validator(mode="after")
    def validate_login(self) -> "LoginRequest":
        login = (self.username or self.email or "").strip()
        if not login:
            raise ValueError("username or email is required")
        if not self.password:
            raise ValueError("password is required")
        self.username = login
        if self.email is not None:
            self.email = self.email.strip() or None
        return self


class RegisterRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str

    @model_validator(mode="after")
    def validate_register(self) -> "RegisterRequest":
        username = (self.username or self.email or "").strip()
        if not username:
            raise ValueError("username or email is required")
        if not self.password or len(self.password) < 4:
            raise ValueError("password must be at least 4 characters")
        self.username = username
        if self.email is None:
            self.email = username
        if self.email is not None:
            self.email = self.email.strip() or None
        return self


class AuthUser(BaseModel):
    id: str
    email: str
    role: UserRole


class AuthTokenResponse(BaseModel):
    token: str
    user: AuthUser
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int
    role: UserRole | None = None

    @model_validator(mode="after")
    def align_compat_fields(self) -> "AuthTokenResponse":
        if not self.access_token:
            self.access_token = self.token
        if self.role is None:
            self.role = self.user.role
        return self


class AuthMeResponse(BaseModel):
    id: str
    email: str
    username: str
    role: UserRole


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
    historyTitle: str | None = None
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


class SnapshotActiveRun(BaseModel):
    runId: str
    topicId: str
    historyTitle: str | None = None
    status: str
    currentModule: str | None = None
    awaitingApproval: bool = False
    awaitingModule: str | None = None
    createdAt: int
    startedAt: int | None = None
    endedAt: int | None = None
    approvalResolvedAt: int | None = None
    config: RunConfig | None = None


class SnapshotResponse(BaseModel):
    topic: TopicDetail
    agents: list[AgentSnapshot]
    events: list[Event]
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    activeRun: SnapshotActiveRun | None = None


class ModuleConfig(BaseModel):
    enabled: bool = True
    model: str = "deepseek-chat"
    requireHuman: bool = False
    idea_taste_mode: IdeaTasteMode | None = None


class RunConfig(BaseModel):
    thinkingMode: str = Field(default="quick", pattern="^(normal|quick|deep|pro)$")
    online: bool = True
    presetName: str = "default"
    selectedAgents: list[AgentId] = Field(default_factory=list)
    modules: dict[str, ModuleConfig] = Field(
        default_factory=lambda: {
            AgentId.review.value: ModuleConfig(),
            AgentId.ideation.value: ModuleConfig(idea_taste_mode=IdeaTasteMode.evidence_first),
            AgentId.experiment.value: ModuleConfig(),
        }
    )

    @staticmethod
    def _infer_preset_name(selected_agents: list[AgentId], thinking_mode: str) -> str:
        enabled = [agent.value for agent in selected_agents]
        if enabled == [AgentId.review.value]:
            base = "survey-only"
        elif enabled == [AgentId.ideation.value]:
            base = "idea-only"
        elif enabled == [AgentId.experiment.value]:
            base = "experiment-only"
        elif enabled == [AgentId.review.value, AgentId.ideation.value]:
            base = "survey-idea"
        elif enabled == [AgentId.ideation.value, AgentId.experiment.value]:
            base = "idea-experiment"
        elif enabled == [AgentId.review.value, AgentId.ideation.value, AgentId.experiment.value]:
            base = "full-demo"
        else:
            base = "custom"

        if thinking_mode in {"deep", "pro"}:
            return f"{base}-{thinking_mode}"
        return base

    @model_validator(mode="after")
    def validate_modules(self) -> "RunConfig":
        required_keys = {AgentId.review.value, AgentId.ideation.value, AgentId.experiment.value}
        if set(self.modules.keys()) != required_keys:
            raise ValueError("modules must contain exactly review/ideation/experiment")

        if self.thinkingMode == "normal":
            self.thinkingMode = "quick"

        if self.selectedAgents:
            selected_agents: list[AgentId] = []
            seen_agents: set[AgentId] = set()
            for agent in self.selectedAgents:
                if agent in seen_agents:
                    continue
                selected_agents.append(agent)
                seen_agents.add(agent)
        else:
            selected_agents = [
                AgentId(agent_id)
                for agent_id in (AgentId.review.value, AgentId.ideation.value, AgentId.experiment.value)
                if self.modules[agent_id].enabled
            ]

        enabled_agents = {agent.value for agent in selected_agents}
        for agent_id in required_keys:
            self.modules[agent_id].enabled = agent_id in enabled_agents if self.selectedAgents else self.modules[agent_id].enabled

        self.selectedAgents = selected_agents
        self.modules[AgentId.review.value].idea_taste_mode = None
        self.modules[AgentId.experiment.value].idea_taste_mode = None

        if self.modules[AgentId.ideation.value].enabled:
            if self.modules[AgentId.ideation.value].idea_taste_mode is None:
                self.modules[AgentId.ideation.value].idea_taste_mode = IdeaTasteMode.evidence_first
        else:
            self.modules[AgentId.ideation.value].idea_taste_mode = None

        if not any(self.modules[agent_id].enabled for agent_id in required_keys):
            raise ValueError("at least one module must be enabled")

        normalized_preset = self.presetName.strip() if isinstance(self.presetName, str) else ""
        if not normalized_preset or normalized_preset == "default":
            self.presetName = self._infer_preset_name(self.selectedAgents, self.thinkingMode)
        else:
            self.presetName = normalized_preset

        return self


class RunCreateRequest(BaseModel):
    trigger: str = "manual"
    initiator: str = "user"
    note: str | None = None
    prompt: str = ""
    config: RunConfig | None = None


class RunCreateResponse(BaseModel):
    runId: str
    topicId: str
    historyTitle: str | None = None
    status: str
    createdAt: int
    startedAt: int | None = None
    endedAt: int | None = None
    currentModule: str | None = None
    awaitingApproval: bool | None = None
    awaitingModule: str | None = None
    approvalResolvedAt: int | None = None
    config: RunConfig | None = None


class RunApproveRequest(BaseModel):
    module: AgentId
    approved: bool
    note: str | None = None

    @model_validator(mode="after")
    def validate_note(self) -> "RunApproveRequest":
        if self.note is not None:
            note = self.note.strip()
            self.note = note or None
        return self


class RunApproveResponse(BaseModel):
    ok: bool
    noOp: bool = False
    alreadyResolved: bool = False
    detail: str | None = None


class RunDetailResponse(BaseModel):
    runId: str
    topicId: str
    historyTitle: str | None = None
    status: str
    createdAt: int
    startedAt: int | None = None
    endedAt: int | None = None
    currentModule: str | None = None
    awaitingApproval: bool = False
    awaitingModule: str | None = None
    approvalResolvedAt: int | None = None
    config: RunConfig | None = None


class AdminSeriesPoint(BaseModel):
    t: int = Field(ge=0)
    count: int = Field(ge=0)


class PendingApprovalItem(BaseModel):
    topicId: str
    runId: str
    awaitingModule: str | None = None
    updatedAt: int = Field(ge=0)


class RecentErrorItem(BaseModel):
    ts: int = Field(ge=0)
    runId: str
    module: str
    message: str


class AdminOverviewResponse(BaseModel):
    ts: int
    activeRuns: int = Field(ge=0)
    runsLast5m: int = Field(ge=0)
    eventsLast5m: int = Field(ge=0)
    moduleInFlight: dict[str, int]
    approvalsPending: int = Field(ge=0)
    errorRateLast5m: float = Field(ge=0.0, le=1.0)
    eventsSeries: list[AdminSeriesPoint] = Field(default_factory=list)
    errorSeries: list[AdminSeriesPoint] = Field(default_factory=list)
    pendingApprovals: list[PendingApprovalItem] = Field(default_factory=list)
    recentErrors: list[RecentErrorItem] = Field(default_factory=list)


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
