
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import {
  approveRun,
  fetchArtifactContent,
  getDefaultRunConfig,
  getRun,
  getSnapshot,
  getTopicTrace,
  sendAgentCommand,
  startRun,
} from "../api/client";
import { connectTopicWs, type TopicWsConnection, type WsStatus } from "../api/ws";
import type { AppLayoutContext } from "../app/AppLayout";
import { ArtifactContentView } from "../components/artifact/ArtifactContentView";
import { AgentDrawer } from "../components/cli/AgentDrawer";
import { EventFeed } from "../components/feed/EventFeed";
import { FlowCanvas } from "../components/flow/FlowCanvas";
import { Composer } from "../components/run/Composer";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  APP_COPY,
  formatAgentLabel,
  formatBooleanLabel,
  formatEventKindLabel,
  formatOnlineLabel,
  formatRunStatusLabel,
  formatSeverityLabel,
  formatTopicStatusLabel,
  formatWsStatusLabel,
} from "../lib/copy";
import { cloneRunConfig, runConfigToMode, sanitizeRunConfig } from "../lib/runConfig";
import { type DrawerTab } from "../components/workflow/DrawerTabHeader";
import { RunMessageStream } from "../components/workflow/RunMessageStream";
import { WorkflowDrawer } from "../components/workflow/WorkflowDrawer";
import { WorkflowTracePanel, type TraceView } from "../components/workflow/WorkflowTracePanel";
import {
  AGENT_IDS,
  isRunConfig,
  mapEventToTraceItems,
  parseAgentSubtasksFromEvent,
  parseApprovalRequiredPayload,
  parseWsEvent,
  type AgentId,
  type AgentStatus,
  type AgentSubtask,
  type Artifact,
  type Event,
  type RunConfig,
  type RunDetail,
  type TopicDetail,
  type TraceItem,
} from "../types/events";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return APP_COPY.common.requestFailed;
};

const createEmptyStatus = (agentId: AgentId): AgentStatus => ({
  agentId,
  status: "idle",
  progress: 0,
  lastUpdate: 0,
  runId: null,
  lastSummary: "idle",
});

const createDefaultAgentRecord = (): Record<AgentId, AgentStatus> => ({
  review: createEmptyStatus("review"),
  ideation: createEmptyStatus("ideation"),
  experiment: createEmptyStatus("experiment"),
});

const createDefaultSubtasksRecord = (): Record<AgentId, AgentSubtask[]> => ({
  review: [],
  ideation: [],
  experiment: [],
});

const mergeArtifacts = (current: Artifact[], incoming: Artifact[]): Artifact[] => {
  const map = new Map<string, Artifact>();
  [...current, ...incoming].forEach((artifact) => map.set(artifact.artifactId, artifact));
  return Array.from(map.values());
};

