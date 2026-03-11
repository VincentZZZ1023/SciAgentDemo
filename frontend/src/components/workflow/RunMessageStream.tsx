import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArtifactContent } from "../../api/client";
import { ArtifactContentView } from "../artifact/ArtifactContentView";
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
      type: "user";
      text: string;
    }
  | {
      id: string;
      ts: number;
      type: "status";
      label: string;
      text: string;
      tone: ChatLifecycleTone;
    }
  | {
      id: string;
      ts: number;
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
      type: "error";
      text: string;
      agentId: AgentId;
      kind: string;
      severity: string;
    }
  | {
      id: string;
      ts: number;
      type: "approval";
      text: string;
      agentId: AgentId;
      module: AgentId;
      actionable: boolean;
    };

interface RunMessageStreamProps {
  taskPrompt: string;
  events: Event[];
  awaitingModule: AgentId | null;
  approvalSummary: string | null;
  approvalNote: string;
  approving: boolean;
  runError: string;
  runStatus: string;
  onApprovalNoteChange: (value: string) => void;
  onApprove: (approved: boolean) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);
const SUCCESS_RUN_STATUSES = new Set(["succeeded", "completed", "done", "success"]);
const FAILED_RUN_STATUSES = new Set(["failed", "canceled"]);

type ChatLifecycleTone = "neutral" | "info" | "success" | "danger";

interface ChatLifecycleState {
  key: string;
  label: string;
  hint: string;
  tone: ChatLifecycleTone;
}

interface ActorMeta {
  name: string;
  tag: string;
  avatar: string;
  className: string;
}

const formatEventTime = (ts: number): string => new Date(ts).toLocaleString();

const formatAgentLabel = (agentId: AgentId): string => {
  if (agentId === "ideation") {
    return "idea";
  }
  return agentId;
};

const getAgentMeta = (agentId: AgentId): ActorMeta => {
  if (agentId === "review") {
    return {
      name: "Review Agent",
      tag: "review",
      avatar: "R",
      className: "review",
    };
  }

  if (agentId === "ideation") {
    return {
      name: "Idea Agent",
      tag: "idea",
      avatar: "I",
      className: "ideation",
    };
  }

  return {
    name: "Experiment Agent",
    tag: "experiment",
    avatar: "E",
    className: "experiment",
  };
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
  name: "You",
  tag: "task",
  avatar: "Y",
  className: "user",
};

const SystemMeta: ActorMeta = {
  name: "SciAgent",
  tag: "system",
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
    return `${formatStatusLabel(formatAgentLabel(turn.agentId))} is drafting the markdown answer.`;
  }

  if (primaryArtifact) {
    return `Generated ${primaryArtifact.name}.`;
  }

  if (turn.hints.length > 0) {
    return turn.hints[turn.hints.length - 1];
  }

  return `${formatStatusLabel(formatAgentLabel(turn.agentId))} prepared a response.`;
};

const summarizeThinkingStep = (summary: string, agentId: AgentId): string | null => {
  const normalized = normalizeText(summary);
  if (!normalized || isConnectionEventSummary(summary) || isLowValueRunEvent(summary)) {
    return null;
  }

  if (normalized.includes("starting literature review")) {
    return "Scanning and organizing the relevant literature.";
  }
  if (normalized.includes("generating ideas from survey")) {
    return "Turning the survey into candidate research directions.";
  }
  if (normalized.includes("running experiments for idea")) {
    return "Testing the selected idea against evaluation criteria.";
  }
  if (normalized.includes("refining idea from results")) {
    return "Feeding experiment results back into the idea draft.";
  }
  if (normalized.includes("invoking deepseek")) {
    return "Querying the model for the next draft segment.";
  }
  if (normalized.includes("received deepseek response")) {
    return "Condensing the model response into a readable answer.";
  }
  if (normalized.includes("temporary failure") || normalized.includes("retrying")) {
    return "Recovering from a transient issue before continuing.";
  }
  if (normalized.includes("produced") && normalized.endsWith(".md")) {
    return `Preparing the final ${formatStatusLabel(formatAgentLabel(agentId))} markdown output.`;
  }

  return null;
};

