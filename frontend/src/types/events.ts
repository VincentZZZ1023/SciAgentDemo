import { IDEA_TASTE_MODES, type IdeaTasteMode } from "../lib/ideaPreference";

export const AGENT_IDS = ["review", "ideation", "experiment"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const EVENT_KINDS = [
  "agent_status_updated",
  "event_emitted",
  "artifact_created",
  "message_created",
  "agent_subtasks_updated",
  "module_started",
  "module_finished",
  "module_skipped",
  "module_failed",
  "approval_required",
  "approval_resolved",
  "admin_metrics",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const MODULE_EVENT_KINDS = [
  "module_started",
  "module_finished",
  "module_skipped",
  "module_failed",
] as const;
export type ModuleEventKind = (typeof MODULE_EVENT_KINDS)[number];

export const SEVERITIES = ["info", "warn", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const THINKING_MODES = ["quick", "deep", "pro", "normal"] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

export interface ModuleConfig {
  enabled: boolean;
  model: string;
  requireHuman: boolean;
  idea_taste_mode?: IdeaTasteMode;
}

export interface RunConfig {
  thinkingMode: ThinkingMode;
  online: boolean;
  presetName: string;
  selectedAgents?: AgentId[];
  modules: Record<AgentId, ModuleConfig>;
}

export interface Artifact {
  artifactId: string;
  name: string;
  uri: string;
  contentType: string;
}

export const SUBTASK_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type SubtaskStatus = (typeof SUBTASK_STATUSES)[number];

export interface AgentSubtask {
  id: string;
  name: string;
  status: SubtaskStatus;
  progress: number;
}

export interface Message {
  messageId: string;
  topicId: string;
  runId?: string | null;
  agentId: AgentId;
  role: MessageRole;
  content: string;
  ts: number;
}

export interface ModuleStartedPayload {
  runId: string;
  module: AgentId;
  model: string;
  thinkingMode: ThinkingMode;
  online: boolean;
  requestedModel?: string;
  fallbackUsed?: boolean;
}

export interface ModuleFinishedPayload {
  runId: string;
  module: AgentId;
  status: "success" | "failed" | "skipped";
  artifactNames: string[];
  metrics?: Record<string, unknown>;
}

export interface ModuleSkippedPayload {
  runId: string;
  module: AgentId;
  reason: string;
}

export interface ModuleFailedPayload {
  runId: string;
  module: AgentId;
  error: {
    message: string;
    code?: string;
  };
  retryable?: boolean;
}

export interface ApprovalRequiredPayload {
  runId: string;
  module: AgentId;
  summary: string;
  artifactName?: string;
  draftArtifact?: {
    name: string;
    mimeType?: string;
    sizeBytes?: number;
  };
}

export interface ApprovalResolvedPayload {
  runId: string;
  module: AgentId;
  approved: boolean;
  note?: string;
}

export interface AdminSeriesPoint {
  t: number;
  count: number;
}

export interface AdminPendingApproval {
  topicId: string;
  runId: string;
  awaitingModule?: string | null;
  updatedAt: number;
}

export interface AdminRecentError {
  ts: number;
  runId: string;
  module: string;
  message: string;
}

export interface AdminMetricsPayload {
  ts: number;
  activeRuns: number;
  runsLast5m: number;
  eventsLast5m: number;
  moduleInFlight: Record<string, number>;
  approvalsPending: number;
  errorRateLast5m: number;
  eventsSeries: AdminSeriesPoint[];
  errorSeries: AdminSeriesPoint[];
  pendingApprovals: AdminPendingApproval[];
  recentErrors: AdminRecentError[];
}

export interface Event {
  eventId: string;
  ts: number;
  topicId: string;
  runId: string;
  agentId: AgentId;
  kind: EventKind;
  severity: Severity;
  summary: string;
  payload?: Record<string, unknown>;
  artifacts?: Artifact[];
  traceId?: string;
}

export interface AgentStatus {
  agentId: AgentId;
  status: string;
  progress: number;
  lastUpdate: number;
  runId?: string | null;
  lastSummary?: string;
  state?: string;
  updatedAt?: number;
}

export interface TopicSummary {
  topicId: string;
  title: string;
  historyTitle?: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string | null;
  id?: string;
  name?: string;
}

export interface TopicDetail extends TopicSummary {
  description?: string;
  objective?: string;
  tags?: string[];
  activeRunId?: string | null;
}

export interface SnapshotResponse {
  topic: TopicDetail;
  agents: AgentStatus[];
  events: Event[];
  artifacts: Artifact[];
  activeRun?: {
    runId: string;
    topicId: string;
    historyTitle?: string | null;
    status: string;
    createdAt: number;
    startedAt?: number | null;
    endedAt?: number | null;
    currentModule?: string | null;
    awaitingApproval?: boolean;
    awaitingModule?: string | null;
    config?: RunConfig | null;
  } | null;
}

export interface RunDetail {
  runId: string;
  topicId: string;
  historyTitle?: string | null;
  status: string;
  createdAt: number;
  startedAt?: number | null;
  endedAt?: number | null;
  currentModule?: string | null;
  awaitingApproval?: boolean;
  awaitingModule?: string | null;
  config?: RunConfig | null;
}

export interface RunCreateResponse extends RunDetail {}

export const TRACE_ITEM_KINDS = ["message", "artifact", "status", "event"] as const;
export type TraceItemKind = (typeof TRACE_ITEM_KINDS)[number];

export interface TraceItem {
  id: string;
  ts: number;
  agentId: AgentId;
  kind: TraceItemKind;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface TraceResponse {
  topicId: string;
  runId?: string | null;
  items: TraceItem[];
}

const agentSet = new Set<string>(AGENT_IDS);
const eventKindSet = new Set<string>(EVENT_KINDS);
const severitySet = new Set<string>(SEVERITIES);
const messageRoleSet = new Set<string>(MESSAGE_ROLES);
const subtaskStatusSet = new Set<string>(SUBTASK_STATUSES);
const thinkingModeSet = new Set<string>(THINKING_MODES);
const ideaTasteModeSet = new Set<string>(IDEA_TASTE_MODES);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isArtifact = (value: unknown): value is Artifact => {
  if (!isObject(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.artifactId) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.uri) &&
    isNonEmptyString(value.contentType)
  );
};

export const isMessage = (value: unknown): value is Message => {
  if (!isObject(value)) {
    return false;
  }

  if (!isNonEmptyString(value.messageId)) {
    return false;
  }

  if (!isNonEmptyString(value.topicId)) {
    return false;
  }

  if (value.runId !== undefined && value.runId !== null && !isNonEmptyString(value.runId)) {
    return false;
  }

  if (typeof value.agentId !== "string" || !agentSet.has(value.agentId)) {
    return false;
  }

  if (typeof value.role !== "string" || !messageRoleSet.has(value.role)) {
    return false;
  }

  if (!isNonEmptyString(value.content)) {
    return false;
  }

  return isFiniteNumber(value.ts) && value.ts >= 0;
};

const isRunConfigModule = (value: unknown): value is ModuleConfig => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.enabled === "boolean" &&
    isNonEmptyString(value.model) &&
    typeof value.requireHuman === "boolean" &&
    (value.idea_taste_mode === undefined ||
      (typeof value.idea_taste_mode === "string" && ideaTasteModeSet.has(value.idea_taste_mode)))
  );
};

export const isRunConfig = (value: unknown): value is RunConfig => {
  if (!isObject(value)) {
    return false;
  }

  if (typeof value.thinkingMode !== "string" || !thinkingModeSet.has(value.thinkingMode)) {
    return false;
  }

  if (typeof value.online !== "boolean") {
    return false;
  }

  if (!isNonEmptyString(value.presetName)) {
    return false;
  }

  if (
    value.selectedAgents !== undefined &&
    (!Array.isArray(value.selectedAgents) ||
      !value.selectedAgents.every((agentId) => typeof agentId === "string" && agentSet.has(agentId)))
  ) {
    return false;
  }

  if (!isObject(value.modules)) {
    return false;
  }

  const modules = value.modules as Record<string, unknown>;
  return AGENT_IDS.every((agentId) => isRunConfigModule(modules[agentId]));
};

export const isAgentSubtask = (value: unknown): value is AgentSubtask => {
  if (!isObject(value)) {
    return false;
  }

  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    return false;
  }

  if (typeof value.status !== "string" || !subtaskStatusSet.has(value.status)) {
    return false;
  }

  return isFiniteNumber(value.progress) && value.progress >= 0 && value.progress <= 1;
};

