import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArtifactContent } from "../../api/client";
import { ArtifactContentView } from "../artifact/ArtifactContentView";
import { type ConversationSegment } from "../../lib/conversationThread";
import { APP_COPY, formatAgentLabel as copyFormatAgentLabel, formatAgentTitle } from "../../lib/copy";
import {
  parseApprovalRequiredPayload,
  parseApprovalResolvedPayload,
  parseModuleFailedPayload,
  parseModuleFinishedPayload,
  parseModuleSkippedPayload,
  parseModuleStartedPayload,
  type AgentId,
  type Artifact,
  type Event,
} from "../../types/events";

type StreamItem =
  | {
      id: string;
      ts: number;
      sourceRunId: string | null;
      type: "user";
      text: string;
    }
  | {
      id: string;
      ts: number;
      sourceRunId: string | null;
      type: "status";
      label: string;
      text: string;
      tone: ChatLifecycleTone;
    }
  | {
      id: string;
      ts: number;
      sourceRunId: string | null;
      type: "assistant";
      fallbackText: string;
      agentId: AgentId;
      artifacts: Artifact[];
      primaryArtifact: Artifact | null;
      thinkingSteps: string[];
    }
  | {
      id: string;
      ts: number;
      sourceRunId: string | null;
      type: "error";
      text: string;
      agentId: AgentId;
      kind: string;
      severity: string;
    }
  | {
      id: string;
      ts: number;
      sourceRunId: string | null;
      type: "approval";
      text: string;
      agentId: AgentId;
      module: AgentId;
      actionable: boolean;
    };

interface RunMessageStreamProps {
  segments?: ConversationSegment[];
  taskPrompt: string;
  events: Event[];
  awaitingModule: AgentId | null;
  approvalSummary: string | null;
  approvalNote: string;
  approving: boolean;
  runError: string;
  runStatus: string;
  embedded?: boolean;
  onApprovalNoteChange: (value: string) => void;
  onApprove: (approved: boolean) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);
const SUCCESS_RUN_STATUSES = new Set(["succeeded", "completed", "done", "success"]);
const FAILED_RUN_STATUSES = new Set(["failed", "canceled"]);
const ARTIFACT_PREVIEW_CONCURRENCY = 2;

const artifactPreviewCache = new Map<string, ArtifactPreviewState>();
const artifactPreviewRequests = new Map<string, Promise<ArtifactPreviewState>>();

type ChatLifecycleTone = "neutral" | "info" | "success" | "danger";

interface ChatLifecycleState {
  key: string;
  label: string;
  hint: string;
  tone: ChatLifecycleTone;
}

interface RenderTarget {
  itemId: string;
  content: string;
  sourceKey: string;
  mode: "none" | "text" | "markdown";
  shouldStream: boolean;
}

interface RenderState {
  sourceKey: string;
  contentLength: number;
  renderedLength: number;
  isComplete: boolean;
}

interface ArtifactPreviewState {
  state: "loading" | "loaded" | "error";
  content: string;
  contentType: string;
}

interface ActorMeta {
  name: string;
  tag: string;
  avatar: string;
  className: string;
}

const formatEventTime = (ts: number): string => new Date(ts).toLocaleString();

const formatAgentLabel = (agentId: AgentId): string => copyFormatAgentLabel(agentId);

const getAgentMeta = (agentId: AgentId): ActorMeta => {
  if (agentId === "review") {
    return {
      name: APP_COPY.stream.reviewName,
      tag: formatAgentLabel("review"),
      avatar: "R",
      className: "review",
    };
  }

  if (agentId === "ideation") {
    return {
      name: APP_COPY.stream.ideationName,
      tag: formatAgentLabel("ideation"),
      avatar: "I",
      className: "ideation",
    };
  }

  return {
    name: APP_COPY.stream.experimentName,
    tag: formatAgentLabel("experiment"),
    avatar: "E",
    className: "experiment",
  };
};

const getArtifactPreviewKey = (artifact: Artifact): string => artifact.artifactId || artifact.uri;

const sameArtifactPreviewState = (
  left: ArtifactPreviewState | undefined,
  right: ArtifactPreviewState,
): boolean => {
  if (!left) {
    return false;
  }

  return (
    left.state === right.state &&
    left.content === right.content &&
    left.contentType === right.contentType
  );
};

const getCachedArtifactPreview = (artifact: Artifact): ArtifactPreviewState | null => {
  return artifactPreviewCache.get(getArtifactPreviewKey(artifact)) ?? null;
};

const loadArtifactPreview = async (artifact: Artifact): Promise<ArtifactPreviewState> => {
  const key = getArtifactPreviewKey(artifact);
  const cached = artifactPreviewCache.get(key);
  if (cached) {
    return cached;
  }

  const existingRequest = artifactPreviewRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = fetchArtifactContent(artifact.uri)
    .then((loaded) => {
      const result: ArtifactPreviewState = {
        state: "loaded",
        content: loaded.content,
        contentType: loaded.contentType,
      };
      artifactPreviewCache.set(key, result);
      artifactPreviewRequests.delete(key);
      return result;
    })
    .catch(() => {
      artifactPreviewRequests.delete(key);
      return {
        state: "error",
        content: "",
        contentType: artifact.contentType,
      } satisfies ArtifactPreviewState;
    });

  artifactPreviewRequests.set(key, request);
  return request;
};