const getGeneratingCopy = (runStatus: string): string => {
  if (runStatus === "queued") {
    return "Preparing the run and assembling the first update.";
  }
  if (runStatus === "paused") {
    return "Waiting at the current checkpoint before continuing.";
  }
  return "Writing the next assistant update from the live run events.";
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
      label: "Failed",
      hint: runError.trim() || "The run stopped before completion. Review the latest assistant message for the next action.",
      tone: "danger",
    };
  }

  if (SUCCESS_RUN_STATUSES.has(normalizedStatus)) {
    return {
      key: "completed",
      label: "Completed",
      hint: hasArtifacts
        ? "The run finished and the latest deliverables are available in this conversation."
        : "The run finished successfully.",
      tone: "success",
    };
  }

  if (isAssistantTyping || showGeneratingBubble) {
    return {
      key: "generating",
      label: "Generating response...",
      hint: "The assistant is turning live run signals into the next user-facing update.",
      tone: "info",
    };
  }

  if (normalizedStatus === "queued" || (ACTIVE_RUN_STATUSES.has(normalizedStatus) && !hasModuleStarted)) {
    return {
      key: "starting",
      label: "Starting run...",
      hint: "Preparing the selected agents and loading the first step.",
      tone: "neutral",
    };
  }

  if (normalizedStatus === "running" && hasModuleStarted && !hasModuleFinished && !hasArtifacts) {
    return {
      key: "planning",
      label: "Planning...",
      hint: "The selected agents are shaping the first concrete answer from your task.",
      tone: "neutral",
    };
  }

  if (ACTIVE_RUN_STATUSES.has(normalizedStatus) || approvalSummary || awaitingModule) {
    return {
      key: "running",
      label: "Running...",
      hint:
        approvalSummary || awaitingModule
          ? "The run is waiting for the next user decision before continuing."
          : "The workflow is still active and will add new assistant messages as progress arrives.",
      tone: "neutral",
    };
  }

  return null;
};