const isModuleStartedPayload = (payload: unknown): payload is ModuleStartedPayload => {
  if (!isObject(payload)) {
    return false;
  }

  return (
    isNonEmptyString(payload.runId) &&
    typeof payload.module === "string" &&
    agentSet.has(payload.module) &&
    isNonEmptyString(payload.model) &&
    typeof payload.thinkingMode === "string" &&
    thinkingModeSet.has(payload.thinkingMode) &&
    typeof payload.online === "boolean"
  );
};

const isModuleFinishedPayload = (payload: unknown): payload is ModuleFinishedPayload => {
  if (!isObject(payload)) {
    return false;
  }

  if (
    !isNonEmptyString(payload.runId) ||
    typeof payload.module !== "string" ||
    !agentSet.has(payload.module)
  ) {
    return false;
  }

  if (
    typeof payload.status !== "string" ||
    !["success", "failed", "skipped"].includes(payload.status)
  ) {
    return false;
  }

  if (!Array.isArray(payload.artifactNames) || !payload.artifactNames.every(isNonEmptyString)) {
    return false;
  }

  if (payload.metrics !== undefined && !isObject(payload.metrics)) {
    return false;
  }

  return true;
};

const isModuleSkippedPayload = (payload: unknown): payload is ModuleSkippedPayload => {
  if (!isObject(payload)) {
    return false;
  }

  return (
    isNonEmptyString(payload.runId) &&
    typeof payload.module === "string" &&
    agentSet.has(payload.module) &&
    isNonEmptyString(payload.reason)
  );
};

