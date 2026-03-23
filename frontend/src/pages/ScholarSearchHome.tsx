import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { approveRun, createTopic, getDefaultRunConfig, getRun, getSnapshot, getTopics, startRun } from "../api/client";
import { connectTopicWs, type TopicWsConnection } from "../api/ws";
import { useAuth } from "../auth/AuthContext";
import { BrandWordmark } from "../components/brand";
import { ScholarSidebar, type SidebarRunHistoryItem } from "../components/sidebar/ScholarSidebar";
import { ScholarSearchBox, type ScholarMode } from "../components/search/ScholarSearchBox";
import { RunConfigBar, RUN_MODEL_OPTIONS } from "../components/run/RunConfigBar";
import { RunMessageStream } from "../components/workflow/RunMessageStream";
import { DEFAULT_IDEA_TASTE_MODE, type IdeaTasteMode } from "../lib/ideaPreference";
import { APP_COPY } from "../lib/copy";
import { cloneRunConfig, getRunConfigIdeaTasteMode, runConfigToMode, sanitizeRunConfig } from "../lib/runConfig";
import { useSidebarCollapse } from "../lib/useSidebarCollapse";
import { AGENT_IDS, type AgentId, type Event, type RunConfig, type RunDetail, type TopicSummary } from "../types/events";

type LauncherAgent = "review" | "idea" | "experiment";
type HomeSessionMode = "new" | "history";
const HISTORY_EVENT_LIMIT = 400;
const HISTORY_TITLE_MAX_LENGTH = 20;
const HOME_FADE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface HomeConversationRun {
  topicId: string;
  runId: string;
  prompt: string;
  events: Event[];
  runDetail: RunDetail | null;
  createdAt: number;
}

interface PendingHomeLaunch {
  threadId: string | null;
  runId: string;
  prompt: string;
  createdAt: number;
}

const FRONTEND_FALLBACK_CONFIG: RunConfig = {
  thinkingMode: "quick",
  online: true,
  presetName: "frontend-fallback",
  selectedAgents: ["review", "ideation", "experiment"],
  modules: {
    review: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: false,
    },
    ideation: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: false,
      idea_taste_mode: DEFAULT_IDEA_TASTE_MODE,
    },
    experiment: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: true,
    },
  },
};

const normalizeHistoryRunEvents = (events: Event[], runId: string): Event[] => {
  return [...events]
    .filter((event) => event.runId === runId)
    .sort((left, right) => (left.ts === right.ts ? left.eventId.localeCompare(right.eventId) : left.ts - right.ts));
};

const toHistoryPrompt = (topic: TopicSummary & { description?: string; objective?: string }, fallback: string): string => {
  const prompt = topic.description?.trim() || topic.objective?.trim();
  return prompt || fallback;
};

const modulesToLauncherAgents = (config: RunConfig): LauncherAgent[] => {
  const next: LauncherAgent[] = [];
  if (config.modules.review.enabled) {
    next.push("review");
  }
  if (config.modules.ideation.enabled) {
    next.push("idea");
  }
  if (config.modules.experiment.enabled) {
    next.push("experiment");
  }
  return next;
};

const toHistoryFallbackTitle = (value: string | null | undefined): string => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return APP_COPY.home.runThreadTitleFallback;
  }

  const clipped = normalized.slice(0, HISTORY_TITLE_MAX_LENGTH).trim();
  return clipped || APP_COPY.home.runThreadTitleFallback;
};

const resolveHistoryTitle = (
  topic: Pick<TopicSummary, "topicId" | "title" | "historyTitle">,
  run?: Pick<RunDetail, "historyTitle"> | null,
): string => {
  const runTitle = typeof run?.historyTitle === "string" ? run.historyTitle.trim() : "";
  if (runTitle) {
    return runTitle;
  }

  const topicTitle = typeof topic.historyTitle === "string" ? topic.historyTitle.trim() : "";
  if (topicTitle) {
    return topicTitle;
  }

  return toHistoryFallbackTitle(topic.title || topic.topicId);
};

const toAwaitingModule = (runDetail: RunDetail | null): AgentId | null => {
  if (!runDetail?.awaitingModule) {
    return null;
  }
  return AGENT_IDS.includes(runDetail.awaitingModule as AgentId) ? (runDetail.awaitingModule as AgentId) : null;
};

const upsertConversationRun = (
  current: HomeConversationRun[],
  nextRun: HomeConversationRun,
  mode: "reset" | "append-or-replace",
): HomeConversationRun[] => {
  if (mode === "reset") {
    return [nextRun];
  }

  const existingIndex = current.findIndex((item) => item.runId === nextRun.runId);
  if (existingIndex >= 0) {
    return sortConversationRuns(current.map((item, index) => (index === existingIndex ? nextRun : item)));
  }

  return sortConversationRuns([...current, nextRun]);
};