const TypewriterText = ({
  text,
  active,
  animateText = true,
  showIndicator,
  onStep,
  onTypingChange,
}: {
  text: string;
  active: boolean;
  animateText?: boolean;
  showIndicator?: boolean;
  onStep?: () => void;
  onTypingChange?: (active: boolean) => void;
}) => {
  const shouldAnimateText = active && animateText;
  const shouldShowIndicator = showIndicator ?? active;
  const [visibleChars, setVisibleChars] = useState(shouldAnimateText ? 0 : text.length);

  useEffect(() => {
    if (!shouldAnimateText) {
      setVisibleChars(text.length);
      onTypingChange?.(shouldShowIndicator);
      return;
    }

    setVisibleChars(0);
    onTypingChange?.(true);

    if (!text.length) {
      onStep?.();
      onTypingChange?.(false);
      return;
    }

    const step = Math.max(1, Math.ceil(text.length / 36));
    const timer = window.setInterval(() => {
      setVisibleChars((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return text.length;
        }

        const nextValue = Math.min(text.length, current + step);
        window.requestAnimationFrame(() => {
          onStep?.();
        });
        if (nextValue >= text.length) {
          window.clearInterval(timer);
          window.requestAnimationFrame(() => {
            onTypingChange?.(false);
          });
        }
        return nextValue;
      });
    }, 20);

    return () => {
      window.clearInterval(timer);
      onTypingChange?.(false);
    };
  }, [onStep, onTypingChange, shouldAnimateText, shouldShowIndicator, text]);

  const isTyping = shouldAnimateText ? visibleChars < text.length : shouldShowIndicator;

  return (
    <span className="workflow-stream-typewriter">
      {shouldAnimateText ? text.slice(0, visibleChars) : text}
      {isTyping ? (
        <span className="workflow-stream-typing" aria-label="Assistant is generating">
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
  active,
  onStep,
  onTypingChange,
}: {
  content: string;
  contentType: string;
  artifactName?: string;
  active: boolean;
  onStep?: () => void;
  onTypingChange?: (active: boolean) => void;
}) => {
  const [visibleChars, setVisibleChars] = useState(active ? 0 : content.length);

  useEffect(() => {
    if (!active) {
      setVisibleChars(content.length);
      onTypingChange?.(false);
      return;
    }

    setVisibleChars(0);
    onTypingChange?.(true);

    if (!content.length) {
      onTypingChange?.(false);
      return;
    }

    const step = Math.max(1, Math.ceil(content.length / 220));
    const timer = window.setInterval(() => {
      setVisibleChars((current) => {
        if (current >= content.length) {
          window.clearInterval(timer);
          return content.length;
        }

        const nextValue = Math.min(content.length, current + step);
        window.requestAnimationFrame(() => {
          onStep?.();
        });
        if (nextValue >= content.length) {
          window.clearInterval(timer);
          window.requestAnimationFrame(() => {
            onTypingChange?.(false);
          });
        }
        return nextValue;
      });
    }, 18);

    return () => {
      window.clearInterval(timer);
      onTypingChange?.(false);
    };
  }, [active, content, onStep, onTypingChange]);

  const isTyping = active && visibleChars < content.length;

  return (
    <div className="workflow-stream-markdown-shell">
      <ArtifactContentView
        contentType={contentType}
        content={active ? content.slice(0, visibleChars) : content}
        artifactName={artifactName}
      />
      {isTyping ? (
        <div className="workflow-stream-markdown-indicator" aria-label="Assistant is generating markdown">
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  );
};

const mapEventsToStreamItems = (
  taskPrompt: string,
  events: Event[],
  awaitingModule: AgentId | null,
  approvalSummary: string | null,
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
        id: `turn-${event.eventId}`,
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
      type: "status",
      label,
      text,
      tone,
    });
  };

  if (taskPrompt.trim()) {
    items.push({
      id: "user-task",
      ts: orderedEvents[0]?.ts ? Math.max(0, orderedEvents[0].ts - 1) : Date.now(),
      type: "user",
      text: taskPrompt.trim(),
    });
  }

  orderedEvents.forEach((event) => {
    if (event.kind === "module_started") {
      const payload = parseModuleStartedPayload(event);
      const turn = ensureTurn(event);
      pushUniqueHint(turn.thinkingSteps, summarizeThinkingStep(event.summary, event.agentId) ?? "Setting up the agent workspace.");
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        `${formatStatusLabel(formatAgentLabel(event.agentId))} started`,
        payload?.model ? `Using ${payload.model}.` : "The agent has started working.",
      );
      return;
    }

    if (event.kind === "artifact_created" && Array.isArray(event.artifacts) && event.artifacts.length > 0) {
      const turn = ensureTurn(event);
      event.artifacts.forEach((artifact) => {
        turn.artifactMap.set(artifact.artifactId, artifact);
      });
      pushUniqueHint(turn.hints, event.summary);
      pushUniqueHint(turn.thinkingSteps, summarizeThinkingStep(event.summary, event.agentId) ?? "Packaging the final answer and attachments.");
      return;
    }

    if (event.kind === "approval_required") {
      flushCurrentTurn();
      const payload = parseApprovalRequiredPayload(event);
      items.push({
        id: event.eventId,
        ts: event.ts,
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
          type: "error",
          text: `${formatStatusLabel(formatAgentLabel(event.agentId))} finished with failure.`,
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
          `${formatStatusLabel(formatAgentLabel(event.agentId))} skipped`,
          "This agent was not run for the current request.",
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
        `${formatStatusLabel(formatAgentLabel(event.agentId))} completed`,
        payload?.artifactNames && payload.artifactNames.length > 0
          ? `Deliverables ready: ${payload.artifactNames.join(", ")}.`
          : "The agent finished its response.",
        "success",
      );
      return;
    }

    if (event.kind === "approval_resolved") {
      const payload = parseApprovalResolvedPayload(event);
      pushStatus(
        `status-${event.eventId}`,
        event.ts,
        payload?.approved ? "Approval granted" : "Approval rejected",
        `${formatStatusLabel(formatAgentLabel(event.agentId))} ${payload?.approved ? "can continue." : "was stopped by user decision."}`,
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
        `${formatStatusLabel(formatAgentLabel(event.agentId))} skipped`,
        payload?.reason ? `Reason: ${payload.reason}.` : "This agent did not run.",
      );
      return;
    }

    if (event.kind === "module_failed" || event.severity === "error") {
      flushCurrentTurn();
      const payload = parseModuleFailedPayload(event);
      items.push({
        id: event.eventId,
        ts: event.ts,
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
          "Run lifecycle update.",
          "info",
        );
      }
    }
  });

  flushCurrentTurn();

  return items;
};