const getFallbackAgentMeta = (raw: string): ActorMeta => {
  const normalized = normalizeText(raw);
  if (normalized === "review") {
    return getAgentMeta("review");
  }
  if (normalized === "idea" || normalized === "ideation") {
    return getAgentMeta("ideation");
  }
  if (normalized === "experiment") {
    return getAgentMeta("experiment");
  }

  const label = formatStatusLabel(raw);
  return {
    name: label,
    tag: normalized || "agent",
    avatar: label.charAt(0).toUpperCase() || "A",
    className: "generic",
  };
};

const UserMeta: ActorMeta = {
  name: APP_COPY.stream.userName,
  tag: APP_COPY.stream.userTag,
  avatar: "Y",
  className: "user",
};

const SystemMeta: ActorMeta = {
  name: APP_COPY.stream.systemName,
  tag: APP_COPY.stream.systemTag,
  avatar: "S",
  className: "system",
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const isMarkdownArtifact = (artifact: Artifact): boolean => {
  const normalizedType = normalizeText(artifact.contentType);
  const normalizedName = normalizeText(artifact.name);
  return (
    normalizedType.includes("markdown") ||
    normalizedName.endsWith(".md") ||
    normalizedName.endsWith(".markdown")
  );
};

const stripMarkdownForTyping = (value: string): string => {
  return value
    .replace(/```[\w-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^\|?[\s:-]+\|[\s|:-]*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const pickPrimaryArtifact = (artifacts: Artifact[]): Artifact | null => {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (isMarkdownArtifact(artifacts[index])) {
      return artifacts[index];
    }
  }
  return artifacts.length > 0 ? artifacts[artifacts.length - 1] : null;
};

const formatStatusLabel = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Status";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const isLowValueRunEvent = (summary: string): boolean => {
  const normalized = normalizeText(summary);
  return (
    normalized === "run started" ||
    normalized === "run completed" ||
    normalized === "run failed"
  );
};

const isConnectionEventSummary = (summary: string): boolean => {
  const normalized = normalizeText(summary);
  return normalized === "connected" || normalized === "connecting" || normalized === "reconnecting" || normalized === "disconnected";
};

interface AssistantTurnBuilder {
  id: string;
  ts: number;
  agentId: AgentId;
  artifactMap: Map<string, Artifact>;
  hints: string[];
  thinkingSteps: string[];
}

const pushUniqueHint = (target: string[], value: string): void => {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (target[target.length - 1] === trimmed) {
    return;
  }
  target.push(trimmed);
};

const buildAssistantFallbackText = (turn: AssistantTurnBuilder, primaryArtifact: Artifact | null): string => {
  if (primaryArtifact && isMarkdownArtifact(primaryArtifact)) {
    return APP_COPY.stream.draftingMarkdown(formatAgentLabel(turn.agentId));
  }

  if (primaryArtifact) {
    return APP_COPY.stream.generatedArtifact(primaryArtifact.name);
  }

  if (turn.hints.length > 0) {
    return turn.hints[turn.hints.length - 1];
  }

  return APP_COPY.stream.preparedResponse(formatAgentLabel(turn.agentId));
};

const summarizeThinkingStep = (summary: string, agentId: AgentId): string | null => {
  const normalized = normalizeText(summary);
  if (!normalized || isConnectionEventSummary(summary) || isLowValueRunEvent(summary)) {
    return null;
  }

  if (normalized.includes("starting literature review")) {
    return APP_COPY.stream.scanLiterature;
  }
  if (normalized.includes("generating ideas from survey")) {
    return APP_COPY.stream.surveyToIdeas;
  }
  if (normalized.includes("running experiments for idea")) {
    return APP_COPY.stream.testIdea;
  }
  if (normalized.includes("refining idea from results")) {
    return APP_COPY.stream.refineIdea;
  }
  if (normalized.includes("invoking deepseek")) {
    return APP_COPY.stream.invokeModel;
  }
  if (normalized.includes("received deepseek response")) {
    return APP_COPY.stream.condenseModel;
  }
  if (normalized.includes("temporary failure") || normalized.includes("retrying")) {
    return APP_COPY.stream.recoverTransientIssue;
  }
  if (normalized.includes("produced") && normalized.endsWith(".md")) {
    return APP_COPY.stream.prepareMarkdown(formatAgentTitle(agentId));
  }

  return null;
};

const getGeneratingCopy = (runStatus: string): string => {
  if (runStatus === "queued") {
    return APP_COPY.stream.queueThinking;
  }
  if (runStatus === "paused") {
    return APP_COPY.stream.pausedThinking;
  }
  return APP_COPY.stream.activeThinking;
};

const MessageHeader = ({
  actor,
  ts,
  extraBadge,
}: {
  actor: ActorMeta;
  ts: number;
  extraBadge?: ReactNode;
}) => (
  <header className="workflow-stream-message-head">
    <div className={`workflow-stream-identity workflow-stream-identity-${actor.className}`}>
      <span className={`workflow-stream-avatar workflow-stream-avatar-${actor.className}`} aria-hidden="true">
        {actor.avatar}
      </span>
      <div className="workflow-stream-title-group">
        <div className="workflow-stream-title-line">
          <strong className="workflow-stream-name">{actor.name}</strong>
          <span className="event-badge event-badge-kind">{actor.tag}</span>
          {extraBadge}
          <span className="workflow-stream-time">{formatEventTime(ts)}</span>
        </div>
      </div>
    </div>
  </header>
);

const deriveChatLifecycleState = ({
  taskPrompt,
  events,
  runStatus,
  awaitingModule,
  approvalSummary,
  runError,
  isAssistantTyping,
  showGeneratingBubble,
}: {
  taskPrompt: string;
  events: Event[];
  runStatus: string;
  awaitingModule: AgentId | null;
  approvalSummary: string | null;
  runError: string;
  isAssistantTyping: boolean;
  showGeneratingBubble: boolean;
}): ChatLifecycleState | null => {
  const normalizedStatus = runStatus.trim().toLowerCase();
  const hasPrompt = Boolean(taskPrompt.trim());
  const hasModuleStarted = events.some((event) => event.kind === "module_started");
  const hasModuleFinished = events.some((event) => event.kind === "module_finished");
  const hasArtifacts = events.some((event) => event.kind === "artifact_created");

  if (!hasPrompt && events.length === 0) {
    return null;
  }

  if (runError.trim() || FAILED_RUN_STATUSES.has(normalizedStatus)) {
    return {
      key: "failed",
      label: formatStatusLabel("failed"),
      hint: runError.trim() || APP_COPY.stream.noPromptFailure,
      tone: "danger",
    };
  }

  if (SUCCESS_RUN_STATUSES.has(normalizedStatus)) {
    return {
      key: "completed",
      label: APP_COPY.stream.runCompleted,
      hint: hasArtifacts
        ? APP_COPY.stream.runCompletedWithArtifacts
        : APP_COPY.stream.runCompletedWithoutArtifacts,
      tone: "success",
    };
  }

  if (isAssistantTyping || showGeneratingBubble) {
    return {
      key: "generating",
      label: APP_COPY.stream.generatingLabel,
      hint: APP_COPY.stream.generatingHint,
      tone: "info",
    };
  }

  if (normalizedStatus === "queued" || (ACTIVE_RUN_STATUSES.has(normalizedStatus) && !hasModuleStarted)) {
    return {
      key: "starting",
      label: APP_COPY.stream.startingLabel,
      hint: APP_COPY.stream.startingHint,
      tone: "neutral",
    };
  }

  if (normalizedStatus === "running" && hasModuleStarted && !hasModuleFinished && !hasArtifacts) {
    return {
      key: "planning",
      label: APP_COPY.stream.planningLabel,
      hint: APP_COPY.stream.planningHint,
      tone: "neutral",
    };
  }

  if (ACTIVE_RUN_STATUSES.has(normalizedStatus) || approvalSummary || awaitingModule) {
    return {
      key: "running",
      label: APP_COPY.stream.runningLabel,
      hint:
        approvalSummary || awaitingModule
          ? APP_COPY.stream.runningAwaitingHint
          : APP_COPY.stream.runningHint,
      tone: "neutral",
    };
  }

  return null;
};

const TypewriterText = ({
  text,
  visibleChars,
  showIndicator,
}: {
  text: string;
  visibleChars: number;
  showIndicator?: boolean;
}) => {
  return (
    <span className="workflow-stream-typewriter">
      {text.slice(0, visibleChars)}
      {showIndicator ? (
        <span className="workflow-stream-typing" aria-label={APP_COPY.stream.typingAria}>
          <span />
          <span />
          <span />
        </span>
      ) : null}
    </span>
  );
};

const StreamingMarkdownPreview = ({
  content,
  contentType,
  artifactName,
}: {
  content: string;
  contentType: string;
  artifactName?: string;
}) => {
  return (
    <div className="workflow-stream-markdown-shell">
      <ArtifactContentView
        contentType={contentType}
        content={content}
        artifactName={artifactName}
      />
    </div>
  );
};

const mapEventsToStreamItems = (
  taskPrompt: string,
  events: Event[],
  awaitingModule: AgentId | null,
  approvalSummary: string | null,
  sourceRunId: string | null,
  promptTs?: number,
): StreamItem[] => {
  const items: StreamItem[] = [];
  const orderedEvents = [...events].sort((left, right) => left.ts - right.ts);
  let currentTurn: AssistantTurnBuilder | null = null;

  const flushCurrentTurn = () => {
    if (!currentTurn) {
      return;
    }

    const artifacts = Array.from(currentTurn.artifactMap.values());
    const primaryArtifact = pickPrimaryArtifact(artifacts);
    const fallbackText = buildAssistantFallbackText(currentTurn, primaryArtifact);

    if (artifacts.length > 0 || fallbackText.trim()) {
      items.push({
        id: currentTurn.id,
        ts: currentTurn.ts,
        sourceRunId,
        type: "assistant",
        fallbackText,
        agentId: currentTurn.agentId,
        artifacts,
        primaryArtifact,
        thinkingSteps: [...currentTurn.thinkingSteps],
      });
    }

    currentTurn = null;
  };

  const ensureTurn = (event: Event): AssistantTurnBuilder => {
    if (!currentTurn || currentTurn.agentId !== event.agentId) {
      flushCurrentTurn();
      currentTurn = {
        id: `turn-${sourceRunId ?? "thread"}-${event.eventId}`,
        ts: event.ts,
        agentId: event.agentId,
        artifactMap: new Map<string, Artifact>(),
        hints: [],
        thinkingSteps: [],
      };
    }

    return currentTurn;
  };

  const pushStatus = (id: string, ts: number, label: string, text: string, tone: ChatLifecycleTone = "neutral") => {
    items.push({
      id,
      ts,
      sourceRunId,
      type: "status",
      label,
      text,
      tone,
    });
  };

  if (taskPrompt.trim()) {
    items.push({
      id: `user-task-${sourceRunId ?? "thread"}`,
      ts: orderedEvents[0]?.ts ? Math.max(0, orderedEvents[0].ts - 1) : promptTs ?? Date.now(),
      sourceRunId,
      type: "user",
      text: taskPrompt.trim(),
    });
  }

  orderedEvents.forEach((event) => {
    if (event.kind === "module_started") {
      const payload = parseModuleStartedPayload(event);
      const turn = ensureTurn(event);
      pushUniqueHint(turn.thinkingSteps, summarizeThinkingStep(event.summary, event.agentId) ?? APP_COPY.stream.settingUpWorkspace);
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        APP_COPY.stream.moduleStartedLabel(formatAgentTitle(event.agentId)),
        APP_COPY.stream.moduleStartedText(payload?.model),
      );
      return;
    }

    if (event.kind === "artifact_created" && Array.isArray(event.artifacts) && event.artifacts.length > 0) {
      const turn = ensureTurn(event);
      event.artifacts.forEach((artifact) => {
        turn.artifactMap.set(artifact.artifactId, artifact);
      });
      pushUniqueHint(turn.hints, event.summary);
      pushUniqueHint(turn.thinkingSteps, summarizeThinkingStep(event.summary, event.agentId) ?? APP_COPY.stream.packagingReply);
      return;
    }

    if (event.kind === "approval_required") {
      flushCurrentTurn();
      const payload = parseApprovalRequiredPayload(event);
      items.push({
        id: event.eventId,
        ts: event.ts,
        sourceRunId,
        type: "approval",
        text: approvalSummary ?? payload?.summary ?? event.summary,
        agentId: event.agentId,
        module: payload?.module ?? event.agentId,
        actionable: awaitingModule === (payload?.module ?? event.agentId),
      });
      return;
    }

    if (event.kind === "module_finished") {
      const payload = parseModuleFinishedPayload(event);
      if (payload?.status === "failed") {
        flushCurrentTurn();
        items.push({
          id: event.eventId,
          ts: event.ts,
          sourceRunId,
          type: "error",
          text: APP_COPY.stream.moduleFailedText(formatAgentTitle(event.agentId)),
          agentId: event.agentId,
          kind: event.kind,
          severity: "error",
        });
        return;
      }

      if (payload?.status === "skipped") {
        flushCurrentTurn();
        pushStatus(
          `status-${event.eventId}`,
          event.ts,
          APP_COPY.stream.moduleSkippedLabel(formatAgentTitle(event.agentId)),
          APP_COPY.stream.moduleSkippedText,
        );
        return;
      }

      if (currentTurn && currentTurn.agentId === event.agentId) {
        pushUniqueHint(currentTurn.hints, event.summary);
      }
      flushCurrentTurn();
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        APP_COPY.stream.moduleCompletedLabel(formatAgentTitle(event.agentId)),
        payload?.artifactNames && payload.artifactNames.length > 0
          ? APP_COPY.stream.moduleCompletedWithArtifacts(payload.artifactNames)
          : APP_COPY.stream.moduleCompletedText,
        "success",
      );
      return;
    }

    if (event.kind === "approval_resolved") {
      const payload = parseApprovalResolvedPayload(event);
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        payload?.approved ? APP_COPY.stream.approvalGranted : APP_COPY.stream.approvalRejected,
        payload?.approved
          ? APP_COPY.stream.approvalContinue(formatAgentTitle(event.agentId))
          : APP_COPY.stream.approvalStopped(formatAgentTitle(event.agentId)),
        payload?.approved ? "success" : "danger",
      );
      return;
    }

    if (event.kind === "module_skipped") {
      flushCurrentTurn();
      const payload = parseModuleSkippedPayload(event);
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        APP_COPY.stream.moduleSkippedLabel(formatAgentTitle(event.agentId)),
        payload?.reason ? APP_COPY.stream.skipReason(payload.reason) : APP_COPY.stream.moduleDidNotRun,
      );
      return;
    }

    if (event.kind === "module_failed" || event.severity === "error") {
      flushCurrentTurn();
      const payload = parseModuleFailedPayload(event);
      items.push({
        id: event.eventId,
        ts: event.ts,
        sourceRunId,
        type: "error",
        text: payload?.error.message ?? event.summary,
        agentId: event.agentId,
        kind: event.kind,
        severity: event.severity,
      });
      return;
    }

    if (event.kind === "event_emitted") {
      if (isConnectionEventSummary(event.summary)) {
        return;
      }

      const step = summarizeThinkingStep(event.summary, event.agentId);
      if (step) {
        const turn = ensureTurn(event);
        pushUniqueHint(turn.thinkingSteps, step);
      }

      if (isLowValueRunEvent(event.summary)) {
        pushStatus(
          `status-${event.eventId}`,
          event.ts,
          formatStatusLabel(event.summary),
          APP_COPY.stream.lifecycleUpdate,
          "info",
        );
      }
    }
  });

  flushCurrentTurn();

  return items;
};

const mapSegmentsToStreamItems = (segments: ConversationSegment[]): StreamItem[] => {
  const items = segments.flatMap((segment) =>
    mapEventsToStreamItems(
      segment.prompt,
      segment.events,
      segment.awaitingModule,
      segment.approvalSummary,
      segment.sourceRunId,
      segment.promptTs,
    ),
  );

  return items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.id.localeCompare(right.id);
  });
};

export const RunMessageStream = ({
  segments,
  taskPrompt,
  events,
  awaitingModule,
  approvalSummary,
  approvalNote,
  approving,
  runError,
  runStatus,
  embedded = false,
  onApprovalNoteChange,
  onApprove,
  onOpenArtifact,
}: RunMessageStreamProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [artifactBodies, setArtifactBodies] = useState<Record<string, ArtifactPreviewState>>({});
  const [renderStates, setRenderStates] = useState<Record<string, RenderState>>({});
  const scrollToBottom = useCallback((force = false) => {
    if (!listRef.current) {
      return;
    }

    if (!force && !stickToBottomRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, []);

  const updateStickToBottom = useCallback(() => {
    if (!listRef.current) {
      return;
    }

    const { scrollTop, clientHeight, scrollHeight } = listRef.current;
    stickToBottomRef.current = scrollTop + clientHeight >= scrollHeight - 32;
  }, []);

  const threadSegments = useMemo<ConversationSegment[]>(
    () =>
      segments && segments.length > 0
        ? segments
        : [
            {
              threadId: events[0]?.topicId ?? events[0]?.runId ?? "run-thread",
              sourceRunId: events[0]?.runId ?? null,
              prompt: taskPrompt,
              promptTs: events[0]?.ts ? Math.max(0, events[0].ts - 1) : Date.now(),
              events,
              runStatus,
              awaitingModule,
              approvalSummary,
            },
          ],
    [approvalSummary, awaitingModule, events, runStatus, segments, taskPrompt],
  );

  const activeSegment = useMemo(
    () =>
      [...threadSegments].reverse().find((segment) =>
        ACTIVE_RUN_STATUSES.has(segment.runStatus.trim().toLowerCase()) ||
        Boolean(segment.awaitingModule) ||
        Boolean(segment.approvalSummary),
      ) ??
      threadSegments[threadSegments.length - 1] ??
      null,
    [threadSegments],
  );

  const items = useMemo(() => mapSegmentsToStreamItems(threadSegments), [threadSegments]);

  const activeRunId = activeSegment?.sourceRunId ?? null;
  const activeStatus = activeSegment?.runStatus.trim().toLowerCase() ?? "";
  const isActiveRunStreaming = ACTIVE_RUN_STATUSES.has(activeStatus);

  const hasAssistantResponse = useMemo(
    () =>
      activeRunId
        ? items.some((item) => item.sourceRunId === activeRunId && item.type !== "user" && item.type !== "status")
        : items.some((item) => item.type !== "user" && item.type !== "status"),
    [activeRunId, items],
  );

  const showGeneratingBubble =
    Boolean(activeSegment?.prompt.trim()) &&
    isActiveRunStreaming &&
    !activeSegment?.approvalSummary &&
    !activeSegment?.awaitingModule &&
    !hasAssistantResponse;

  const assistantPrimaryArtifacts = useMemo(
    () => {
      const ordered: Artifact[] = [];
      const seen = new Set<string>();

      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const artifact = item.type === "assistant" ? item.primaryArtifact : null;
        if (!artifact) {
          continue;
        }

        const key = getArtifactPreviewKey(artifact);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        ordered.push(artifact);
      }

      return ordered;
    },
    [items],
  );

  useEffect(() => {
    let cancelled = false;

    setArtifactBodies((current) => {
      let changed = false;
      const next = { ...current };

      assistantPrimaryArtifacts.forEach((artifact) => {
        const key = getArtifactPreviewKey(artifact);
        const cached = getCachedArtifactPreview(artifact);
        if (cached && !sameArtifactPreviewState(current[key], cached)) {
          next[key] = cached;
          changed = true;
        }
      });

      return changed ? next : current;
    });

    const queue = assistantPrimaryArtifacts.filter((artifact) => !getCachedArtifactPreview(artifact));
    let cursor = 0;
    let inFlight = 0;

    const pump = () => {
      while (!cancelled && inFlight < ARTIFACT_PREVIEW_CONCURRENCY && cursor < queue.length) {
        const artifact = queue[cursor];
        cursor += 1;
        inFlight += 1;

        const key = getArtifactPreviewKey(artifact);
        setArtifactBodies((current) => {
          const existing = current[key];
          if (existing?.state === "loaded" || existing?.state === "loading") {
            return current;
          }

          return {
            ...current,
            [key]: {
              state: "loading",
              content: "",
              contentType: artifact.contentType,
            },
          };
        });

        void loadArtifactPreview(artifact)
          .then((result) => {
            if (cancelled) {
              return;
            }

            setArtifactBodies((current) => {
              if (sameArtifactPreviewState(current[key], result)) {
                return current;
              }

              return {
                ...current,
                [key]: result,
              };
            });
          })
          .finally(() => {
            inFlight -= 1;
            if (!cancelled) {
              pump();
            }
          });
      }
    };

    pump();

    return () => {
      cancelled = true;
    };
  }, [assistantPrimaryArtifacts]);

  const renderTargets = useMemo<RenderTarget[]>(() => {
    return items.map((item) => {
      if (item.type !== "assistant" && item.type !== "error") {
        return {
          itemId: item.id,
          content: "",
          sourceKey: `none:${item.id}`,
          mode: "none",
          shouldStream: false,
        };
      }

      const artifactState =
        item.type === "assistant" && item.primaryArtifact
          ? artifactBodies[getArtifactPreviewKey(item.primaryArtifact)] ?? getCachedArtifactPreview(item.primaryArtifact)
          : null;
      const markdownReady =
        item.type === "assistant" &&
        item.primaryArtifact &&
        artifactState?.state === "loaded" &&
        isMarkdownArtifact(item.primaryArtifact);
      const isActiveStreamItem =
        item.sourceRunId === activeRunId &&
        isActiveRunStreaming &&
        (item.type === "assistant" || item.type === "error");
      const shouldRenderMarkdown = markdownReady && !isActiveStreamItem;
      const markdownTypingText =
        item.type === "assistant" && markdownReady && artifactState
          ? stripMarkdownForTyping(artifactState.content)
          : "";
      const mode: RenderTarget["mode"] = shouldRenderMarkdown ? "markdown" : "text";
      const content =
        item.type === "assistant" && markdownReady && artifactState
          ? shouldRenderMarkdown
            ? artifactState.content
            : markdownTypingText || item.fallbackText
          : item.type === "assistant"
            ? item.fallbackText
            : item.text;
      const sourceKey =
        shouldRenderMarkdown && item.type === "assistant" && item.primaryArtifact
          ? `markdown:${item.primaryArtifact.artifactId}:${content.length}`
          : `text:${item.id}:${markdownReady && artifactState ? `artifact:${artifactState.content.length}` : "fallback"}:${content.length}`;
      const shouldStream = Boolean(
        isActiveStreamItem &&
          (item.type === "error" || item.type === "assistant" && (!item.primaryArtifact || markdownReady)),
      );

      return {
        itemId: item.id,
        content,
        sourceKey,
        mode,
        shouldStream,
      };
    });
  }, [activeRunId, artifactBodies, isActiveRunStreaming, items]);

  const renderTargetById = useMemo(() => new Map(renderTargets.map((target) => [target.itemId, target])), [renderTargets]);

  useEffect(() => {
    setRenderStates((current) => {
      let changed = Object.keys(current).length !== renderTargets.length;
      const next: Record<string, RenderState> = {};

      renderTargets.forEach((target) => {
        const previous = current[target.itemId];
        let nextState: RenderState;

        if (!previous) {
          nextState = target.shouldStream
            ? {
                sourceKey: target.sourceKey,
                contentLength: target.content.length,
                renderedLength: 0,
                isComplete: target.content.length === 0,
              }
            : {
                sourceKey: target.sourceKey,
                contentLength: target.content.length,
                renderedLength: target.content.length,
                isComplete: true,
              };
          changed = true;
        } else if (!target.shouldStream) {
          if (
            previous.sourceKey === target.sourceKey &&
            previous.contentLength === target.content.length &&
            previous.renderedLength === target.content.length &&
            previous.isComplete
          ) {
            nextState = previous;
          } else {
            nextState = {
              sourceKey: target.sourceKey,
              contentLength: target.content.length,
              renderedLength: target.content.length,
              isComplete: true,
            };
            changed = true;
          }
        } else if (previous.sourceKey !== target.sourceKey) {
          nextState = {
            sourceKey: target.sourceKey,
            contentLength: target.content.length,
            renderedLength: 0,
            isComplete: target.content.length === 0,
          };
          changed = true;
        } else {
          let renderedLength = Math.min(previous.renderedLength, target.content.length);
          if (previous.isComplete && previous.contentLength < target.content.length) {
            renderedLength = previous.contentLength;
          }

          const isComplete = previous.isComplete && renderedLength >= target.content.length;
          if (
            previous.contentLength === target.content.length &&
            previous.renderedLength === renderedLength &&
            previous.isComplete === isComplete
          ) {
            nextState = previous;
          } else {
            nextState = {
              sourceKey: target.sourceKey,
              contentLength: target.content.length,
              renderedLength,
              isComplete,
            };
            changed = true;
          }
        }

        next[target.itemId] = nextState;
      });

      return changed ? next : current;
    });
  }, [renderTargets]);

  const activeRenderTarget = useMemo(() => {
    for (let index = renderTargets.length - 1; index >= 0; index -= 1) {
      const target = renderTargets[index];
      const state = renderStates[target.itemId];
      if (target.shouldStream && state && !state.isComplete) {
        return target;
      }
    }

    return null;
  }, [renderStates, renderTargets]);

  const latestLoadingMessageId = useMemo(() => {
    if (!activeRunId || !isActiveRunStreaming) {
      return null;
    }

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.type !== "assistant" || !item.primaryArtifact || item.sourceRunId !== activeRunId) {
        continue;
      }

      const artifactState =
        artifactBodies[getArtifactPreviewKey(item.primaryArtifact)] ?? getCachedArtifactPreview(item.primaryArtifact);
      if (!artifactState || artifactState.state === "loading") {
        return item.id;
      }
    }

    return null;
  }, [activeRunId, artifactBodies, isActiveRunStreaming, items]);

  useEffect(() => {
    if (!activeRenderTarget) {
      return undefined;
    }

    const delay = 10;
    const step = 1;

    const timer = window.setInterval(() => {
      setRenderStates((current) => {
        const previous = current[activeRenderTarget.itemId];
        if (!previous) {
          return current;
        }

        const nextRenderedLength = Math.min(activeRenderTarget.content.length, previous.renderedLength + step);
        const nextIsComplete = nextRenderedLength >= activeRenderTarget.content.length;
        if (nextRenderedLength === previous.renderedLength && nextIsComplete === previous.isComplete) {
          return current;
        }

        return {
          ...current,
          [activeRenderTarget.itemId]: {
            sourceKey: activeRenderTarget.sourceKey,
            contentLength: activeRenderTarget.content.length,
            renderedLength: nextRenderedLength,
            isComplete: nextIsComplete,
          },
        };
      });

      window.requestAnimationFrame(() => {
        scrollToBottom();
      });
    }, delay);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeRenderTarget, scrollToBottom]);

  const typingMessageId = activeRenderTarget?.itemId ?? latestLoadingMessageId ?? null;

  const chatLifecycleState = useMemo(
    () =>
      deriveChatLifecycleState({
        taskPrompt: activeSegment?.prompt ?? taskPrompt,
        events: activeSegment?.events ?? events,
        runStatus: activeSegment?.runStatus ?? runStatus,
        awaitingModule: activeSegment?.awaitingModule ?? awaitingModule,
        approvalSummary: activeSegment?.approvalSummary ?? approvalSummary,
        runError,
        isAssistantTyping: Boolean(typingMessageId),
        showGeneratingBubble,
      }),
    [
      activeSegment,
      approvalSummary,
      awaitingModule,
      events,
      runError,
      runStatus,
      showGeneratingBubble,
      taskPrompt,
      typingMessageId,
    ],
  );

  const statusAnchorMessageId = useMemo(() => {
    if (!activeRunId) {
      return null;
    }

    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].type === "user" && items[index].sourceRunId === activeRunId) {
        return items[index].id;
      }
    }

    return null;
  }, [activeRunId, items]);

  useEffect(() => {
    scrollToBottom();
  }, [chatLifecycleState?.key, items.length, scrollToBottom, showGeneratingBubble, typingMessageId]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) {
      return;
    }

    updateStickToBottom();
    const handleScroll = () => {
      updateStickToBottom();
    };

    listElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      listElement.removeEventListener("scroll", handleScroll);
    };
  }, [updateStickToBottom]);

  return (
    <div className={embedded ? "workflow-stream-list workflow-stream-list-embedded" : "workflow-stream-list"} ref={listRef}>
      {items.length === 0 && !showGeneratingBubble ? (
        <div className="workflow-stream-empty">
          <div className="workflow-stream-empty-card">
            <div className="workflow-stream-empty-head">
              <span className="workflow-stream-avatar workflow-stream-avatar-system" aria-hidden="true">
                {SystemMeta.avatar}
              </span>
              <div className="workflow-stream-empty-copy">
                <strong className="workflow-stream-empty-title">{APP_COPY.stream.emptyTitle}</strong>
                <p className="workflow-stream-empty-hint">{APP_COPY.stream.emptyHint}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!statusAnchorMessageId && chatLifecycleState ? (
        <div className={`workflow-stream-status workflow-stream-status-${chatLifecycleState.tone}`}>
          <span className="workflow-stream-status-pill">{chatLifecycleState.label}</span>
          <p className="workflow-stream-status-text">{chatLifecycleState.hint}</p>
        </div>
      ) : null}

      {items.map((item) => {
        if (item.type === "user") {
          return (
            <div key={item.id} className="workflow-stream-block">
              <article className="workflow-stream-message workflow-stream-message-user">
                <MessageHeader actor={UserMeta} ts={item.ts} />
                <div className="workflow-stream-bubble">
                  <p className="workflow-stream-text">{item.text}</p>
                </div>
              </article>
              {item.id === statusAnchorMessageId && chatLifecycleState ? (
                <div className={`workflow-stream-status workflow-stream-status-${chatLifecycleState.tone}`}>
                  <span className="workflow-stream-status-pill">{chatLifecycleState.label}</span>
                  <p className="workflow-stream-status-text">{chatLifecycleState.hint}</p>
                </div>
              ) : null}
            </div>
          );
        }

        if (item.type === "status") {
          return (
            <div key={item.id} className={`workflow-stream-status workflow-stream-status-${item.tone}`}>
              <span className="workflow-stream-status-pill">{item.label}</span>
              <p className="workflow-stream-status-text">{item.text}</p>
            </div>
          );
        }

        if (item.type === "approval") {
          const actor = getAgentMeta(item.module);
          return (
            <article key={item.id} className="workflow-stream-message workflow-stream-message-assistant">
              <MessageHeader
                actor={actor}
                ts={item.ts}
                extraBadge={<span className="event-badge">{APP_COPY.stream.approvalBadge}</span>}
              />
              <div className="workflow-stream-card workflow-stream-card-approval">
                <p className="workflow-stream-text">{item.text}</p>
                {item.actionable ? (
                  <>
                    <textarea
                      value={approvalNote}
                      onChange={(event) => onApprovalNoteChange(event.target.value)}
                      placeholder={APP_COPY.common.optionalNote}
                      rows={2}
                      disabled={approving}
                    />
                    <div className="workflow-approval-actions">
                      <button type="button" disabled={approving} onClick={() => onApprove(true)}>
                        {approving ? APP_COPY.common.submitting : APP_COPY.common.approve}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={approving}
                        onClick={() => onApprove(false)}
                      >
                        {approving ? APP_COPY.common.submitting : APP_COPY.common.reject}
                      </button>
                    </div>
                    {runError ? <p className="form-error">{runError}</p> : null}
                  </>
                ) : (
                  <p className="muted">{APP_COPY.stream.approvalCheckpointRecorded}</p>
                )}
              </div>
            </article>
          );
        }

        const isError = item.type === "error";
        const actor = item.type === "assistant" || item.type === "error" ? getAgentMeta(item.agentId) : SystemMeta;
        const artifactState =
          item.type === "assistant" && item.primaryArtifact
            ? artifactBodies[getArtifactPreviewKey(item.primaryArtifact)] ?? getCachedArtifactPreview(item.primaryArtifact)
            : null;
        const renderTarget = renderTargetById.get(item.id) ?? null;
        const renderState = renderStates[item.id];
        const visibleChars = renderState?.renderedLength ?? (renderTarget?.content.length ?? (isError ? item.text.length : item.type === "assistant" ? item.fallbackText.length : 0));
        const isTyping = activeRenderTarget?.itemId === item.id && !renderState?.isComplete;
        const markdownReady = item.type === "assistant" && artifactState?.state === "loaded" && item.primaryArtifact;
        const showArtifactLoadingHint =
          item.type === "assistant" && item.primaryArtifact && (!artifactState || artifactState.state === "loading");
        const showArtifactErrorHint =
          item.type === "assistant" && item.primaryArtifact && artifactState?.state === "error";
        const showMarkdownPreview =
          item.type === "assistant" &&
          markdownReady &&
          item.primaryArtifact &&
          (
            renderTarget?.mode === "markdown" ||
            Boolean(renderState?.isComplete && artifactState?.state === "loaded")
          ) &&
          !isTyping &&
          latestLoadingMessageId !== item.id &&
          isMarkdownArtifact(item.primaryArtifact);
        const markdownArtifact = showMarkdownPreview ? item.primaryArtifact : null;
        const showThinkingPanel =
          item.type === "assistant" &&
          item.sourceRunId === activeRunId &&
          (showArtifactLoadingHint || isTyping || latestLoadingMessageId === item.id);

        return (
          <article
            key={item.id}
            className={`workflow-stream-message ${isError ? "workflow-stream-message-error" : "workflow-stream-message-assistant"}`}
          >
            <MessageHeader
              actor={actor}
              ts={item.ts}
              extraBadge={
                isError ? (
                  <span className={`event-badge event-badge-severity severity-${item.severity}`}>{item.severity}</span>
                ) : undefined
              }
            />
            <div className="workflow-stream-bubble">
              {showThinkingPanel ? (
                <div className="workflow-stream-thinking workflow-stream-thinking-active">
                  <div className="workflow-stream-thinking-head">
                    <span className="workflow-stream-thinking-label">{APP_COPY.stream.thinkingLabel}</span>
                    <span className="workflow-stream-thinking-pulse" aria-label={APP_COPY.stream.typingAria}>
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                  {item.thinkingSteps.length > 0 ? (
                    <ul className="workflow-stream-thinking-list">
                      {item.thinkingSteps.slice(-4).map((step) => (
                        <li key={`${item.id}-${step}`}>{step}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="workflow-stream-thinking-copy">{APP_COPY.stream.activeThinking}</p>
                  )}
                </div>
              ) : null}
              {showMarkdownPreview && markdownArtifact ? (
                <div className="workflow-stream-message-markdown">
                  <StreamingMarkdownPreview
                    contentType={artifactState.contentType}
                    content={artifactState.content}
                    artifactName={markdownArtifact.name}
                  />
                </div>
              ) : (
                <p className="workflow-stream-text">
                  <TypewriterText
                    text={renderTarget?.content ?? (isError ? item.text : item.fallbackText)}
                    visibleChars={visibleChars}
                    showIndicator={isTyping || latestLoadingMessageId === item.id}
                  />
                </p>
              )}
              {showArtifactLoadingHint && item.type === "assistant" && item.primaryArtifact ? (
                <p className="workflow-stream-inline-note">{APP_COPY.stream.preparingFormattedReply(item.primaryArtifact.name)}</p>
              ) : null}
              {showArtifactErrorHint && item.type === "assistant" && item.primaryArtifact ? (
                <p className="workflow-stream-inline-note workflow-stream-inline-note-danger">
                  {APP_COPY.stream.couldNotLoadArtifact(item.primaryArtifact.name)}
                </p>
              ) : null}
              {item.type === "assistant" && item.artifacts.length > 0 ? (
                <div className="workflow-stream-attachments">
                  {item.artifacts.map((artifact) => (
                    <button
                      key={artifact.artifactId}
                      type="button"
                      className="workflow-stream-attachment-card"
                      onClick={() => onOpenArtifact(artifact)}
                    >
                      <strong>{artifact.name}</strong>
                      <span>{artifact.contentType}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}

      {showGeneratingBubble ? (
        <article className="workflow-stream-message workflow-stream-message-assistant workflow-stream-message-pending">
          <MessageHeader
            actor={SystemMeta}
            ts={Date.now()}
            extraBadge={<span className="event-badge event-badge-kind">{APP_COPY.stream.thinkingLabel}</span>}
          />
          <div className="workflow-stream-bubble workflow-stream-bubble-pending">
            <div className="workflow-stream-thinking workflow-stream-thinking-active">
              <div className="workflow-stream-thinking-head">
                <span className="workflow-stream-thinking-label">{APP_COPY.stream.thinkingLabel}</span>
                <span className="workflow-stream-thinking-pulse" aria-label={APP_COPY.stream.typingAria}>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
              <p className="workflow-stream-thinking-copy">{getGeneratingCopy(activeSegment?.runStatus ?? runStatus)}</p>
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
};