const isModuleFailedPayload = (payload: unknown): payload is ModuleFailedPayload => {
  if (!isObject(payload)) {
    return false;
  }

  if (
    !isNonEmptyString(payload.runId) ||
    typeof payload.module !== "string" ||
    !agentSet.has(payload.module)
  ) {
    return false;
  }

  if (!isObject(payload.error) || !isNonEmptyString(payload.error.message)) {
    return false;
  }

  if (payload.error.code !== undefined && !isNonEmptyString(payload.error.code)) {
    return false;
  }

  if (payload.retryable !== undefined && typeof payload.retryable !== "boolean") {
    return false;
  }

  return true;
};

const isApprovalRequiredPayload = (payload: unknown): payload is ApprovalRequiredPayload => {
  if (!isObject(payload)) {
    return false;
  }

  if (
    !isNonEmptyString(payload.runId) ||
    typeof payload.module !== "string" ||
    !agentSet.has(payload.module) ||
    !isNonEmptyString(payload.summary)
  ) {
    return false;
  }

  if (payload.artifactName !== undefined && !isNonEmptyString(payload.artifactName)) {
    return false;
  }

  if (payload.draftArtifact !== undefined) {
    if (!isObject(payload.draftArtifact) || !isNonEmptyString(payload.draftArtifact.name)) {
      return false;
    }

    if (payload.draftArtifact.mimeType !== undefined && !isNonEmptyString(payload.draftArtifact.mimeType)) {
      return false;
    }

    if (payload.draftArtifact.sizeBytes !== undefined && !isFiniteNumber(payload.draftArtifact.sizeBytes)) {
      return false;
    }
  }

  return true;
};

const isApprovalResolvedPayload = (payload: unknown): payload is ApprovalResolvedPayload => {
  if (!isObject(payload)) {
    return false;
  }

  if (
    !isNonEmptyString(payload.runId) ||
    typeof payload.module !== "string" ||
    !agentSet.has(payload.module) ||
    typeof payload.approved !== "boolean"
  ) {
    return false;
  }

  if (payload.note !== undefined && !isNonEmptyString(payload.note)) {
    return false;
  }

  return true;
};