const mergeTraceItems = (current: TraceItem[], incoming: TraceItem[]): TraceItem[] => {
  const map = new Map<string, TraceItem>();
  [...current, ...incoming].forEach((item) => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
};

const normalizeEvents = (rawEvents: unknown[]): Event[] => {
  return rawEvents.map(parseWsEvent).filter((event): event is Event => Boolean(event));
};

const eventFieldString = (value: unknown): string => (typeof value === "string" ? value : "");

const eventFieldNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeSearchText = (value: string): string => value.trim().toLowerCase();

const getEventStableId = (event: Event): string =>
  eventFieldString((event as Event & { id?: unknown }).eventId) ||
  eventFieldString((event as Event & { id?: unknown }).id);

const compareEventsStable = (left: Event, right: Event): number => {
  const tsDiff = eventFieldNumber(left.ts) - eventFieldNumber(right.ts);
  if (tsDiff !== 0) {
    return tsDiff;
  }

  const runDiff = eventFieldString(left.runId).localeCompare(eventFieldString(right.runId));
  if (runDiff !== 0) {
    return runDiff;
  }

  const agentDiff = eventFieldString(left.agentId).localeCompare(eventFieldString(right.agentId));
  if (agentDiff !== 0) {
    return agentDiff;
  }

  const kindDiff = eventFieldString(left.kind).localeCompare(eventFieldString(right.kind));
  if (kindDiff !== 0) {
    return kindDiff;
  }

  return getEventStableId(left).localeCompare(getEventStableId(right));
};

const findEventInsertIndex = (sortedEvents: Event[], incoming: Event): number => {
  let low = 0;
  let high = sortedEvents.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (compareEventsStable(sortedEvents[mid], incoming) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

const upsertSortedEvent = (current: Event[], incoming: Event, maxSize = 1500): Event[] => {
  const incomingId = getEventStableId(incoming);
  let nextBase = current;

  if (incomingId) {
    const duplicateIndex = current.findIndex((item) => getEventStableId(item) === incomingId);
    if (duplicateIndex >= 0) {
      nextBase = [...current.slice(0, duplicateIndex), ...current.slice(duplicateIndex + 1)];
    }
  }

  const insertIndex = findEventInsertIndex(nextBase, incoming);
  const next = [
    ...nextBase.slice(0, insertIndex),
    incoming,
    ...nextBase.slice(insertIndex),
  ];

  if (next.length <= maxSize) {
    return next;
  }

  return next.slice(next.length - maxSize);
};

const toSortedEvents = (incoming: Event[], maxSize = 1500): Event[] => {
  if (incoming.length === 0) {
    return [];
  }

  const deduped = new Map<string, Event>();
  for (const event of incoming) {
    const eventId = getEventStableId(event);
    if (!eventId) {
      continue;
    }
    deduped.set(eventId, event);
  }

  return Array.from(deduped.values())
    .sort(compareEventsStable)
    .slice(-maxSize);
};

const formatEventTime = (ts: number): string => new Date(ts).toLocaleString();
const formatJsonPretty = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getEventModule = (event: Event): string => {
  const moduleFromPayload = event.payload?.module;
  if (typeof moduleFromPayload === "string" && moduleFromPayload.length > 0) {
    return moduleFromPayload;
  }
  return event.agentId;
};

const toRunStatusClass = (status: string): string => `status-${status || "idle"}`;
const getWsStatusLabel = (status: WsStatus): string => formatWsStatusLabel(status === "closed" ? "disconnected" : status);

type ClassicPrimaryTab = "chat" | "pipeline" | "trace";
const normalizeClassicPrimaryTab = (value: string | null): ClassicPrimaryTab => {
  if (value === "pipeline" || value === "trace" || value === "chat") {
    return value;
  }
  return "pipeline";
};

export const TopicPage = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { topics, refreshTopics } = useOutletContext<AppLayoutContext>();

  const wsRef = useRef<TopicWsConnection | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [agentsStatus, setAgentsStatus] = useState<Record<AgentId, AgentStatus>>(createDefaultAgentRecord());
  const [events, setEvents] = useState<Event[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [agentSubtasks, setAgentSubtasks] = useState<Record<AgentId, AgentSubtask[]>>(createDefaultSubtasksRecord());

  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [traceError, setTraceError] = useState("");

  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [submittingRun, setSubmittingRun] = useState(false);
  const [error, setError] = useState("");
  const [wsStatus, setWsStatus] = useState<WsStatus>("closed");
  const [wsStatusTransitioning, setWsStatusTransitioning] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("log");
  const [logModuleFilter, setLogModuleFilter] = useState("all");
  const [logKindFilter, setLogKindFilter] = useState("all");
  const [logSeverityFilter, setLogSeverityFilter] = useState("all");
  const [traceView, setTraceView] = useState<TraceView>("timeline");

  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);

  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState("");

  const [defaultRunConfig, setDefaultRunConfig] = useState<RunConfig | null>(null);
  const [runConfigDraft, setRunConfigDraft] = useState<RunConfig | null>(null);
  const [loadingRunConfig, setLoadingRunConfig] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get("runId"));
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runError, setRunError] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvalSummary, setApprovalSummary] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactModalTitle, setArtifactModalTitle] = useState("");
  const [artifactModalType, setArtifactModalType] = useState("text/plain");
  const [artifactModalContent, setArtifactModalContent] = useState("");
  const [artifactModalLoading, setArtifactModalLoading] = useState(false);
  const [artifactModalError, setArtifactModalError] = useState("");
  const [submittedPromptsByRunId, setSubmittedPromptsByRunId] = useState<Record<string, string>>({});

  const queryTopicId = searchParams.get("topicId");
  const queryRunId = searchParams.get("runId");
  const queryDraft = searchParams.get("draft");
  const queryView = searchParams.get("view");
  const queryTab = searchParams.get("tab");
  const isClassicView = queryView === "classic";
  const classicPrimaryTab = normalizeClassicPrimaryTab(queryTab);
  const wsStatusLabel = getWsStatusLabel(wsStatus);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    if (wsStatus === "connected") {
      setWsStatusTransitioning(false);
      return undefined;
    }

    setWsStatusTransitioning(true);
    const timer = window.setTimeout(() => {
      setWsStatusTransitioning(false);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [wsStatus]);

  const fallbackTopic = useMemo(() => topics.find((item) => item.topicId === topicId) ?? null, [topicId, topics]);

  const runStatus = runDetail?.status ?? "idle";

  const buildRunParams = useCallback(
    (runId: string, modeValue?: string): URLSearchParams => {
      const params = new URLSearchParams(searchParams);
      params.set("runId", runId);
      if (modeValue) {
        params.set("mode", modeValue);
      }
      if (isClassicView) {
        params.set("tab", classicPrimaryTab);
      }
      return params;
    },
    [classicPrimaryTab, isClassicView, searchParams],
  );

  const runArtifacts = useMemo(() => {
    if (!selectedRunId) {
      return [];
    }
    const map = new Map<string, Artifact>();
    events
      .filter((event) => event.runId === selectedRunId && event.kind === "artifact_created" && Array.isArray(event.artifacts))
      .forEach((event) => event.artifacts?.forEach((artifact) => map.set(artifact.artifactId, artifact)));
    return Array.from(map.values());
  }, [events, selectedRunId]);

  const feedEvents = useMemo(() => {
    const source = selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events;
    return [...source].reverse();
  }, [events, selectedRunId]);

  const activeRunConfig = useMemo(() => {
    if (runDetail?.config && isRunConfig(runDetail.config)) {
      return runDetail.config;
    }
    return runConfigDraft;
  }, [runConfigDraft, runDetail?.config]);
  const pipelineAgents = useMemo(() => {
    if (!activeRunConfig) {
      return [...AGENT_IDS];
    }

    return AGENT_IDS.filter((agentId) => activeRunConfig.modules[agentId]?.enabled);
  }, [activeRunConfig]);

  const logSourceEvents = useMemo(() => {
    return selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events;
  }, [events, selectedRunId]);
  const workspaceSearchTerm = useMemo(() => normalizeSearchText(workspaceSearch), [workspaceSearch]);
  const workspaceFilteredEvents = useMemo(() => {
    if (!workspaceSearchTerm) {
      return logSourceEvents;
    }

    return logSourceEvents.filter((event) => {
      const haystack = [
        event.summary,
        event.kind,
        event.agentId,
        event.severity,
        typeof event.payload?.module === "string" ? event.payload.module : "",
        typeof event.payload?.status === "string" ? event.payload.status : "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(workspaceSearchTerm);
    });
  }, [logSourceEvents, workspaceSearchTerm]);
  const workspaceFilteredTraceItems = useMemo(() => {
    if (!workspaceSearchTerm) {
      return traceItems;
    }

    return traceItems.filter((item) => {
      const haystack = [item.summary, item.kind, item.agentId, JSON.stringify(item.payload ?? {})]
        .join(" ")
        .toLowerCase();
      return haystack.includes(workspaceSearchTerm);
    });
  }, [traceItems, workspaceSearchTerm]);
  const thinkingSteps = useMemo(() => {
    return pipelineAgents.map((agentId, index) => {
      const agent = agentsStatus[agentId];
      const subtasks = agentSubtasks[agentId] ?? [];
      const latestDetail = subtasks.find((item) => item.status === "running") ?? subtasks[subtasks.length - 1] ?? null;
      const progress = Math.max(agent?.progress ?? 0, latestDetail?.progress ?? 0);
      const status = (agent?.status ?? "idle").toLowerCase();
      const statusLabel =
        status === "completed" || status === "succeeded"
          ? "COMPLETED"
          : status === "running"
            ? "PROCESSING..."
            : status === "failed"
              ? "FAILED"
              : "QUEUED";

      return {
        id: agentId,
        index,
        title:
          agentId === "review"
            ? "Analyzing Architecture"
            : agentId === "ideation"
              ? "Evaluating Performance"
              : "Identifying Latency Risks",
        description:
          latestDetail?.name ||
          agent?.lastSummary ||
          (agentId === "review"
            ? "Deconstructing references and identifying the main technical signals."
            : agentId === "ideation"
              ? "Connecting evidence into candidate directions and benchmark hypotheses."
              : "Validating the highest-risk assumptions and drafting next actions."),
        active: status === "running",
        completed: status === "completed" || status === "succeeded",
        progress: Math.round(progress * 100),
        statusLabel,
      };
    });
  }, [agentSubtasks, agentsStatus, pipelineAgents]);
  const keyFindings = useMemo(() => {
    const candidates = [...logSourceEvents]
      .filter((event) => event.summary.trim().length > 0)
      .slice(-6)
      .reverse()
      .slice(0, 3);

    if (candidates.length === 0) {
      return [
        "Waiting for the first decisive signal from the current run.",
        "Key findings will appear here as soon as modules emit structured progress.",
        "Recent artifacts and milestone summaries will be pinned automatically.",
      ];
    }

    return candidates.map((event) => event.summary);
  }, [logSourceEvents]);

  const logModuleOptions = useMemo(() => {
    const modules = new Set(logSourceEvents.map(getEventModule));
    return Array.from(modules).sort();
  }, [logSourceEvents]);

  const logKindOptions = useMemo(() => {
    const kinds = new Set(logSourceEvents.map((event) => event.kind));
    return Array.from(kinds).sort();
  }, [logSourceEvents]);

  const filteredLogEvents = useMemo(() => {
    return [...logSourceEvents]
      .filter((event) => {
        if (logModuleFilter !== "all" && getEventModule(event) !== logModuleFilter) {
          return false;
        }
        if (logKindFilter !== "all" && event.kind !== logKindFilter) {
          return false;
        }
        if (logSeverityFilter !== "all" && event.severity !== logSeverityFilter) {
          return false;
        }
        return true;
      })
      .sort(compareEventsStable);
  }, [logKindFilter, logModuleFilter, logSeverityFilter, logSourceEvents]);

  const drawerArtifacts = useMemo(() => {
    const sourceEvents = selectedRunId
      ? events.filter((event) => event.runId === selectedRunId && event.kind === "artifact_created")
      : events.filter((event) => event.kind === "artifact_created");

    const map = new Map<string, { artifact: Artifact; ts: number }>();
    sourceEvents.forEach((event) => {
      event.artifacts?.forEach((artifact) => {
        map.set(artifact.artifactId, { artifact, ts: event.ts });
      });
    });

    const fromEvents = Array.from(map.values()).sort((left, right) => right.ts - left.ts);
    if (fromEvents.length > 0) {
      return fromEvents;
    }

    return artifacts.map((artifact) => ({ artifact, ts: 0 }));
  }, [artifacts, events, selectedRunId]);

  const configForContext = useMemo(() => {
    if (activeRunConfig && isRunConfig(activeRunConfig)) {
      return sanitizeRunConfig(activeRunConfig);
    }
    if (defaultRunConfig && isRunConfig(defaultRunConfig)) {
      return sanitizeRunConfig(defaultRunConfig);
    }
    return null;
  }, [activeRunConfig, defaultRunConfig]);

  useEffect(() => {
    if (runDetail?.config && isRunConfig(runDetail.config)) {
      setRunConfigDraft(cloneRunConfig(runDetail.config));
    }
  }, [runDetail?.config]);

  const applyIncomingEvent = useCallback((event: Event) => {
    const payload = event.payload ?? {};
    const statusFromPayload = typeof payload.status === "string" ? payload.status : undefined;
    const progressFromPayload =
      typeof payload.progress === "number" && Number.isFinite(payload.progress)
        ? Math.max(0, Math.min(1, payload.progress))
        : undefined;

    setAgentsStatus((current) => {
      const prev = current[event.agentId] ?? createEmptyStatus(event.agentId);
      return {
        ...current,
        [event.agentId]: {
          ...prev,
          status: event.kind === "agent_status_updated" ? statusFromPayload ?? prev.status : prev.status,
          progress: event.kind === "agent_status_updated" ? progressFromPayload ?? prev.progress : prev.progress,
          lastUpdate: event.ts,
          runId: event.runId,
          lastSummary: event.summary,
        },
      };
    });

    if (event.kind === "artifact_created" && Array.isArray(event.artifacts)) {
      setArtifacts((current) => mergeArtifacts(current, event.artifacts ?? []));
    }

    if (event.kind === "agent_subtasks_updated") {
      const subtasks = parseAgentSubtasksFromEvent(event);
      if (subtasks) {
        setAgentSubtasks((current) => ({ ...current, [event.agentId]: subtasks }));
      }
    }

    if (event.kind === "approval_required" && event.runId === selectedRunIdRef.current) {
      const approval = parseApprovalRequiredPayload(event);
      setApprovalSummary(approval?.summary ?? event.summary);
      setApprovalNote("");
    }

    if (event.kind === "approval_resolved" && event.runId === selectedRunIdRef.current) {
      setApprovalSummary(null);
      setApprovalNote("");
    }
  }, []);

  useEffect(() => {
    if (!topicId && queryTopicId) {
      const query = queryRunId ? `?runId=${encodeURIComponent(queryRunId)}` : "";
      navigate(`/app/${queryTopicId}${query}`, { replace: true });
    }
  }, [navigate, queryRunId, queryTopicId, topicId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRunConfig(true);

    getDefaultRunConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }
        setDefaultRunConfig(config);
        setRunConfigDraft((current) => current ?? cloneRunConfig(config));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRunConfig(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!topicId) {
      setTopic(null);
      setEvents([]);
      setArtifacts([]);
      setTraceItems([]);
      setAgentsStatus(createDefaultAgentRecord());
      setAgentSubtasks(createDefaultSubtasksRecord());
      setSelectedRunId(null);
      setRunDetail(null);
      setApprovalSummary(null);
      return;
    }

    let cancelled = false;
    wsRef.current?.close();
    wsRef.current = null;

    setLoadingSnapshot(true);
    setError("");
    setRunError("\u5f53\u524d\u540e\u7aef\u672a\u63d0\u4f9b\u505c\u6b62\u4efb\u52a1\u63a5\u53e3");
    setTraceError("");
    setWsStatus("connecting");

    const bootstrap = async () => {
      try {
        const snapshot = await getSnapshot(topicId, 400);
        if (cancelled) {
          return;
        }

        setTopic(snapshot.topic);
        setAgentsStatus((() => {
          const record = createDefaultAgentRecord();
          snapshot.agents?.forEach((agent) => {
            if (AGENT_IDS.includes(agent.agentId)) {
              record[agent.agentId] = { ...record[agent.agentId], ...agent };
            }
          });
          return record;
        })());

        const snapshotEvents = toSortedEvents(normalizeEvents((snapshot.events ?? []) as unknown[]));
        setEvents(snapshotEvents);

        const nextSubtasks = createDefaultSubtasksRecord();
        snapshotEvents.forEach((event) => {
          const subtasks = parseAgentSubtasksFromEvent(event);
          if (subtasks && AGENT_IDS.includes(event.agentId)) {
            nextSubtasks[event.agentId] = subtasks;
          }
        });
        setAgentSubtasks(nextSubtasks);
        setArtifacts(snapshot.artifacts ?? []);

        const snapshotActiveRun = snapshot.activeRun ?? null;
        const initialRunId =
          queryRunId ||
          snapshotActiveRun?.runId ||
          snapshot.topic.activeRunId ||
          snapshot.topic.lastRunId ||
          null;
        setSelectedRunId(initialRunId);
        if (snapshotActiveRun && initialRunId === snapshotActiveRun.runId) {
          setRunDetail(snapshotActiveRun);
          if (
            snapshotActiveRun.awaitingApproval &&
            snapshotActiveRun.awaitingModule &&
            AGENT_IDS.includes(snapshotActiveRun.awaitingModule as AgentId)
          ) {
            setApprovalSummary((current) => current ?? `${snapshotActiveRun.awaitingModule} is waiting for approval`);
          } else {
            setApprovalSummary(null);
          }
          setApprovalNote("");
        } else {
          setRunDetail(null);
          setApprovalSummary(null);
        }

        if (!queryRunId && initialRunId) {
          const nextParams = buildRunParams(initialRunId);
          setSearchParams(nextParams, { replace: true });
        }
      } catch (snapshotError) {
        if (!cancelled) {
          setError(getErrorMessage(snapshotError));
          setWsStatus("closed");
        }
        return;
      } finally {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      }

      wsRef.current = connectTopicWs({
        topicId,
        onStatusChange: (status) => {
          if (!cancelled) {
            setWsStatus(status);
          }
        },
        onError: (message) => {
          if (!cancelled) {
            setError(message);
          }
        },
        onEvent: (event) => {
          if (cancelled || event.topicId !== topicId) {
            return;
          }

          setEvents((current) => upsertSortedEvent(current, event));
          applyIncomingEvent(event);

          if (selectedRunIdRef.current && event.runId === selectedRunIdRef.current) {
            const incomingTraceItems = mapEventToTraceItems(event);
            if (incomingTraceItems.length > 0) {
              setTraceItems((current) => mergeTraceItems(current, incomingTraceItems));
            }
            if (["module_started", "module_finished", "module_skipped", "module_failed", "approval_required", "approval_resolved"].includes(event.kind)) {
              void getRun(event.runId).then(setRunDetail).catch(() => {
                // Keep page resilient on transient failures.
              });
            }
          }
        },
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      setWsStatus("closed");
    };
  }, [applyIncomingEvent, buildRunParams, queryRunId, setSearchParams, topicId]);

  useEffect(() => {
    if (!queryRunId || !topicId) {
      return;
    }
    setSelectedRunId(queryRunId);
  }, [queryRunId, topicId]);

  useEffect(() => {
    if (!isClassicView) {
      return;
    }

    if (queryTab === classicPrimaryTab) {
      return;
    }

    const params = new URLSearchParams(searchParams);
    params.set("tab", classicPrimaryTab);
    setSearchParams(params, { replace: true });
  }, [classicPrimaryTab, isClassicView, queryTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (!queryDraft) {
      return;
    }
    setPrompt((current) => (current.trim() ? current : queryDraft));
  }, [queryDraft]);

  useEffect(() => {
    if (!topicId || !selectedRunId) {
      setRunDetail(null);
      setTraceItems([]);
      setTraceError("");
      return;
    }

    let cancelled = false;
    setLoadingTrace(true);
    setTraceError("");

    void Promise.all([getTopicTrace(topicId, selectedRunId), getRun(selectedRunId)])
      .then(([trace, run]) => {
        if (cancelled) {
          return;
        }
        setTraceItems(trace.items ?? []);
        setRunDetail(run);
        if (run.awaitingApproval && run.awaitingModule) {
          setApprovalSummary((current) => current ?? APP_COPY.home.approvalWaiting(run.awaitingModule ?? APP_COPY.common.unknown));
        } else {
          setApprovalSummary(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          const message = getErrorMessage(loadError);
          setTraceError(message);
          setRunError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTrace(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRunId, topicId]);

  const handleStartRun = async (options?: { allowTopicFallbackPrompt?: boolean }) => {
    if (!topicId) {
      return;
    }

    let trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && options?.allowTopicFallbackPrompt) {
      trimmedPrompt =
        topic?.description?.trim() ||
        topic?.title?.trim() ||
        fallbackTopic?.title?.trim() ||
        "";
    }

    if (!trimmedPrompt) {
      setPromptError(APP_COPY.composer.promptRequired);
      return;
    }

    if (!runConfigDraft) {
      setPromptError(APP_COPY.runConfig.unavailable);
      return;
    }

    setSubmittingRun(true);
    setError("");
    setPromptError("");
    setRunError("\u5f53\u524d\u540e\u7aef\u672a\u63d0\u4f9b\u505c\u6b62\u4efb\u52a1\u63a5\u53e3");

    try {
      const config = sanitizeRunConfig(runConfigDraft);
      const run = await startRun(topicId, {
        prompt: trimmedPrompt,
        config,
      });

      setSubmittedPromptsByRunId((current) => ({
        ...current,
        [run.runId]: trimmedPrompt,
      }));
      setPrompt("");
      setRunConfigDraft(cloneRunConfig(config));
      setSelectedRunId(run.runId);
      setRunDetail(run);
      setTraceItems([]);
      setApprovalSummary(null);
      setApprovalNote("");

      const params = buildRunParams(run.runId, runConfigToMode(config));
      setSearchParams(params, { replace: true });
      await refreshTopics();
    } catch (runCreateError) {
      const message = getErrorMessage(runCreateError);
      setError(message);
      setPromptError(message);
    } finally {
      setSubmittingRun(false);
    }
  };

  const handleApproveRun = async (approved: boolean) => {
    if (!selectedRunId || !runDetail?.awaitingModule || !AGENT_IDS.includes(runDetail.awaitingModule as AgentId)) {
      return;
    }

    setApproving(true);
    setRunError("\u5f53\u524d\u540e\u7aef\u672a\u63d0\u4f9b\u505c\u6b62\u4efb\u52a1\u63a5\u53e3");

    try {
      await approveRun(selectedRunId, {
        module: runDetail.awaitingModule as AgentId,
        approved,
        note: approvalNote.trim() || undefined,
      });

      setRunDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          status: current.status === "paused" ? "running" : current.status,
          awaitingApproval: false,
          awaitingModule: null,
        };
      });
      setApprovalSummary(null);
      setApprovalNote("");
    } catch (approveError) {
      setRunError(getErrorMessage(approveError));
    } finally {
      setApproving(false);
    }
  };

  const openDrawer = (tab: DrawerTab) => {
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  const handleBackToHome = () => {
    navigate("/app-center");
  };

  const handleShareRun = async () => {
    const shareUrl = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: headerTitle,
          text: headerTitle,
          url: shareUrl,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setError("\u5f53\u524d\u94fe\u63a5\u5df2\u590d\u5236");
        return;
      }
    } catch (shareError) {
      setError(getErrorMessage(shareError));
      return;
    }

    setError("\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u5206\u4eab");
  };

  const handleStopUnavailable = () => {
    setRunError("\u5f53\u524d\u540e\u7aef\u672a\u63d0\u4f9b\u505c\u6b62\u4efb\u52a1\u63a5\u53e3");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const openClassicTraceView = () => {
    const params = new URLSearchParams(searchParams);
    params.set("view", "classic");
    params.set("tab", "trace");
    if (selectedRunId) {
      params.set("runId", selectedRunId);
    }
    setSearchParams(params);
  };

  const setClassicTab = (nextTab: ClassicPrimaryTab) => {
    const params = new URLSearchParams(searchParams);
    params.set("view", "classic");
    params.set("tab", nextTab);
    if (selectedRunId) {
      params.set("runId", selectedRunId);
    }
    setSearchParams(params);
  };

  const openArtifactPreview = async (artifact: Artifact) => {
    setArtifactModalOpen(true);
    setArtifactModalTitle(artifact.name);
    setArtifactModalType(artifact.contentType);
    setArtifactModalContent("");
    setArtifactModalError("");
    setArtifactModalLoading(true);

    try {
      const loaded = await fetchArtifactContent(artifact.uri);
      setArtifactModalType(loaded.contentType);
      setArtifactModalContent(loaded.content);
    } catch (previewError) {
      setArtifactModalError(getErrorMessage(previewError));
    } finally {
      setArtifactModalLoading(false);
    }
  };

  const handleArtifactDownload = async (artifact: Artifact) => {
    try {
      const loaded = await fetchArtifactContent(artifact.uri);
      const blob = new Blob([loaded.content], { type: loaded.contentType || artifact.contentType });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = artifact.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(getErrorMessage(downloadError));
    }
  };

  const closeArtifactPreview = () => {
    setArtifactModalOpen(false);
    setArtifactModalTitle("");
    setArtifactModalType("text/plain");
    setArtifactModalContent("");
    setArtifactModalError("");
    setArtifactModalLoading(false);
  };

  const handleSelectAgent = (agentId: AgentId) => {
    setSelectedAgentId(agentId);
    setAgentDrawerOpen(true);
  };

  const handleSendCommand = async (agentId: AgentId, text: string) => {
    if (!topicId) {
      return;
    }
    await sendAgentCommand(topicId, agentId, text);
  };

  if (!topicId) {
    return (
      <section className="topic-empty run-workbench-page">
        <h2>{APP_COPY.runs.noTopicSelectedTitle}</h2>
        <p>{APP_COPY.runs.noTopicSelectedDesc}</p>
      </section>
    );
  }

  const headerTitle = topic?.title ?? fallbackTopic?.title ?? topicId;
  const awaitingModule =
    runDetail?.awaitingModule && AGENT_IDS.includes(runDetail.awaitingModule as AgentId)
      ? (runDetail.awaitingModule as AgentId)
      : null;
  const topicPrompt = topic?.objective?.trim() || topic?.description?.trim() || prompt.trim();
  const streamTaskPrompt = (selectedRunId ? submittedPromptsByRunId[selectedRunId] : "") || topicPrompt;

  const drawerContent = (
    <>
      {activeTab === "log" ? (
        <section className="workflow-log-panel">
          <header className="workflow-log-header">
            <h4>{APP_COPY.runs.eventLog}</h4>
            <span className="muted">{filteredLogEvents.length} {APP_COPY.trace.itemsSuffix}</span>
          </header>
          <div className="workflow-log-filters">
            <label>
              {APP_COPY.runs.moduleField}
              <select value={logModuleFilter} onChange={(event) => setLogModuleFilter(event.target.value)}>
                <option value="all">{APP_COPY.runs.all}</option>
                {logModuleOptions.map((module) => (
                  <option key={module} value={module}>
                    {module}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {APP_COPY.runs.kindField}
              <select value={logKindFilter} onChange={(event) => setLogKindFilter(event.target.value)}>
                <option value="all">{APP_COPY.runs.all}</option>
                {logKindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {APP_COPY.runs.severityField}
              <select value={logSeverityFilter} onChange={(event) => setLogSeverityFilter(event.target.value)}>
                <option value="all">{APP_COPY.runs.all}</option>
                <option value="info">{formatSeverityLabel("info")}</option>
                <option value="warn">{formatSeverityLabel("warn")}</option>
                <option value="error">{formatSeverityLabel("error")}</option>
              </select>
            </label>
          </div>
          <div className="workflow-log-list">
            {filteredLogEvents.length === 0 ? <p className="muted">{APP_COPY.runs.noFilteredEvents}</p> : null}
            {filteredLogEvents.map((event) => (
              <article key={event.eventId} className={`workflow-log-item event-${event.severity}`}>
                <header>
                  <div className="workflow-feed-meta">
                    <span className="event-time">{formatEventTime(event.ts)}</span>
                    <span className="event-badge">{getEventModule(event)}</span>
                    <span className="event-badge event-badge-kind">{formatEventKindLabel(event.kind)}</span>
                  </div>
                  <span className={`event-badge event-badge-severity severity-${event.severity}`}>{formatSeverityLabel(event.severity)}</span>
                </header>
                <p>{event.summary}</p>
                {event.payload ? (
                  <details className="workflow-log-payload">
                    <summary>{APP_COPY.common.payload}</summary>
                    <pre>{formatJsonPretty(event.payload)}</pre>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "artifacts" ? (
        <section className="workflow-artifacts-panel">
          <header className="workflow-log-header">
            <h4>{APP_COPY.common.artifacts}</h4>
            <span className="muted">{drawerArtifacts.length} {APP_COPY.runs.filesSuffix}</span>
          </header>
          <div className="workflow-artifacts-list">
            {drawerArtifacts.length === 0 ? <p className="muted">{APP_COPY.runPanel.noArtifacts}</p> : null}
            {drawerArtifacts.map(({ artifact, ts }) => (
              <article key={artifact.artifactId} className="workflow-drawer-artifact-item">
                <header>
                  <div>
                    <strong>{artifact.name}</strong>
                    <p className="muted">{artifact.contentType}</p>
                  </div>
                  {ts > 0 ? <span className="muted">{formatEventTime(ts)}</span> : null}
                </header>
                <div className="workflow-drawer-artifact-actions">
                  <button type="button" onClick={() => void openArtifactPreview(artifact)}>{APP_COPY.common.preview}</button>
                  <button type="button" onClick={() => void handleArtifactDownload(artifact)}>{APP_COPY.common.download}</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "context" ? (
        <section className="workflow-context-panel">
          <article className="workflow-context-card">
            <h4>{APP_COPY.runs.topicPromptTitle}</h4>
            <p>{topicPrompt || APP_COPY.runs.noPromptRecorded}</p>
          </article>

          <article className="workflow-context-card">
            <h4>{APP_COPY.runs.runStatusTitle}</h4>
            <div className="workflow-context-grid">
              <div>
                <span className="muted">{APP_COPY.runs.statusPrefix}</span>
                <strong>{formatRunStatusLabel(runDetail?.status ?? "idle")}</strong>
              </div>
              <div>
                <span className="muted">{APP_COPY.runs.currentModuleField}</span>
                <strong>{runDetail?.currentModule ?? APP_COPY.common.none}</strong>
              </div>
              <div>
                <span className="muted">{APP_COPY.runs.awaitingApprovalField}</span>
                <strong>{formatBooleanLabel(Boolean(runDetail?.awaitingApproval))}</strong>
              </div>
              <div>
                <span className="muted">{APP_COPY.runs.awaitingModuleField}</span>
                <strong>{runDetail?.awaitingModule ?? APP_COPY.common.none}</strong>
              </div>
            </div>
          </article>

          <article className="workflow-context-card">
            <h4>{APP_COPY.runs.runConfigSummary}</h4>
            {configForContext ? (
              <>
                <div className="workflow-context-grid">
                  <div>
                    <span className="muted">{APP_COPY.workflowSettings.thinkingMode}</span>
                    <strong>{configForContext.thinkingMode}</strong>
                  </div>
                  <div>
                    <span className="muted">{APP_COPY.runs.selectedAgents}</span>
                    <strong>{(configForContext.selectedAgents ?? []).join(", ") || APP_COPY.common.none}</strong>
                  </div>
                  <div>
                    <span className="muted">{APP_COPY.runs.network}</span>
                    <strong>{formatOnlineLabel(configForContext.online)}</strong>
                  </div>
                  <div>
                    <span className="muted">{APP_COPY.workflowSettings.preset}</span>
                    <strong>{configForContext.presetName}</strong>
                  </div>
                </div>
                <div className="workflow-context-modules">
                  {AGENT_IDS.map((agentId) => {
                    const moduleConfig = configForContext.modules[agentId];
                    return (
                      <div key={agentId} className="workflow-context-module-item">
                        <h5>{formatAgentLabel(agentId)}</h5>
                        <p>{APP_COPY.workflowSettings.enabled}: {formatBooleanLabel(moduleConfig.enabled)}</p>
                        <p>{APP_COPY.workflowSettings.model}: {moduleConfig.model}</p>
                        <p>{APP_COPY.workflowSettings.requireHuman}: {formatBooleanLabel(moduleConfig.requireHuman)}</p>
                        {moduleConfig.idea_taste_mode ? <p>idea_taste_mode: {moduleConfig.idea_taste_mode}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted">{APP_COPY.runs.usingDefaultConfig}</p>
            )}
          </article>
        </section>
      ) : null}

    </>
  );

  if (isClassicView) {
    const classicEvents = selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events;

    return (
      <section className="topic-page run-workbench-page">
        <header className="console-topbar">
          <div className="console-topbar-main">
            <div className="console-topbar-brand">
              <span className="console-topbar-title">Research Workspace</span>
            </div>
            <nav className="console-topbar-nav" aria-label="Workspace view">
              <button
                type="button"
                className={classicPrimaryTab === "pipeline" ? "active" : ""}
                onClick={() => setClassicTab("pipeline")}
              >
                Pipeline
              </button>
              <button
                type="button"
                className={classicPrimaryTab === "chat" ? "active" : ""}
                onClick={() => setClassicTab("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={classicPrimaryTab === "trace" ? "active" : ""}
                onClick={() => setClassicTab("trace")}
              >
                Trace
              </button>
            </nav>
          </div>
          <div className="console-topbar-actions">
            <button type="button" className="console-topbar-back" onClick={handleBackToHome}>
              <span className="material-symbols-outlined">arrow_back</span>
              返回首页
            </button>
            <label className="console-topbar-search" aria-label="Search parameters">
              <span className="material-symbols-outlined">search</span>
              <input
                type="text"
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                placeholder="搜索当前运行内容..."
              />
            </label>
          </div>
        </header>

        <div className="px-10 pt-10 pb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-container text-on-tertiary-container text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
                  RUNNING
                </span>
                <span className="text-sm text-on-surface-variant">
                  Task ID: {selectedRunId ?? "RA-9921-X"}
                </span>
              </div>
              <h2 className="text-4xl font-bold tracking-tight text-on-surface mb-2">{headerTitle}</h2>
              <p className="text-body-lg text-on-surface-variant leading-relaxed">
                {topic?.description || topic?.objective || "Systematic analysis of architecture parameters, latency benchmarks, and MoE optimization techniques for large-scale deployment."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="px-6 py-2.5 rounded-full border border-outline-variant/30 font-semibold text-on-surface hover:bg-surface-container transition-all flex items-center gap-2 bg-white/70" onClick={() => void handleShareRun()}>
                <span className="material-symbols-outlined text-lg">share</span>
                Share
              </button>
              <button type="button" className="px-6 py-2.5 rounded-full border border-outline-variant/30 font-semibold text-on-surface hover:bg-surface-container transition-all flex items-center gap-2 bg-white/70" onClick={() => openDrawer("log")}>
                <span className="material-symbols-outlined text-lg">terminal</span>
                View Logs
              </button>
              <button type="button" className="px-6 py-2.5 rounded-full bg-error text-white font-bold hover:bg-[#9f0519] transition-all shadow-lg shadow-error/10 flex items-center gap-2 border-0" onClick={handleStopUnavailable}>
                <span className="material-symbols-outlined text-lg">stop_circle</span>
                Stop Task
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {promptError ? <div className="error-banner">{promptError}</div> : null}

        <div className="topic-view-tabs topic-view-tabs-secondary">
          <div className="topic-view-tabs-left">
            <button
              type="button"
              className={classicPrimaryTab === "chat" ? "active" : ""}
              onClick={() => setClassicTab("chat")}
            >
              {APP_COPY.runs.chatTab}
            </button>
            <button
              type="button"
              className={classicPrimaryTab === "pipeline" ? "active" : ""}
              onClick={() => setClassicTab("pipeline")}
            >
              {APP_COPY.runs.pipelineTab}
            </button>
            <button
              type="button"
              className={classicPrimaryTab === "trace" ? "active" : ""}
              onClick={() => setClassicTab("trace")}
            >
              {APP_COPY.runs.traceTab}
            </button>
          </div>
          <div className="topic-view-tabs-right">
            {selectedRunId ? <span className="trace-run-id">{APP_COPY.runs.runPrefix}: {selectedRunId}</span> : null}
          </div>
        </div>

        {(approvalSummary || (runDetail?.awaitingApproval && awaitingModule)) ? (
          <section className="workflow-approval-card">
            <h3>{APP_COPY.runs.approvalRequired}</h3>
            <p>{approvalSummary ?? APP_COPY.runs.approvalWaitingDesc}</p>
            {awaitingModule ? <p className="muted">{APP_COPY.runs.moduleField}: {awaitingModule}</p> : null}
            <textarea
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              placeholder={APP_COPY.common.optionalNote}
              rows={2}
              disabled={approving}
            />
            <div className="workflow-approval-actions">
              <button type="button" disabled={approving} onClick={() => void handleApproveRun(true)}>
                {approving ? APP_COPY.common.submitting : APP_COPY.common.approve}
              </button>
              <button type="button" className="danger-button" disabled={approving} onClick={() => void handleApproveRun(false)}>
                {approving ? APP_COPY.common.submitting : APP_COPY.common.reject}
              </button>
            </div>
            {runError ? <p className="form-error">{runError}</p> : null}
          </section>
        ) : null}

        {classicPrimaryTab === "pipeline" ? (
          <div className="run-workbench-functional-grid">
            <section className="run-workbench-functional-panel topic-flow-panel">
              <header className="panel-header">
                <div className="panel-header-main">
                  <h3>{APP_COPY.runs.pipelineTab}</h3>
                  <span className="panel-header-subtitle">查看当前 agent 流程与子任务状态</span>
                </div>
                <div className="workflow-feed-actions">
                  <button type="button" onClick={() => openDrawer("context")}>{APP_COPY.common.context}</button>
                  <button type="button" onClick={() => openDrawer("log")}>{APP_COPY.common.openDrawer}</button>
                </div>
              </header>
              <FlowCanvas
                agentsStatus={agentsStatus}
                agentSubtasks={agentSubtasks}
                enabledAgents={pipelineAgents}
                onSelectAgent={handleSelectAgent}
              />
            </section>

            <aside className="run-workbench-functional-panel run-workbench-event-panel">
              <EventFeed events={workspaceFilteredEvents.slice(-48)} />
            </aside>
          </div>
        ) : classicPrimaryTab === "chat" ? (
          <section className="workflow-feed workflow-feed-chat">
            <header className="workflow-feed-header">
              <div>
                <h3>{APP_COPY.runs.runChatTitle}</h3>
                <p>{APP_COPY.runs.runChatDesc}</p>
              </div>
              <div className="workflow-feed-actions">
                <button type="button" onClick={() => openDrawer("artifacts")}>{APP_COPY.common.artifacts}</button>
                <button type="button" onClick={() => openDrawer("context")}>{APP_COPY.common.context}</button>
              </div>
            </header>

            <div className="workflow-feed-list">
              <RunMessageStream
                taskPrompt={streamTaskPrompt}
                events={workspaceFilteredEvents}
                awaitingModule={awaitingModule}
                approvalSummary={approvalSummary}
                approvalNote={approvalNote}
                approving={approving}
                runError={runError}
                runStatus={runStatus}
                onApprovalNoteChange={setApprovalNote}
                onApprove={(approved) => void handleApproveRun(approved)}
                onOpenArtifact={(artifact) => void openArtifactPreview(artifact)}
              />
            </div>
          </section>
        ) : (
          <section className="topic-trace-panel">
            <WorkflowTracePanel
              traceView={traceView}
              onTraceViewChange={setTraceView}
              traceItems={workspaceFilteredTraceItems}
              artifacts={runArtifacts}
              loading={loadingTrace}
              error={traceError}
              runStatus={runStatus}
            />
          </section>
        )}

        <section className="workspace-followup run-workbench-followup">
          <form
            className="workspace-followup-bar"
            onSubmit={(event) => {
              event.preventDefault();
              void handleStartRun({ allowTopicFallbackPrompt: true });
            }}
          >
            <button type="button" className="workspace-followup-icon" aria-label="Attach file">+</button>
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask follow-up questions or redirect the research..."
            />
            <div className="workspace-followup-actions">
              <button type="button" className="workspace-followup-icon" aria-label="Microphone">o</button>
              <button
                type="submit"
                className="workspace-followup-submit"
                disabled={submittingRun || loadingSnapshot || loadingRunConfig}
              >
                {">"}
              </button>
            </div>
          </form>
        </section>

        <WorkflowDrawer
          open={drawerOpen}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onClose={closeDrawer}
        >
          {drawerContent}
        </WorkflowDrawer>

        <AgentDrawer
          open={agentDrawerOpen}
          topicId={topicId}
          agentId={selectedAgentId}
          events={events}
          artifacts={artifacts}
          topic={topic}
          onClose={() => setAgentDrawerOpen(false)}
          onSendCommand={handleSendCommand}
        />

        {artifactModalOpen ? (
          <div className="artifact-modal-overlay" role="dialog" aria-label={APP_COPY.runs.artifactPreviewAria}>
            <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
              <header className="artifact-modal-header">
                <div>
                  <h4>{artifactModalTitle || APP_COPY.runs.artifactFallbackTitle}</h4>
                  <p className="muted">{artifactModalType}</p>
                </div>
                <button type="button" onClick={closeArtifactPreview}>{APP_COPY.common.close}</button>
              </header>
              <div className="artifact-modal-body">
                {artifactModalLoading ? <p>{APP_COPY.common.loadingArtifact}</p> : null}
                {!artifactModalLoading && artifactModalError ? <p className="form-error">{artifactModalError}</p> : null}
                {!artifactModalLoading && !artifactModalError ? (
                  <ArtifactContentView contentType={artifactModalType} content={artifactModalContent} artifactName={artifactModalTitle} />
                ) : null}
              </div>
            </div>
            <button type="button" className="artifact-modal-backdrop" onClick={closeArtifactPreview} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="workflow-page run-workbench-page">
      <header className="workflow-header">
        <div className="workflow-header-main">
          <span className="workflow-header-label">{APP_COPY.runs.topbarLabel}</span>
          <h2>{headerTitle}</h2>
          <div className="workflow-status-row">
            <span>{APP_COPY.runs.statusPrefix}: {formatTopicStatusLabel(topic?.status ?? fallbackTopic?.status ?? "unknown")}</span>
            <span className={`ws-state ws-${wsStatus}`}>{APP_COPY.runs.wsPrefix}: {wsStatusLabel}</span>
            {selectedRunId ? <span>{APP_COPY.runs.runPrefix}: {selectedRunId}</span> : null}
          </div>
        </div>
        <div className="workflow-header-actions">
          <button type="button" className="back-home-button" onClick={handleBackToHome}>{APP_COPY.common.backHome}</button>
          <button type="button" onClick={openClassicTraceView}>{APP_COPY.runs.traceViewButton}</button>
          <button type="button" onClick={() => openDrawer("log")}>{APP_COPY.common.openDrawer}</button>
          <ThemeToggle />
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="workflow-main">
        <div className="workflow-center">
          <Composer
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void handleStartRun()}
            submitting={submittingRun}
            disabled={loadingSnapshot || loadingRunConfig}
            error={promptError}
          />

          <section className="workflow-run-strip">
            <span className={`status-badge ${toRunStatusClass(runStatus)}`}>{formatRunStatusLabel(runStatus)}</span>
            <span>{APP_COPY.runs.currentPrefix}: {runDetail?.currentModule ?? APP_COPY.common.none}</span>
            <span>{APP_COPY.runs.eventCountPrefix}: {feedEvents.length}</span>
            <span>{APP_COPY.runs.artifactCountPrefix}: {runArtifacts.length}</span>
          </section>

          <section className="workflow-feed">
            <header className="workflow-feed-header">
              <div>
                <h3>{APP_COPY.runs.runFeedTitle}</h3>
                <p>{APP_COPY.runs.runFeedDesc}</p>
              </div>
              <div className="workflow-feed-actions">
                <button type="button" onClick={() => openDrawer("artifacts")}>{APP_COPY.common.artifacts}</button>
                <button type="button" onClick={() => openDrawer("context")}>{APP_COPY.common.context}</button>
              </div>
            </header>

            <div className="workflow-feed-list">
              <RunMessageStream
                taskPrompt={streamTaskPrompt}
                events={workspaceFilteredEvents}
                awaitingModule={awaitingModule}
                approvalSummary={approvalSummary}
                approvalNote={approvalNote}
                approving={approving}
                runError={runError}
                runStatus={runStatus}
                onApprovalNoteChange={setApprovalNote}
                onApprove={(approved) => void handleApproveRun(approved)}
                onOpenArtifact={(artifact) => void openArtifactPreview(artifact)}
              />
            </div>
          </section>
        </div>
      </div>

      <WorkflowDrawer
        open={drawerOpen}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onClose={closeDrawer}
      >
        {drawerContent}
      </WorkflowDrawer>

      <AgentDrawer
        open={agentDrawerOpen}
        topicId={topicId}
        agentId={selectedAgentId}
        events={events}
        artifacts={artifacts}
        topic={topic}
        onClose={() => setAgentDrawerOpen(false)}
        onSendCommand={handleSendCommand}
      />

      {artifactModalOpen ? (
        <div className="artifact-modal-overlay" role="dialog" aria-label={APP_COPY.runs.artifactPreviewAria}>
          <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
            <header className="artifact-modal-header">
              <div>
                <h4>{artifactModalTitle || "Artifact"}</h4>
                <p className="muted">{artifactModalType}</p>
              </div>
              <button type="button" onClick={closeArtifactPreview}>{APP_COPY.common.close}</button>
            </header>
            <div className="artifact-modal-body">
              {artifactModalLoading ? <p>{APP_COPY.common.loadingArtifact}</p> : null}
              {!artifactModalLoading && artifactModalError ? <p className="form-error">{artifactModalError}</p> : null}
              {!artifactModalLoading && !artifactModalError ? (
                <ArtifactContentView contentType={artifactModalType} content={artifactModalContent} artifactName={artifactModalTitle} />
              ) : null}
            </div>
          </div>
          <button type="button" className="artifact-modal-backdrop" onClick={closeArtifactPreview} />
        </div>
      ) : null}
    </section>
  );
};

