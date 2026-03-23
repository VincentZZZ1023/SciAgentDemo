import {
  parseApprovalRequiredPayload,
  parseApprovalResolvedPayload,
  parseMessageFromEvent,
  parseModuleFailedPayload,
  parseModuleFinishedPayload,
  parseModuleSkippedPayload,
  parseModuleStartedPayload,
  type AgentId,
  type Artifact,
  type Event,
} from "../types/events";

export type ConversationMessageRole = "user" | "system" | "agent";
export type ConversationMessageKind = "user" | "assistant" | "status" | "error" | "approval";
export type ConversationTone = "neutral" | "info" | "success" | "danger";

export interface ConversationSegment {
  threadId: string;
  sourceRunId: string | null;
  prompt: string;
  promptTs: number;
  events: Event[];
  runStatus: string;
  awaitingModule: AgentId | null;
  approvalSummary: string | null;
}

export interface ConversationMessage {
  messageId: string;
  role: ConversationMessageRole;
  kind: ConversationMessageKind;
  sourceRunId: string | null;
  threadId: string;
  content: string;
  isStreaming: boolean;
  isComplete: boolean;
  renderedLength: number;
  ts: number;
  label?: string;
  tone?: ConversationTone;
  agentId?: AgentId;
  artifacts: Artifact[];
  primaryArtifact: Artifact | null;
  thinkingSteps: string[];
  actionable?: boolean;
  module?: AgentId;
  severity?: string;
}

interface AssistantTurnBuilder {
  id: string;
  ts: number;
  agentId: AgentId;
  artifactMap: Map<string, Artifact>;
  hints: string[];
  thinkingSteps: string[];
  sourceRunId: string | null;
  threadId: string;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);

const normalizeText = (value: string): string => value.trim().toLowerCase();

const formatStatusLabel = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Status";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const formatAgentLabel = (agentId: AgentId): string => {
  if (agentId === "ideation") {
    return "idea";
  }
  return agentId;
};

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

const isLowValueRunEvent = (summary: string): boolean => {
  const normalized = normalizeText(summary);
  return normalized === "run started" || normalized === "run completed" || normalized === "run failed";
};

const isConnectionEventSummary = (summary: string): boolean => {
  const normalized = normalizeText(summary);
  return normalized === "connected" || normalized === "connecting" || normalized === "reconnecting" || normalized === "disconnected";
};

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

const createMessage = (
  input: Omit<ConversationMessage, "isStreaming" | "isComplete" | "renderedLength">,
): ConversationMessage => ({
  ...input,
  isStreaming: false,
  isComplete: true,
  renderedLength: input.content.length,
});