const isAdminMetricsPayload = (payload: unknown): payload is AdminMetricsPayload => {
  if (!isObject(payload)) {
    return false;
  }

  if (
    !isFiniteNumber(payload.ts) ||
    !isFiniteNumber(payload.activeRuns) ||
    !isFiniteNumber(payload.runsLast5m) ||
    !isFiniteNumber(payload.eventsLast5m) ||
    !isFiniteNumber(payload.approvalsPending) ||
    !isFiniteNumber(payload.errorRateLast5m)
  ) {
    return false;
  }

  if (!isObject(payload.moduleInFlight)) {
    return false;
  }

  const moduleInFlight = payload.moduleInFlight as Record<string, unknown>;
  if (!AGENT_IDS.every((agentId) => isFiniteNumber(moduleInFlight[agentId]))) {
    return false;
  }

  if (moduleInFlight.unknown !== undefined && !isFiniteNumber(moduleInFlight.unknown)) {
    return false;
  }

  const isSeriesPoint = (item: unknown): item is AdminSeriesPoint => {
    return isObject(item) && isFiniteNumber(item.t) && isFiniteNumber(item.count);
  };

  if (!Array.isArray(payload.eventsSeries) || !payload.eventsSeries.every(isSeriesPoint)) {
    return false;
  }

  if (!Array.isArray(payload.errorSeries) || !payload.errorSeries.every(isSeriesPoint)) {
    return false;
  }

  const isPendingApproval = (item: unknown): item is AdminPendingApproval => {
    if (!isObject(item)) {
      return false;
    }
    if (!isNonEmptyString(item.topicId) || !isNonEmptyString(item.runId) || !isFiniteNumber(item.updatedAt)) {
      return false;
    }
    if (item.awaitingModule !== undefined && item.awaitingModule !== null && !isNonEmptyString(item.awaitingModule)) {
      return false;
    }
    return true;
  };

  if (!Array.isArray(payload.pendingApprovals) || !payload.pendingApprovals.every(isPendingApproval)) {
    return false;
  }

  const isRecentError = (item: unknown): item is AdminRecentError => {
    return (
      isObject(item) &&
      isFiniteNumber(item.ts) &&
      isNonEmptyString(item.runId) &&
      isNonEmptyString(item.module) &&
      isNonEmptyString(item.message)
    );
  };

  if (!Array.isArray(payload.recentErrors) || !payload.recentErrors.every(isRecentError)) {
    return false;
  }

  return true;
};

export const isEvent = (value: unknown): value is Event => {
  if (!isObject(value)) {
    return false;
  }

  if (!isNonEmptyString(value.eventId)) {
    return false;
  }

  if (!isFiniteNumber(value.ts) || value.ts < 0) {
    return false;
  }

  if (!isNonEmptyString(value.topicId) || !isNonEmptyString(value.runId)) {
    return false;
  }

  if (typeof value.agentId !== "string" || !agentSet.has(value.agentId)) {
    return false;
  }

  if (typeof value.kind !== "string" || !eventKindSet.has(value.kind)) {
    return false;
  }

  if (typeof value.severity !== "string" || !severitySet.has(value.severity)) {
    return false;
  }

  if (!isNonEmptyString(value.summary)) {
    return false;
  }

  if (value.payload !== undefined && !isObject(value.payload)) {
    return false;
  }

  if (value.artifacts !== undefined) {
    if (!Array.isArray(value.artifacts) || !value.artifacts.every(isArtifact)) {
      return false;
    }
  }

  if (value.kind === "artifact_created" && !Array.isArray(value.artifacts)) {
    return false;
  }

  if (value.kind === "message_created") {
    if (!isObject(value.payload) || !isMessage(value.payload.message)) {
      return false;
    }
  }

  if (value.kind === "agent_subtasks_updated") {
    if (!isObject(value.payload)) {
      return false;
    }

    if (!Array.isArray(value.payload.subtasks) || !value.payload.subtasks.every(isAgentSubtask)) {
      return false;
    }

    if (!isFiniteNumber(value.payload.subtaskCount) || value.payload.subtaskCount < 0) {
      return false;
    }

    if (
      typeof value.payload.stage !== "string" ||
      !["review", "ideation", "experiment", "feedback"].includes(value.payload.stage)
    ) {
      return false;
    }
  }

  if (value.kind === "module_started" && !isModuleStartedPayload(value.payload)) {
    return false;
  }

  if (value.kind === "module_finished" && !isModuleFinishedPayload(value.payload)) {
    return false;
  }

  if (value.kind === "module_skipped" && !isModuleSkippedPayload(value.payload)) {
    return false;
  }

  if (value.kind === "module_failed" && !isModuleFailedPayload(value.payload)) {
    return false;
  }

  if (value.kind === "approval_required" && !isApprovalRequiredPayload(value.payload)) {
    return false;
  }

  if (value.kind === "approval_resolved" && !isApprovalResolvedPayload(value.payload)) {
    return false;
  }

  if (value.kind === "admin_metrics" && !isAdminMetricsPayload(value.payload)) {
    return false;
  }

  if (value.traceId !== undefined && typeof value.traceId !== "string") {
    return false;
  }

  return true;
};

export const parseWsEvent = (value: unknown): Event | null => {
  return isEvent(value) ? value : null;
};

