export const AGENT_IDS = ["review", "ideation", "experiment"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const EVENT_KINDS = [
  "agent_status_updated",
  "event_emitted",
  "artifact_created",
  "message_created",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const SEVERITIES = ["info", "warn", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Artifact {
  artifactId: string;
  name: string;
  uri: string;
  contentType: string;
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

export interface Message {
  messageId: string;
  topicId: string;
  runId?: string | null;
  agentId: AgentId;
  role: MessageRole;
  content: string;
  ts: number;
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
}

const agentSet = new Set<string>(AGENT_IDS);
const eventKindSet = new Set<string>(EVENT_KINDS);
const severitySet = new Set<string>(SEVERITIES);
const messageRoleSet = new Set<string>(MESSAGE_ROLES);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

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

  return typeof value.ts === "number" && Number.isFinite(value.ts) && value.ts >= 0;
};

export const isEvent = (value: unknown): value is Event => {
  if (!isObject(value)) {
    return false;
  }

  if (!isNonEmptyString(value.eventId)) {
    return false;
  }

  if (typeof value.ts !== "number" || !Number.isFinite(value.ts) || value.ts < 0) {
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
    if (!Array.isArray(value.artifacts)) {
      return false;
    }
    if (!value.artifacts.every(isArtifact)) {
      return false;
    }
  }

  if (value.kind === "artifact_created" && !Array.isArray(value.artifacts)) {
    return false;
  }

  if (value.kind === "message_created") {
    if (!isObject(value.payload)) {
      return false;
    }
    if (!isMessage(value.payload.message)) {
      return false;
    }
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