export const buildConversationMessages = (segments: ConversationSegment[]): ConversationMessage[] => {
  const items: ConversationMessage[] = [];

  segments.forEach((segment, segmentIndex) => {
    const orderedEvents = [...segment.events].sort((left, right) => left.ts - right.ts);
    const hasUserMessage = orderedEvents.some((event) => {
      const message = parseMessageFromEvent(event);
      return message?.role === "user";
    });
    let currentTurn: AssistantTurnBuilder | null = null;

    const flushCurrentTurn = () => {
      if (!currentTurn) {
        return;
      }

      const artifacts = Array.from(currentTurn.artifactMap.values());
      const primaryArtifact = pickPrimaryArtifact(artifacts);
      const fallbackText = buildAssistantFallbackText(currentTurn, primaryArtifact);

      if (artifacts.length > 0 || fallbackText.trim()) {
        items.push(
          createMessage({
            messageId: currentTurn.id,
            ts: currentTurn.ts,
            kind: "assistant",
            role: "agent",
            content: fallbackText,
            sourceRunId: currentTurn.sourceRunId,
            threadId: currentTurn.threadId,
            agentId: currentTurn.agentId,
            artifacts,
            primaryArtifact,
            thinkingSteps: [...currentTurn.thinkingSteps],
          }),
        );
      }

      currentTurn = null;
    };

    const ensureTurn = (event: Event): AssistantTurnBuilder => {
      if (!currentTurn || currentTurn.agentId !== event.agentId) {
        flushCurrentTurn();
        currentTurn = {
          id: `turn-${segment.sourceRunId ?? "thread"}-${event.eventId}`,
          ts: event.ts,
          agentId: event.agentId,
          artifactMap: new Map<string, Artifact>(),
          hints: [],
          thinkingSteps: [],
          sourceRunId: segment.sourceRunId,
          threadId: segment.threadId,
        };
      }

      return currentTurn;
    };

    const pushStatus = (
      id: string,
      ts: number,
      label: string,
      text: string,
      tone: ConversationTone = "neutral",
      sourceRunId: string | null = segment.sourceRunId,
    ) => {
      items.push(
        createMessage({
          messageId: id,
          ts,
          kind: "status",
          role: "system",
          content: text,
          label,
          tone,
          sourceRunId,
          threadId: segment.threadId,
          artifacts: [],
          primaryArtifact: null,
          thinkingSteps: [],
        }),
      );
    };

    if (segment.prompt.trim() && !hasUserMessage) {
      const fallbackTs = orderedEvents[0]?.ts ? Math.max(0, orderedEvents[0].ts - 1) : segment.promptTs || Date.now() + segmentIndex;
      items.push(
        createMessage({
          messageId: `prompt-${segment.sourceRunId ?? segment.threadId}-${segmentIndex}`,
          ts: fallbackTs,
          kind: "user",
          role: "user",
          content: segment.prompt.trim(),
          sourceRunId: segment.sourceRunId,
          threadId: segment.threadId,
          artifacts: [],
          primaryArtifact: null,
          thinkingSteps: [],
        }),
      );
    }

    orderedEvents.forEach((event) => {
      const eventMessage = parseMessageFromEvent(event);
      if (eventMessage) {
        flushCurrentTurn();
        items.push(
          createMessage({
            messageId: `msg-${eventMessage.messageId}`,
            ts: eventMessage.ts,
            kind: eventMessage.role === "user" ? "user" : "assistant",
            role:
              eventMessage.role === "user"
                ? "user"
                : eventMessage.role === "system"
                  ? "system"
                  : "agent",
            content: eventMessage.content,
            sourceRunId: eventMessage.runId ?? segment.sourceRunId,
            threadId: segment.threadId,
            agentId: eventMessage.role === "assistant" ? eventMessage.agentId : undefined,
            artifacts: [],
            primaryArtifact: null,
            thinkingSteps: [],
          }),
        );
        return;
      }

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
        items.push(
          createMessage({
            messageId: `approval-${event.eventId}`,
            ts: event.ts,
            kind: "approval",
            role: "agent",
            content: segment.approvalSummary ?? payload?.summary ?? event.summary,
            sourceRunId: segment.sourceRunId,
            threadId: segment.threadId,
            agentId: event.agentId,
            module: payload?.module ?? event.agentId,
            actionable: segment.awaitingModule === (payload?.module ?? event.agentId),
            artifacts: [],
            primaryArtifact: null,
            thinkingSteps: [],
          }),
        );
        return;
      }

      if (event.kind === "module_finished") {
        const payload = parseModuleFinishedPayload(event);
        if (payload?.status === "failed") {
          flushCurrentTurn();
          items.push(
            createMessage({
              messageId: `error-${event.eventId}`,
              ts: event.ts,
              kind: "error",
              role: "agent",
              content: `${formatStatusLabel(formatAgentLabel(event.agentId))} finished with failure.`,
              sourceRunId: segment.sourceRunId,
              threadId: segment.threadId,
              agentId: event.agentId,
              severity: "error",
              artifacts: [],
              primaryArtifact: null,
              thinkingSteps: [],
            }),
          );
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
        items.push(
          createMessage({
            messageId: `error-${event.eventId}`,
            ts: event.ts,
            kind: "error",
            role: "agent",
            content: payload?.error.message ?? event.summary,
            sourceRunId: segment.sourceRunId,
            threadId: segment.threadId,
            agentId: event.agentId,
            severity: event.severity,
            artifacts: [],
            primaryArtifact: null,
            thinkingSteps: [],
          }),
        );
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
  });

  return items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.messageId.localeCompare(right.messageId);
  });
};

const sameArtifacts = (left: Artifact[], right: Artifact[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((artifact, index) => {
    const candidate = right[index];
    return (
      artifact.artifactId === candidate.artifactId &&
      artifact.name === candidate.name &&
      artifact.uri === candidate.uri &&
      artifact.contentType === candidate.contentType
    );
  });
};

const sameThinkingSteps = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((step, index) => step === right[index]);
};

export const isSameConversationMessage = (left: ConversationMessage, right: ConversationMessage): boolean => {
  return (
    left.messageId === right.messageId &&
    left.role === right.role &&
    left.kind === right.kind &&
    left.sourceRunId === right.sourceRunId &&
    left.threadId === right.threadId &&
    left.content === right.content &&
    left.ts === right.ts &&
    left.label === right.label &&
    left.tone === right.tone &&
    left.agentId === right.agentId &&
    left.actionable === right.actionable &&
    left.module === right.module &&
    left.severity === right.severity &&
    sameArtifacts(left.artifacts, right.artifacts) &&
    ((left.primaryArtifact === null && right.primaryArtifact === null) ||
      (left.primaryArtifact?.artifactId === right.primaryArtifact?.artifactId &&
        left.primaryArtifact?.name === right.primaryArtifact?.name &&
        left.primaryArtifact?.uri === right.primaryArtifact?.uri &&
        left.primaryArtifact?.contentType === right.primaryArtifact?.contentType)) &&
    sameThinkingSteps(left.thinkingSteps, right.thinkingSteps)
  );
};

export const isConversationMessageMarkdownBacked = (message: ConversationMessage): boolean => {
  return Boolean(message.primaryArtifact && isMarkdownArtifact(message.primaryArtifact));
};

export const isConversationMessageStreamable = (message: ConversationMessage): boolean => {
  return message.kind === "assistant" || message.kind === "error";
};

export const isSegmentActive = (segment: ConversationSegment): boolean => {
  return (
    ACTIVE_RUN_STATUSES.has(segment.runStatus.trim().toLowerCase()) ||
    Boolean(segment.awaitingModule) ||
    Boolean(segment.approvalSummary)
  );
};