export const RunMessageStream = ({
  taskPrompt,
  events,
  awaitingModule,
  approvalSummary,
  approvalNote,
  approving,
  runError,
  runStatus,
  onApprovalNoteChange,
  onApprove,
  onOpenArtifact,
}: RunMessageStreamProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const requestedArtifactIdsRef = useRef<Set<string>>(new Set());
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [artifactBodies, setArtifactBodies] = useState<
    Record<
      string,
      {
        state: "loading" | "loaded" | "error";
        content: string;
        contentType: string;
      }
    >
  >({});
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

  const items = useMemo(
    () => mapEventsToStreamItems(taskPrompt, events, awaitingModule, approvalSummary),
    [approvalSummary, awaitingModule, events, taskPrompt],
  );

  const latestAnimatedId = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].type === "assistant" || items[index].type === "error") {
        return items[index].id;
      }
    }
    return null;
  }, [items]);

  const hasAssistantResponse = useMemo(
    () => items.some((item) => item.type !== "user"),
    [items],
  );

  const showGeneratingBubble =
    Boolean(taskPrompt.trim()) &&
    ACTIVE_RUN_STATUSES.has(runStatus) &&
    !approvalSummary &&
    !awaitingModule &&
    !hasAssistantResponse;

  const chatLifecycleState = useMemo(
    () =>
      deriveChatLifecycleState({
        taskPrompt,
        events,
        runStatus,
        awaitingModule,
        approvalSummary,
        runError,
        isAssistantTyping: Boolean(typingMessageId),
        showGeneratingBubble,
      }),
    [approvalSummary, awaitingModule, events, runError, runStatus, showGeneratingBubble, taskPrompt, typingMessageId],
  );

  const leadingUserCount = useMemo(() => {
    const firstNonUserIndex = items.findIndex((item) => item.type !== "user");
    return firstNonUserIndex < 0 ? items.length : firstNonUserIndex;
  }, [items]);

  const assistantPrimaryArtifacts = useMemo(
    () =>
      items
        .filter((item): item is Extract<StreamItem, { type: "assistant" }> => item.type === "assistant")
        .map((item) => item.primaryArtifact)
        .filter((artifact): artifact is Artifact => artifact !== null),
    [items],
  );

  useEffect(() => {
    let cancelled = false;

    assistantPrimaryArtifacts.forEach((artifact) => {
      if (requestedArtifactIdsRef.current.has(artifact.artifactId)) {
        return;
      }
      requestedArtifactIdsRef.current.add(artifact.artifactId);

      setArtifactBodies((current) => ({
        ...current,
        [artifact.artifactId]: {
          state: "loading",
          content: "",
          contentType: artifact.contentType,
        },
      }));

      void fetchArtifactContent(artifact.uri)
        .then((loaded) => {
          if (cancelled) {
            return;
          }

          setArtifactBodies((current) => ({
            ...current,
            [artifact.artifactId]: {
              state: "loaded",
              content: loaded.content,
              contentType: loaded.contentType,
            },
          }));
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setArtifactBodies((current) => ({
            ...current,
            [artifact.artifactId]: {
              state: "error",
              content: "",
              contentType: artifact.contentType,
            },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [assistantPrimaryArtifacts]);

  useEffect(() => {
    scrollToBottom();
  }, [chatLifecycleState?.key, items.length, latestAnimatedId, scrollToBottom, showGeneratingBubble]);

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
    <div className="workflow-stream-list" ref={listRef}>
      {items.length === 0 && !showGeneratingBubble ? (
        <div className="workflow-stream-empty">
          <div className="workflow-stream-empty-card">
            <div className="workflow-stream-empty-head">
              <span className="workflow-stream-avatar workflow-stream-avatar-system" aria-hidden="true">
                {SystemMeta.avatar}
              </span>
              <div className="workflow-stream-empty-copy">
                <strong className="workflow-stream-empty-title">SciAgent will answer here.</strong>
                <p className="workflow-stream-empty-hint">
                  Start a run and this conversation will turn live agent output into readable replies, with artifacts
                  attached under each response.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {leadingUserCount === 0 && chatLifecycleState ? (
        <div className={`workflow-stream-status workflow-stream-status-${chatLifecycleState.tone}`}>
          <span className="workflow-stream-status-pill">{chatLifecycleState.label}</span>
          <p className="workflow-stream-status-text">{chatLifecycleState.hint}</p>
        </div>
      ) : null}

      {items.map((item, index) => {
        if (item.type === "user") {
          return (
            <div key={item.id} className="workflow-stream-block">
              <article className="workflow-stream-message workflow-stream-message-user">
                <MessageHeader actor={UserMeta} ts={item.ts} />
                <div className="workflow-stream-bubble">
                  <p className="workflow-stream-text">{item.text}</p>
                </div>
              </article>
              {index === leadingUserCount - 1 && chatLifecycleState ? (
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
                extraBadge={<span className="event-badge">approval</span>}
              />
              <div className="workflow-stream-card workflow-stream-card-approval">
                <p className="workflow-stream-text">{item.text}</p>
                {item.actionable ? (
                  <>
                    <textarea
                      value={approvalNote}
                      onChange={(event) => onApprovalNoteChange(event.target.value)}
                      placeholder="Optional note"
                      rows={2}
                      disabled={approving}
                    />
                    <div className="workflow-approval-actions">
                      <button type="button" disabled={approving} onClick={() => onApprove(true)}>
                        {approving ? "Submitting..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={approving}
                        onClick={() => onApprove(false)}
                      >
                        {approving ? "Submitting..." : "Reject"}
                      </button>
                    </div>
                    {runError ? <p className="form-error">{runError}</p> : null}
                  </>
                ) : (
                  <p className="muted">Approval checkpoint recorded.</p>
                )}
              </div>
            </article>
          );
        }

        const isError = item.type === "error";
        const actor = item.type === "assistant" || item.type === "error" ? getAgentMeta(item.agentId) : SystemMeta;
        const artifactState =
          item.type === "assistant" && item.primaryArtifact ? artifactBodies[item.primaryArtifact.artifactId] : null;
        const markdownReady = item.type === "assistant" && artifactState?.state === "loaded" && item.primaryArtifact;
        const showArtifactLoadingHint =
          item.type === "assistant" && item.primaryArtifact && (!artifactState || artifactState.state === "loading");
        const showArtifactErrorHint =
          item.type === "assistant" && item.primaryArtifact && artifactState?.state === "error";
        const showMarkdownPreview =
          item.type === "assistant" && markdownReady && item.primaryArtifact && isMarkdownArtifact(item.primaryArtifact);
        const markdownArtifact = showMarkdownPreview ? item.primaryArtifact : null;
        const showThinkingPanel =
          item.type === "assistant" &&
          item.thinkingSteps.length > 0 &&
          (showArtifactLoadingHint || (item.id === latestAnimatedId && !showMarkdownPreview));

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
                <div className="workflow-stream-thinking">
                  <span className="workflow-stream-thinking-label">Working through</span>
                  <ul className="workflow-stream-thinking-list">
                    {item.thinkingSteps.slice(-4).map((step) => (
                      <li key={`${item.id}-${step}`}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {showMarkdownPreview && markdownArtifact ? (
                <div className="workflow-stream-message-markdown">
                  <StreamingMarkdownPreview
                    contentType={artifactState.contentType}
                    content={artifactState.content}
                    artifactName={markdownArtifact.name}
                    active={item.id === latestAnimatedId}
                    onStep={scrollToBottom}
                    onTypingChange={(active) => {
                      setTypingMessageId((current) => {
                        if (active) {
                          return item.id;
                        }
                        return current === item.id ? null : current;
                      });
                    }}
                  />
                </div>
              ) : (
                <p className="workflow-stream-text">
                  <TypewriterText
                    text={isError ? item.text : item.fallbackText}
                    active={item.id === latestAnimatedId}
                    animateText={isError}
                    showIndicator={
                      isError
                        ? item.id === latestAnimatedId
                        : Boolean(showArtifactLoadingHint) && item.id === latestAnimatedId
                    }
                    onStep={scrollToBottom}
                    onTypingChange={(active) => {
                      setTypingMessageId((current) => {
                        if (active) {
                          return item.id;
                        }
                        return current === item.id ? null : current;
                      });
                    }}
                  />
                </p>
              )}
              {showArtifactLoadingHint && item.type === "assistant" && item.primaryArtifact ? (
                <p className="workflow-stream-inline-note">Loading {item.primaryArtifact.name} preview...</p>
              ) : null}
              {showArtifactErrorHint && item.type === "assistant" && item.primaryArtifact ? (
                <p className="workflow-stream-inline-note workflow-stream-inline-note-danger">
                  Could not load {item.primaryArtifact.name}. Open the attachment directly.
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
            extraBadge={<span className="event-badge event-badge-kind">generating</span>}
          />
          <div className="workflow-stream-bubble workflow-stream-bubble-pending">
            <p className="workflow-stream-text">{getGeneratingCopy(runStatus)}</p>
            <div className="workflow-stream-generating" aria-label="Assistant is generating">
              <span />
              <span />
              <span />
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
};