const upsertRunEvent = (current: Event[], incoming: Event): Event[] => {
  const duplicateIndex = current.findIndex((event) => event.eventId === incoming.eventId);
  const base = duplicateIndex >= 0 ? [...current.slice(0, duplicateIndex), ...current.slice(duplicateIndex + 1)] : current;
  return [...base, incoming].sort((left, right) =>
    left.ts === right.ts ? left.eventId.localeCompare(right.eventId) : left.ts - right.ts,
  );
};

const sortConversationRuns = (runs: HomeConversationRun[]): HomeConversationRun[] => {
  return [...runs].sort((left, right) => {
    const leftTs = left.createdAt || left.runDetail?.createdAt || left.events[0]?.ts || 0;
    const rightTs = right.createdAt || right.runDetail?.createdAt || right.events[0]?.ts || 0;
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    return left.runId.localeCompare(right.runId);
  });
};

export const ScholarSearchHome = () => {
  const navigate = useNavigate();
  const { user, logout, switchAccount } = useAuth();
  const { collapsed, toggleCollapsed } = useSidebarCollapse();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRequestRef = useRef(0);
  const topicWsRef = useRef<TopicWsConnection | null>(null);
  const runPromptsByIdRef = useRef<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [thinkingMode, setThinkingMode] = useState<ScholarMode>("quick");
  const [ideaTasteMode, setIdeaTasteMode] = useState<IdeaTasteMode>(DEFAULT_IDEA_TASTE_MODE);
  const [selectedAgents, setSelectedAgents] = useState<LauncherAgent[]>(["review"]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [defaultConfig, setDefaultConfig] = useState<RunConfig | null>(null);
  const [runConfigDraft, setRunConfigDraft] = useState<RunConfig | null>(null);
  const [historyItems, setHistoryItems] = useState<SidebarRunHistoryItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [conversationThreadId, setConversationThreadId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState("");
  const [conversationRuns, setConversationRuns] = useState<HomeConversationRun[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [runPromptsById, setRunPromptsById] = useState<Record<string, string>>({});
  const [pendingHomeLaunch, setPendingHomeLaunch] = useState<PendingHomeLaunch | null>(null);
  const [homeApprovalNote, setHomeApprovalNote] = useState("");
  const [homeApproving, setHomeApproving] = useState(false);
  const [homeRunError, setHomeRunError] = useState("");

  const toRunStatusBadge = (status: string | undefined): SidebarRunHistoryItem["status"] => {
    if (status === "paused") {
      return "paused";
    }
    if (status === "queued" || status === "running") {
      return "running";
    }
    return "done";
  };

  const formatUpdatedAtLabel = (updatedAt: number): string => {
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return APP_COPY.home.updatedRecently;
    }
    return new Date(updatedAt).toLocaleString();
  };

  const buildHistorySummary = (topic: TopicSummary, run: RunDetail | null): string => {
    const runLabel = run?.runId ?? topic.lastRunId;
    const runText = runLabel ? `${APP_COPY.home.runPrefix} ${runLabel.slice(-8)}` : APP_COPY.home.runPending;
    const moduleLabel = run?.currentModule ? ` | ${run.currentModule}` : "";
    return `${runText}${moduleLabel}`;
  };

  const mergeHistoryItems = (
    incoming: SidebarRunHistoryItem[],
    existing: SidebarRunHistoryItem[],
  ): SidebarRunHistoryItem[] => {
    const merged = [...incoming];
    existing.forEach((item) => {
      if (!item.runId || merged.some((candidate) => candidate.runId === item.runId)) {
        return;
      }
      merged.unshift(item);
    });
    return merged.slice(0, 20);
  };

  const buildRunsHref = (item?: { topicId?: string; runId?: string | null }): string => {
    if (!item?.topicId) {
      return "/runs";
    }
    const params = new URLSearchParams();
    params.set("view", "classic");
    if (item.runId) {
      params.set("runId", item.runId);
    }
    const nextQuery = params.toString();
    return nextQuery ? `/runs/${encodeURIComponent(item.topicId)}?${nextQuery}` : `/runs/${encodeURIComponent(item.topicId)}`;
  };

  const launcherAgentToModule = (agent: LauncherAgent): AgentId => {
    if (agent === "idea") {
      return "ideation";
    }
    return agent;
  };

  const applyLauncherStateToConfig = (
    config: RunConfig,
    agents: LauncherAgent[],
    nextThinkingMode: ScholarMode,
    nextIdeaTasteMode: IdeaTasteMode,
  ): RunConfig => {
    const next = cloneRunConfig(config);
    const selectedModules = new Set(agents.map((agent) => launcherAgentToModule(agent)));
    const orderedSelectedModules = (["review", "ideation", "experiment"] as AgentId[]).filter((agentId) =>
      selectedModules.has(agentId),
    );

    next.thinkingMode = nextThinkingMode;
    next.selectedAgents = orderedSelectedModules;
    next.modules.review.enabled = selectedModules.has("review");
    next.modules.ideation.enabled = selectedModules.has("ideation");
    next.modules.experiment.enabled = selectedModules.has("experiment");
    delete next.modules.review.idea_taste_mode;
    delete next.modules.experiment.idea_taste_mode;

    if (selectedModules.has("ideation")) {
      next.modules.ideation.idea_taste_mode = nextIdeaTasteMode;
    } else {
      delete next.modules.ideation.idea_taste_mode;
    }

    return next;
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoadingConfig(true);
      try {
        const config = await getDefaultRunConfig();
        if (!cancelled) {
          setDefaultConfig(cloneRunConfig(config));
          setRunConfigDraft(cloneRunConfig(config));
          setThinkingMode(runConfigToMode(config));
          setIdeaTasteMode(getRunConfigIdeaTasteMode(config));
          setSelectedAgents(modulesToLauncherAgents(config));
        }
      } catch {
        if (!cancelled) {
          setDefaultConfig(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setRunConfigDraft(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setThinkingMode(runConfigToMode(FRONTEND_FALLBACK_CONFIG));
          setIdeaTasteMode(getRunConfigIdeaTasteMode(FRONTEND_FALLBACK_CONFIG));
          setSelectedAgents(modulesToLauncherAgents(FRONTEND_FALLBACK_CONFIG));
        }
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const topics = await getTopics();
        const orderedTopics = [...topics]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .filter((topic) => Boolean(topic.lastRunId))
          .slice(0, 20);

        const runDetails = await Promise.all(
          orderedTopics.map(async (topic) => {
            if (!topic.lastRunId) {
              return null;
            }
            try {
              return await getRun(topic.lastRunId);
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const nextHistory = orderedTopics.map((topic, index) => {
          const runDetail = runDetails[index];
          const runId = runDetail?.runId ?? topic.lastRunId ?? null;
          return {
            topicId: topic.topicId,
            runId,
            title: resolveHistoryTitle(topic, runDetail),
            summary: buildHistorySummary(topic, runDetail),
            status: toRunStatusBadge(runDetail?.status),
            updatedAtLabel: formatUpdatedAtLabel(topic.updatedAt),
          } satisfies SidebarRunHistoryItem;
        });

        setHistoryItems((current) => mergeHistoryItems(nextHistory, current));
      } catch {
        if (!cancelled) {
          setHistoryItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const toTopicName = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return APP_COPY.home.newRunFallbackTitle;
    }
    return trimmed.slice(0, 64);
  };

  const getErrorMessage = (input: unknown): string => {
    if (input instanceof Error) {
      return input.message;
    }
    return APP_COPY.home.createRunError;
  };

  const toPromptSummary = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return APP_COPY.home.newRunFallbackSummary;
    }
    const normalized = trimmed.replace(/\s+/g, " ");
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
  };

  const upsertHistoryItem = (
    current: SidebarRunHistoryItem[],
    nextItem: SidebarRunHistoryItem,
  ): SidebarRunHistoryItem[] => {
    const deduped = current.filter((item) => item.topicId !== nextItem.topicId);
    return [nextItem, ...deduped].slice(0, 20);
  };

  useEffect(() => {
    runPromptsByIdRef.current = runPromptsById;
  }, [runPromptsById]);

  const buildConversationRunsFromSnapshot = (options: {
    topicId: string;
    title: string;
    selectedRunId: string;
    snapshot: Awaited<ReturnType<typeof getSnapshot>>;
    promptFallback?: string;
    existingRuns?: HomeConversationRun[];
    selectedRunDetail?: RunDetail | null;
  }): HomeConversationRun[] => {
    const { topicId, title, selectedRunId, snapshot, promptFallback, existingRuns = [], selectedRunDetail } = options;
    const snapshotEvents = snapshot.events ?? [];
    const orderedEvents = [...snapshotEvents].sort((left, right) =>
      left.ts === right.ts ? left.eventId.localeCompare(right.eventId) : left.ts - right.ts,
    );
    const existingRunsById = new Map(existingRuns.map((run) => [run.runId, run]));
    const runIds = Array.from(new Set(orderedEvents.map((event) => event.runId).filter(Boolean)));

    if (snapshot.activeRun?.runId && !runIds.includes(snapshot.activeRun.runId)) {
      runIds.push(snapshot.activeRun.runId);
    }
    if (selectedRunId && !runIds.includes(selectedRunId)) {
      runIds.push(selectedRunId);
    }

    const runs = runIds.map((runId, index) => {
      const existingRun = existingRunsById.get(runId);
      const runDetail =
        runId === selectedRunId
          ? selectedRunDetail ?? existingRun?.runDetail ?? (snapshot.activeRun?.runId === runId ? snapshot.activeRun : null)
          : existingRun?.runDetail ?? (snapshot.activeRun?.runId === runId ? snapshot.activeRun : null);
      const prompt =
        runPromptsByIdRef.current[runId] ||
        existingRun?.prompt ||
        (runId === selectedRunId ? promptFallback || toHistoryPrompt(snapshot.topic, title) : APP_COPY.home.followUpRequest);
      const eventsForRun = normalizeHistoryRunEvents(orderedEvents, runId);
      const createdAt = existingRun?.createdAt || runDetail?.createdAt || eventsForRun[0]?.ts || snapshot.topic.updatedAt + index;

      return {
        topicId,
        runId,
        prompt,
        events: eventsForRun,
        runDetail,
        createdAt,
      } satisfies HomeConversationRun;
    });

    return sortConversationRuns(runs);
  };

  const syncConversationThread = async (options: {
    topicId: string;
    runId: string;
    title: string;
    promptFallback?: string;
    mode: "reset" | "append-or-replace";
    showLoader?: boolean;
  }) => {
    const requestId = ++conversationRequestRef.current;
    const { topicId, runId, title, promptFallback, mode, showLoader = false } = options;

    if (showLoader) {
      setLoadingConversation(true);
      setConversationLoadError("");
      if (mode === "reset") {
        setConversationRuns([]);
      }
    }

    try {
      const [snapshot, runDetail] = await Promise.all([getSnapshot(topicId, HISTORY_EVENT_LIMIT), getRun(runId).catch(() => null)]);

      if (conversationRequestRef.current !== requestId) {
        return;
      }

      const fallbackRunDetail = snapshot.activeRun && snapshot.activeRun.runId === runId ? snapshot.activeRun : null;
      const nextRunDetail = runDetail ?? fallbackRunDetail;
      const nextPrompt = promptFallback || runPromptsByIdRef.current[runId] || toHistoryPrompt(snapshot.topic, title);
      const nextDisplayTitle = resolveHistoryTitle(snapshot.topic, nextRunDetail);

      setConversationThreadId(topicId);
      setConversationTitle(nextDisplayTitle);
      setActiveRunId(runId);
      setConversationRuns((current) =>
        buildConversationRunsFromSnapshot({
          topicId,
          title: nextDisplayTitle,
          selectedRunId: runId,
          snapshot,
          promptFallback: nextPrompt,
          existingRuns: mode === "reset" ? [] : current.filter((item) => item.topicId === topicId),
          selectedRunDetail: nextRunDetail,
        }),
      );
      setRunPromptsById((current) => ({ ...current, [runId]: nextPrompt }));
      setHistoryItems((current) =>
        upsertHistoryItem(current, {
          topicId,
          runId,
          title: nextDisplayTitle,
          summary: buildHistorySummary(snapshot.topic, nextRunDetail),
          status: toRunStatusBadge(nextRunDetail?.status),
          updatedAtLabel: formatUpdatedAtLabel(snapshot.topic.updatedAt),
        }),
      );

      if (nextRunDetail) {
        setHistoryItems((current) =>
          current.map((item) =>
            item.topicId === topicId
              ? {
                  ...item,
                  runId,
                  title: nextDisplayTitle,
                  status: toRunStatusBadge(nextRunDetail.status),
                }
              : item,
          ),
        );
      }

      if (showLoader) {
        setConversationLoadError("");
      }
    } catch (loadError) {
      if (conversationRequestRef.current !== requestId) {
        return;
      }

      if (mode === "reset") {
        setConversationRuns([]);
      }
      setConversationLoadError(getErrorMessage(loadError));
    } finally {
      if (showLoader && conversationRequestRef.current === requestId) {
        setLoadingConversation(false);
      }
    }
  };

  const primarySelectedAgent = selectedAgents[0] ?? "review";
  const selectedModules = useMemo(
    () => selectedAgents.map((agent) => launcherAgentToModule(agent)),
    [selectedAgents],
  );

  const activeRunConfig = useMemo(() => {
    if (!runConfigDraft) {
      return applyLauncherStateToConfig(
        FRONTEND_FALLBACK_CONFIG,
        selectedAgents,
        thinkingMode,
        ideaTasteMode,
      );
    }
    return applyLauncherStateToConfig(runConfigDraft, selectedAgents, thinkingMode, ideaTasteMode);
  }, [ideaTasteMode, runConfigDraft, selectedAgents, thinkingMode]);

  const sessionMode: HomeSessionMode = activeRunId ? "history" : "new";
  const activeThreadItem = useMemo(() => {
    if (!conversationThreadId) {
      return null;
    }
    return historyItems.find((item) => item.topicId === conversationThreadId) ?? null;
  }, [conversationThreadId, historyItems]);
  const activeConversationRun = useMemo(() => {
    if (!activeRunId) {
      return conversationRuns[conversationRuns.length - 1] ?? null;
    }
    return conversationRuns.find((item) => item.runId === activeRunId) ?? conversationRuns[conversationRuns.length - 1] ?? null;
  }, [activeRunId, conversationRuns]);
  const activeAwaitingModule = useMemo(
    () => toAwaitingModule(activeConversationRun?.runDetail ?? null),
    [activeConversationRun],
  );
  const activeApprovalSummary = useMemo(() => {
    if (!activeConversationRun?.runDetail?.awaitingApproval || !activeAwaitingModule) {
      return null;
    }
    return APP_COPY.home.approvalWaiting(activeAwaitingModule);
  }, [activeAwaitingModule, activeConversationRun]);
  const activeRunStatus = activeConversationRun?.runDetail?.status ?? "idle";
  const isNewChat = sessionMode === "new";
  const inputPlaceholder =
    sessionMode === "history"
      ? APP_COPY.home.continuePlaceholder
      : APP_COPY.home.newChatPlaceholder;
  const canSubmit = selectedAgents.length > 0 && (isNewChat ? query.trim().length > 0 : true);
  const homeConversationSegments = useMemo(
    () =>
      conversationRuns.map((conversationRun) => ({
        threadId: conversationThreadId ?? conversationRun.topicId,
        sourceRunId: conversationRun.runId,
        prompt: conversationRun.prompt,
        promptTs: conversationRun.createdAt,
        events: conversationRun.events,
        runStatus:
          conversationRun.runDetail?.status ?? (conversationRun.runId === activeRunId ? activeRunStatus : "completed"),
        awaitingModule: conversationRun.runId === activeRunId ? activeAwaitingModule : null,
        approvalSummary: conversationRun.runId === activeRunId ? activeApprovalSummary : null,
      })),
    [activeApprovalSummary, activeAwaitingModule, activeRunId, activeRunStatus, conversationRuns, conversationThreadId],
  );

  const homeDisplaySegments = useMemo(() => {
    if (!pendingHomeLaunch) {
      return homeConversationSegments;
    }

    const pendingSegment = {
      threadId: pendingHomeLaunch.threadId ?? conversationThreadId ?? "pending-home-thread",
      sourceRunId: pendingHomeLaunch.runId,
      prompt: pendingHomeLaunch.prompt,
      promptTs: pendingHomeLaunch.createdAt,
      events: [] as Event[],
      runStatus: "queued",
      awaitingModule: null,
      approvalSummary: null,
    };

    if (homeConversationSegments.some((segment) => segment.sourceRunId === pendingSegment.sourceRunId)) {
      return homeConversationSegments;
    }

    return [...homeConversationSegments, pendingSegment];
  }, [conversationThreadId, homeConversationSegments, pendingHomeLaunch]);

  const handleModeChange = (nextMode: ScholarMode) => {
    setThinkingMode(nextMode);
    setError("");
  };

  const handleConfigChange = (nextConfig: RunConfig) => {
    setRunConfigDraft(cloneRunConfig(nextConfig));
    setThinkingMode(runConfigToMode(nextConfig));
    setIdeaTasteMode(getRunConfigIdeaTasteMode(nextConfig));
    setSelectedAgents(modulesToLauncherAgents(nextConfig));
    setError("");
  };

  const handleResetConfig = () => {
    const base = defaultConfig ? cloneRunConfig(defaultConfig) : cloneRunConfig(FRONTEND_FALLBACK_CONFIG);
    const next = runConfigDraft ? cloneRunConfig(runConfigDraft) : cloneRunConfig(base);

    next.online = base.online;
    selectedModules.forEach((moduleId) => {
      next.modules[moduleId] = cloneRunConfig(base).modules[moduleId];
    });

    setRunConfigDraft(next);
    setIdeaTasteMode(getRunConfigIdeaTasteMode(next));
    setSelectedAgents(modulesToLauncherAgents(next));
    setError("");
  };

  const toggleAgent = (agent: LauncherAgent) => {
    const agentOrder: LauncherAgent[] = ["review", "idea", "experiment"];

    setSelectedAgents((current) => {
      const next = current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent];
      return [...next].sort((left, right) => agentOrder.indexOf(left) - agentOrder.indexOf(right));
    });
    setError("");
  };

  const agentChips = [
    {
      key: "review" as const,
      label: "review",
      active: selectedAgents.includes("review"),
    },
    {
      key: "idea" as const,
      label: "idea",
      active: selectedAgents.includes("idea"),
    },
    {
      key: "experiment" as const,
      label: "experiment",
      active: selectedAgents.includes("experiment"),
    },
  ];

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError(APP_COPY.home.emptyTaskError);
      focusInput();
      return;
    }
    if (selectedAgents.length === 0) {
      setError(APP_COPY.home.noAgentError);
      return;
    }

    setError("");
    setSubmitting(true);
    setConversationLoadError("");

    try {
      const pendingRunId = `pending-${Date.now()}`;
      setPendingHomeLaunch({
        threadId: conversationThreadId,
        runId: pendingRunId,
        prompt: trimmed,
        createdAt: Date.now(),
      });

      const promptSummary = toPromptSummary(trimmed);
      const submitConfig = sanitizeRunConfig(activeRunConfig);

      if (isNewChat || !conversationThreadId) {
        const topicTitle = toTopicName(trimmed);
        const fallbackHistoryTitle = toHistoryFallbackTitle(trimmed);
        const topic = await createTopic(topicTitle, trimmed);
        const run = await startRun(topic.topicId, { prompt: trimmed, config: submitConfig });
        const nextItem: SidebarRunHistoryItem = {
          topicId: topic.topicId,
          runId: run.runId,
          title: resolveHistoryTitle(topic, run) || fallbackHistoryTitle,
          summary: promptSummary,
          status: toRunStatusBadge(run.status),
          updatedAtLabel: formatUpdatedAtLabel(run.createdAt),
        };

        setConversationThreadId(topic.topicId);
        setConversationTitle(nextItem.title);
        setActiveRunId(run.runId);
        setConversationRuns([
          {
            topicId: topic.topicId,
            runId: run.runId,
            prompt: trimmed,
            events: [],
            runDetail: run,
            createdAt: run.createdAt,
          },
        ]);
        setPendingHomeLaunch(null);
        setRunPromptsById((current) => ({ ...current, [run.runId]: trimmed }));
        setHistoryItems((current) => upsertHistoryItem(current, nextItem));
        void syncConversationThread({
          topicId: topic.topicId,
          runId: run.runId,
          title: nextItem.title,
          promptFallback: trimmed,
          mode: "append-or-replace",
        });
      } else {
        const run = await startRun(conversationThreadId, { prompt: trimmed, config: submitConfig });
        const nextTitle = conversationTitle || activeThreadItem?.title || APP_COPY.home.runThreadTitleFallback;
        const nextItem: SidebarRunHistoryItem = {
          topicId: conversationThreadId,
          runId: run.runId,
          title: nextTitle,
          summary: promptSummary,
          status: toRunStatusBadge(run.status),
          updatedAtLabel: formatUpdatedAtLabel(run.createdAt),
        };

        setActiveRunId(run.runId);
        setConversationRuns((current) =>
          upsertConversationRun(
            current,
            {
              topicId: conversationThreadId,
              runId: run.runId,
              prompt: trimmed,
              events: [],
              runDetail: run,
              createdAt: run.createdAt,
            },
            "append-or-replace",
          ),
        );
        setPendingHomeLaunch(null);
        setRunPromptsById((current) => ({ ...current, [run.runId]: trimmed }));
        setHistoryItems((current) => upsertHistoryItem(current, nextItem));
        void syncConversationThread({
          topicId: conversationThreadId,
          runId: run.runId,
          title: nextTitle,
          promptFallback: trimmed,
          mode: "append-or-replace",
        });
      }

      setQuery("");
      setConfigExpanded(false);
    } catch (submitError) {
      setPendingHomeLaunch(null);
      setError(getErrorMessage(submitError));
      focusInput();
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewChat = () => {
    conversationRequestRef.current += 1;
    setActiveRunId(null);
    setConversationThreadId(null);
    setConversationTitle("");
    setConversationRuns([]);
    setPendingHomeLaunch(null);
    setConversationLoadError("");
    setLoadingConversation(false);
    setQuery("");
    setError("");
    setConfigExpanded(false);
    focusInput();
  };

  const handleOpenRuns = () => {
    if (conversationThreadId) {
      navigate(buildRunsHref({ topicId: conversationThreadId, runId: activeRunId }));
      return;
    }
    navigate("/runs");
  };

  const handleSelectHistoryItem = (item: SidebarRunHistoryItem) => {
    if (!item.runId) {
      return;
    }

    setActiveRunId(item.runId);
    setConversationThreadId(item.topicId);
    setConversationTitle(item.title);
    setConversationRuns([]);
    setPendingHomeLaunch(null);
    setLoadingConversation(true);
    setConversationLoadError("");
    setQuery("");
    setError("");
    setHomeApprovalNote("");
    setHomeRunError("");
    setConfigExpanded(false);
    void syncConversationThread({
      topicId: item.topicId,
      runId: item.runId,
      title: item.title,
      mode: "reset",
      showLoader: true,
    });
  };

  const handleApproveFromHome = async (approved: boolean) => {
    if (!activeRunId || !activeAwaitingModule || !conversationThreadId) {
      return;
    }

    setHomeApproving(true);
    setHomeRunError("");
    try {
      await approveRun(activeRunId, {
        module: activeAwaitingModule,
        approved,
        note: homeApprovalNote.trim() || undefined,
      });
      setHomeApprovalNote("");
      await syncConversationThread({
        topicId: conversationThreadId,
        runId: activeRunId,
        title: conversationTitle || activeThreadItem?.title || APP_COPY.home.runThreadTitleFallback,
        mode: "append-or-replace",
      });
    } catch (approvalError) {
      setHomeRunError(getErrorMessage(approvalError));
    } finally {
      setHomeApproving(false);
    }
  };

  useEffect(() => {
    topicWsRef.current?.close();
    topicWsRef.current = null;

    if (!conversationThreadId) {
      return undefined;
    }

    topicWsRef.current = connectTopicWs({
      topicId: conversationThreadId,
      onError: () => {
        // Keep the home chat resilient on transient websocket errors.
      },
      onEvent: (event) => {
        if (event.topicId !== conversationThreadId) {
          return;
        }

        setConversationRuns((current) => {
          const existingIndex = current.findIndex((item) => item.runId === event.runId);
          if (existingIndex < 0) {
            return sortConversationRuns([
              ...current,
              {
                topicId: conversationThreadId,
                runId: event.runId,
                prompt: runPromptsByIdRef.current[event.runId] || APP_COPY.home.followUpRequest,
                events: [event],
                runDetail: null,
                createdAt: event.ts,
              },
            ]);
          }

          return current.map((item, index) =>
            index === existingIndex
              ? {
                  ...item,
                  events: upsertRunEvent(item.events, event),
                }
              : item,
          );
        });

        if (["module_started", "module_finished", "module_skipped", "module_failed", "approval_required", "approval_resolved"].includes(event.kind)) {
          void getRun(event.runId)
            .then((detail) => {
              setConversationRuns((current) =>
                current.map((item) =>
                  item.runId === detail.runId
                    ? {
                        ...item,
                        runDetail: detail,
                        createdAt: item.createdAt || detail.createdAt,
                      }
                    : item,
                ),
              );
              setHistoryItems((current) =>
                current.map((item) =>
                  item.topicId === detail.topicId
                    ? {
                        ...item,
                        runId: detail.runId,
                        title: detail.historyTitle?.trim() || item.title,
                        status: toRunStatusBadge(detail.status),
                      }
                    : item,
                ),
              );
              if (detail.runId === activeRunId && detail.historyTitle?.trim()) {
                setConversationTitle(detail.historyTitle.trim());
              }
            })
            .catch(() => {
              // Keep page resilient on transient failures.
            });
        }
      },
    });

    return () => {
      topicWsRef.current?.close();
      topicWsRef.current = null;
    };
  }, [conversationThreadId]);

  useEffect(() => {
    if (!configExpanded) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfigExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [configExpanded]);

  return (
    <section className="scholar-home-page">
      <ScholarSidebar
        user={user}
        historyItems={historyItems}
        loadingHistory={loadingHistory}
        activeRunId={activeRunId}
        sessionMode={sessionMode}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onNewChat={handleNewChat}
        onOpenRuns={handleOpenRuns}
        onSelectHistoryItem={handleSelectHistoryItem}
        onSwitchAccount={() => {
          switchAccount();
          navigate("/login", { replace: true });
        }}
        onLogout={() => {
          logout();
          navigate("/login", { replace: true });
        }}
      />

      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden bg-surface">
        <header className="flex justify-between items-center w-full px-6 h-16 bg-[#f5f7f9]/70 backdrop-blur-xl z-50 shadow-sm">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="ml-2 w-8 h-8 rounded-full overflow-hidden bg-surface-container-high border border-outline-variant/20 flex items-center justify-center text-xs font-bold">
              {(user?.username ?? "S").slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        <div
          className={[
            "flex-1 min-h-0 flex flex-col items-center px-6 max-w-5xl mx-auto w-full relative",
            homeDisplaySegments.length > 0 ? "justify-start py-0" : "justify-center",
          ].join(" ")}
        >
          <div
            className={
              isNewChat && homeDisplaySegments.length === 0
                ? "w-full"
                : "w-full h-full min-h-0 overflow-y-auto overflow-x-hidden"
            }
          >
                  {homeDisplaySegments.length > 0 ? (
              <div className="w-full min-h-0 py-8">
                <RunMessageStream
                  segments={homeDisplaySegments}
                  taskPrompt={pendingHomeLaunch?.prompt ?? activeConversationRun?.prompt ?? ""}
                  events={activeConversationRun?.events ?? []}
                  awaitingModule={activeAwaitingModule}
                  approvalSummary={activeApprovalSummary}
                  approvalNote={homeApprovalNote}
                  approving={homeApproving}
                  runError={homeRunError}
                  runStatus={activeRunStatus}
                  embedded
                  onApprovalNoteChange={setHomeApprovalNote}
                  onApprove={(approved) => { void handleApproveFromHome(approved); }}
                  onOpenArtifact={() => {
                    navigate(
                      buildRunsHref({
                        topicId: conversationThreadId ?? activeConversationRun?.topicId,
                        runId: activeRunId ?? undefined,
                      }),
                    );
                  }}
                />
              </div>
            ) : isNewChat ? (
              <div className="scholar-home-welcome-layout">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.56, ease: HOME_FADE_EASE }}
                  className="text-center mb-12"
                >
                  <motion.h2
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.58, delay: 0.04, ease: HOME_FADE_EASE }}
                    className="scholar-home-hero-title"
                  >
                    <span className="scholar-home-hero-text scholar-home-hero-text-sheen" data-text="今天想让">
                      今天想让
                    </span>
                    <span className="scholar-home-hero-wordmark" aria-label="xcientist">
                      <BrandWordmark size={304} theme="light" />
                    </span>
                    <span className="scholar-home-hero-text scholar-home-hero-text-sheen" data-text="做什么？">
                      做什么？
                    </span>
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.54, delay: 0.1, ease: HOME_FADE_EASE }}
                    className="mx-auto mt-5 max-w-2xl text-[15px] font-normal leading-7 tracking-[0.01em] text-[#64748b] md:text-[17px]"
                  >
                    {APP_COPY.home.welcomeDesc}
                  </motion.p>
                </motion.div>

                <div className="w-full">
                  {conversationLoadError && conversationRuns.length > 0 ? <p className="form-error">{conversationLoadError}</p> : null}
                  {error ? <p className="form-error">{error}</p> : null}
                  <ScholarSearchBox
                    query={query}
                    mode={thinkingMode}
                    ideaTasteMode={ideaTasteMode}
                    ideaPreferenceEnabled={selectedAgents.includes("idea")}
                    placeholder={APP_COPY.searchBox.defaultPlaceholder}
                    prominent
                    disabled={loadingConfig}
                    configExpanded={configExpanded}
                    agentChips={agentChips}
                    onQueryChange={setQuery}
                    onModeChange={handleModeChange}
                    onIdeaTasteModeChange={setIdeaTasteMode}
                    onAgentSelect={toggleAgent}
                    onToggleConfig={() => setConfigExpanded((current) => !current)}
                    onSubmit={() => void handleSearch()}
                    submitting={submitting}
                    canSubmit={canSubmit}
                    inputRef={inputRef}
                  />
                </div>
              </div>
            ) : loadingConversation && conversationRuns.length === 0 ? (
              <div className="scholar-home-conversation-empty scholar-home-conversation-empty-loading">
                <div className="scholar-home-conversation-loader" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <strong>{APP_COPY.home.loadingConversationTitle}</strong>
                <p>{APP_COPY.home.loadingConversationDesc}</p>
              </div>
            ) : conversationLoadError && conversationRuns.length === 0 ? (
              <div className="scholar-home-conversation-error">
                <p className="form-error">{conversationLoadError}</p>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="p-6 text-center text-[10px] text-on-surface-variant/40 tracking-widest uppercase font-bold">
          XCIENTIST AI ENGINE V4.2 • SECURE ENTERPRISE INSTANCE
        </footer>

        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] -mr-64 -mt-64 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-tertiary/5 rounded-full blur-[140px] -ml-80 -mb-80 pointer-events-none" />
      </main>
      {configExpanded ? (
        <div className="scholar-config-flyout-shell" role="presentation">
          <button
            type="button"
            className="scholar-config-flyout-backdrop"
            aria-label={APP_COPY.home.closeRunConfigAria}
            onClick={() => setConfigExpanded(false)}
          />
          <aside className="scholar-config-flyout" aria-label={APP_COPY.home.runConfigPanelAria}>
            <div className="scholar-config-flyout-header">
              <div>
                <h2>{APP_COPY.home.configTitle}</h2>
                <p>
                  {selectedAgents.length === 1
                    ? APP_COPY.home.singleAgentConfig(primarySelectedAgent === "idea" ? "idea" : primarySelectedAgent)
                    : APP_COPY.home.multiAgentConfig(selectedAgents.length)}
                </p>
              </div>
              <button
                type="button"
                className="scholar-config-flyout-close"
                onClick={() => setConfigExpanded(false)}
              >
                {APP_COPY.common.close}
              </button>
            </div>
            <div className="scholar-config-flyout-body">
              {selectedModules.length === 0 ? (
                <section className="run-config-bar muted">{APP_COPY.home.configEmpty}</section>
              ) : (
                <RunConfigBar
                  config={activeRunConfig}
                  loading={loadingConfig}
                  onChange={handleConfigChange}
                  onReset={handleResetConfig}
                  showIdeaPreference
                  ideaPreferenceEnabled={selectedAgents.includes("idea")}
                  ideaTasteMode={ideaTasteMode}
                  ideaPreferenceHint={selectedAgents.includes("idea") ? APP_COPY.searchBox.ideaPreferenceActive : APP_COPY.searchBox.ideaPreferenceInactive}
                  onIdeaTasteModeChange={setIdeaTasteMode}
                />
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
};