export const parseMessageFromEvent = (event: Event): Message | null => {
  if (event.kind !== "message_created") {
    return null;
  }

  if (!event.payload || !isMessage(event.payload.message)) {
    return null;
  }

  return event.payload.message;
};

export const parseAgentSubtasksFromEvent = (event: Event): AgentSubtask[] | null => {
  if (event.kind !== "agent_subtasks_updated") {
    return null;
  }

  if (!event.payload || !Array.isArray(event.payload.subtasks)) {
    return null;
  }

  const subtasks = event.payload.subtasks.filter(isAgentSubtask);
  return subtasks.length > 0 ? subtasks : [];
};

export const parseModuleStartedPayload = (event: Event): ModuleStartedPayload | null => {
  if (event.kind !== "module_started") {
    return null;
  }
  return isModuleStartedPayload(event.payload) ? event.payload : null;
};

export const parseModuleFinishedPayload = (event: Event): ModuleFinishedPayload | null => {
  if (event.kind !== "module_finished") {
    return null;
  }
  return isModuleFinishedPayload(event.payload) ? event.payload : null;
};

export const parseModuleSkippedPayload = (event: Event): ModuleSkippedPayload | null => {
  if (event.kind !== "module_skipped") {
    return null;
  }
  return isModuleSkippedPayload(event.payload) ? event.payload : null;
};

export const parseModuleFailedPayload = (event: Event): ModuleFailedPayload | null => {
  if (event.kind !== "module_failed") {
    return null;
  }
  return isModuleFailedPayload(event.payload) ? event.payload : null;
};

export const parseApprovalRequiredPayload = (event: Event): ApprovalRequiredPayload | null => {
  if (event.kind !== "approval_required") {
    return null;
  }
  return isApprovalRequiredPayload(event.payload) ? event.payload : null;
};

export const parseApprovalResolvedPayload = (event: Event): ApprovalResolvedPayload | null => {
  if (event.kind !== "approval_resolved") {
    return null;
  }
  return isApprovalResolvedPayload(event.payload) ? event.payload : null;
};

export const parseAdminMetricsFromEvent = (event: Event): AdminMetricsPayload | null => {
  if (event.kind !== "admin_metrics") {
    return null;
  }
  return isAdminMetricsPayload(event.payload) ? event.payload : null;
};

export const mapEventToTraceItems = (event: Event): TraceItem[] => {
  if (event.kind === "message_created") {
    const message = parseMessageFromEvent(event);
    if (!message) {
      return [];
    }

    return [
      {
        id: `msg-${message.messageId}`,
        ts: message.ts,
        agentId: message.agentId,
        kind: "message",
        summary: `${message.role}: ${message.content.slice(0, 120)}`,
        payload: { message },
      },
    ];
  }

  if (event.kind === "artifact_created") {
    if (Array.isArray(event.artifacts) && event.artifacts.length > 0) {
      return event.artifacts.map((artifact, index) => ({
        id: `artifact-${artifact.artifactId || `${event.eventId}-${index}`}`,
        ts: event.ts,
        agentId: event.agentId,
        kind: "artifact",
        summary: `artifact: ${artifact.name}`,
        payload: {
          ...(event.payload ?? {}),
          artifact,
          eventSummary: event.summary,
        },
      }));
    }

    return [
      {
        id: `artifact-${event.eventId}`,
        ts: event.ts,
        agentId: event.agentId,
        kind: "artifact",
        summary: event.summary,
        payload: event.payload,
      },
    ];
  }

  if (event.kind === "agent_status_updated") {
    return [
      {
        id: `status-${event.eventId}`,
        ts: event.ts,
        agentId: event.agentId,
        kind: "status",
        summary: event.summary,
        payload: event.payload,
      },
    ];
  }

  if (event.kind === "event_emitted") {
    return [
      {
        id: `event-${event.eventId}`,
        ts: event.ts,
        agentId: event.agentId,
        kind: "event",
        summary: event.summary,
        payload: event.payload,
      },
    ];
  }

  if (
    event.kind === "agent_subtasks_updated" ||
    event.kind === "module_started" ||
    event.kind === "module_finished" ||
    event.kind === "module_skipped" ||
    event.kind === "module_failed" ||
    event.kind === "approval_required" ||
    event.kind === "approval_resolved"
  ) {
    return [
      {
        id: `event-${event.eventId}`,
        ts: event.ts,
        agentId: event.agentId,
        kind: "event",
        summary: event.summary,
        payload: event.payload,
      },
    ];
  }

  return [];
};
