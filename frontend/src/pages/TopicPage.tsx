
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import {
  approveRun,
  fetchArtifactContent,
  getAccessToken,
  getBackendBaseUrl,
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
import { Composer } from "../components/run/Composer";
import { ThemeToggle } from "../components/ThemeToggle";
import { EventFeed } from "../components/feed/EventFeed";
import { FlowCanvas } from "../components/flow/FlowCanvas";
import { cloneRunConfig, runConfigToMode, sanitizeRunConfig } from "../lib/runConfig";
import { type DrawerTab } from "../components/workflow/DrawerTabHeader";
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
  return "Request failed";
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
const MODULE_EVENT_KINDS = new Set(["module_started", "module_finished", "module_skipped", "module_failed"]);

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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("log");
  const [logModuleFilter, setLogModuleFilter] = useState("all");
  const [logKindFilter, setLogKindFilter] = useState("all");
  const [logSeverityFilter, setLogSeverityFilter] = useState("all");
  const [copiedCommandKey, setCopiedCommandKey] = useState<string | null>(null);
  const copiedCommandTimerRef = useRef<number | null>(null);
  const [traceView, setTraceView] = useState<TraceView>("timeline");
  const [classicPrimaryTab, setClassicPrimaryTab] = useState<"pipeline" | "trace">("pipeline");

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
  const [approving, setApproving] = useState(false);
  const [approvalSummary, setApprovalSummary] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactModalTitle, setArtifactModalTitle] = useState("");
  const [artifactModalType, setArtifactModalType] = useState("text/plain");
  const [artifactModalContent, setArtifactModalContent] = useState("");
  const [artifactModalLoading, setArtifactModalLoading] = useState(false);
  const [artifactModalError, setArtifactModalError] = useState("");

  const queryTopicId = searchParams.get("topicId");
  const queryRunId = searchParams.get("runId");
  const queryDraft = searchParams.get("draft");
  const queryView = searchParams.get("view");
  const isClassicView = queryView === "classic";

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    return () => {
      if (copiedCommandTimerRef.current !== null) {
        window.clearTimeout(copiedCommandTimerRef.current);
      }
    };
  }, []);

  const fallbackTopic = useMemo(() => topics.find((item) => item.topicId === topicId) ?? null, [topicId, topics]);

  const runStatus = runDetail?.status ?? "idle";

  const buildRunParams = useCallback(
    (runId: string, modeValue?: string): URLSearchParams => {
      const params = new URLSearchParams(searchParams);
      params.set("runId", runId);
      if (modeValue) {
        params.set("mode", modeValue);
      }
      return params;
    },
    [searchParams],
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

  const logSourceEvents = useMemo(() => {
    return selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events;
  }, [events, selectedRunId]);

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

  const cliToken = useMemo(() => getAccessToken() ?? "$TOKEN", []);
  const cliBaseUrl = useMemo(() => getBackendBaseUrl(), []);
  const createRunPayloadJson = useMemo(() => {
    const payload: Record<string, unknown> = {
      prompt: prompt.trim() || "Describe the research task here",
    };
    if (configForContext) {
      payload.config = configForContext;
    }
    return JSON.stringify(payload, null, 2);
  }, [configForContext, prompt]);

  const cliCommands = useMemo(() => {
    const safeTopicId = topicId ?? "<topic_id>";
    const runId = selectedRunId ?? "<run_id>";
    const approveModule =
      runDetail?.awaitingModule && AGENT_IDS.includes(runDetail.awaitingModule as AgentId)
        ? (runDetail.awaitingModule as AgentId)
        : "experiment";
    const createRunCommand =
      `curl -X POST "${cliBaseUrl}/api/topics/${safeTopicId}/runs" \\\n` +
      `  -H "Authorization: Bearer ${cliToken}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '${createRunPayloadJson}'`;
    const approveRunCommand =
      `curl -X POST "${cliBaseUrl}/api/runs/${runId}/approve" \\\n` +
      `  -H "Authorization: Bearer ${cliToken}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"module":"${approveModule}","approved":true,"note":"approved from drawer"}'`;
    const snapshotCommand =
      `curl -X GET "${cliBaseUrl}/api/topics/${safeTopicId}/snapshot?limit=200" \\\n` +
      `  -H "Authorization: Bearer ${cliToken}"`;

    return [
      { key: "create-run", label: "Create run", command: createRunCommand },
      { key: "approve-run", label: "Approve run", command: approveRunCommand },
      { key: "get-snapshot", label: "Get snapshot", command: snapshotCommand },
    ];
  }, [cliBaseUrl, cliToken, createRunPayloadJson, runDetail?.awaitingModule, selectedRunId, topicId]);

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
    setRunError("");
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
    setClassicPrimaryTab("pipeline");
  }, [topicId]);

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
          setApprovalSummary((current) => current ?? `${run.awaitingModule} is waiting for approval`);
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
      setPromptError("Prompt is required");
      return;
    }

    if (!runConfigDraft) {
      setPromptError("Run config is not ready");
      return;
    }

    setSubmittingRun(true);
    setError("");
    setPromptError("");
    setRunError("");

    try {
      const config = sanitizeRunConfig(runConfigDraft);
      const run = await startRun(topicId, {
        prompt: trimmedPrompt,
        config,
      });

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
    setRunError("");

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

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const openClassicTraceView = () => {
    const params = new URLSearchParams(searchParams);
    params.set("view", "classic");
    if (selectedRunId) {
      params.set("runId", selectedRunId);
    }
    setSearchParams(params);
    setClassicPrimaryTab("trace");
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

  const copyCommand = async (key: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommandKey(key);
      if (copiedCommandTimerRef.current !== null) {
        window.clearTimeout(copiedCommandTimerRef.current);
      }
      copiedCommandTimerRef.current = window.setTimeout(() => {
        setCopiedCommandKey(null);
      }, 1200);
    } catch (copyError) {
      setError(getErrorMessage(copyError));
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
      <section className="topic-empty">
        <h2>No topic selected</h2>
        <p>Create one in the left sidebar, then open it.</p>
      </section>
    );
  }

  const headerTitle = topic?.title ?? fallbackTopic?.title ?? topicId;
  const awaitingModule =
    runDetail?.awaitingModule && AGENT_IDS.includes(runDetail.awaitingModule as AgentId)
      ? (runDetail.awaitingModule as AgentId)
      : null;
  const topicPrompt = topic?.objective?.trim() || topic?.description?.trim() || prompt.trim();

  const drawerContent = (
    <>
      {activeTab === "log" ? (
        <section className="workflow-log-panel">
          <header className="workflow-log-header">
            <h4>Event Log</h4>
            <span className="muted">{filteredLogEvents.length} events</span>
          </header>
          <div className="workflow-log-filters">
            <label>
              Module
              <select value={logModuleFilter} onChange={(event) => setLogModuleFilter(event.target.value)}>
                <option value="all">All</option>
                {logModuleOptions.map((module) => (
                  <option key={module} value={module}>
                    {module}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select value={logKindFilter} onChange={(event) => setLogKindFilter(event.target.value)}>
                <option value="all">All</option>
                {logKindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select value={logSeverityFilter} onChange={(event) => setLogSeverityFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </label>
          </div>
          <div className="workflow-log-list">
            {filteredLogEvents.length === 0 ? <p className="muted">No events match current filters.</p> : null}
            {filteredLogEvents.map((event) => (
              <article key={event.eventId} className={`workflow-log-item event-${event.severity}`}>
                <header>
                  <div className="workflow-feed-meta">
                    <span className="event-time">{formatEventTime(event.ts)}</span>
                    <span className="event-badge">{getEventModule(event)}</span>
                    <span className="event-badge event-badge-kind">{event.kind}</span>
                  </div>
                  <span className={`event-badge event-badge-severity severity-${event.severity}`}>{event.severity}</span>
                </header>
                <p>{event.summary}</p>
                {event.payload ? (
                  <details className="workflow-log-payload">
                    <summary>payload</summary>
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
            <h4>Artifacts</h4>
            <span className="muted">{drawerArtifacts.length} files</span>
          </header>
          <div className="workflow-artifacts-list">
            {drawerArtifacts.length === 0 ? <p className="muted">No artifacts available for this run.</p> : null}
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
                  <button type="button" onClick={() => void openArtifactPreview(artifact)}>Preview</button>
                  <button type="button" onClick={() => void handleArtifactDownload(artifact)}>Download</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "context" ? (
        <section className="workflow-context-panel">
          <article className="workflow-context-card">
            <h4>Topic Prompt</h4>
            <p>{topicPrompt || "No prompt recorded for this topic."}</p>
          </article>

          <article className="workflow-context-card">
            <h4>Run Status</h4>
            <div className="workflow-context-grid">
              <div>
                <span className="muted">status</span>
                <strong>{runDetail?.status ?? "idle"}</strong>
              </div>
              <div>
                <span className="muted">current module</span>
                <strong>{runDetail?.currentModule ?? "-"}</strong>
              </div>
              <div>
                <span className="muted">awaiting approval</span>
                <strong>{runDetail?.awaitingApproval ? "true" : "false"}</strong>
              </div>
              <div>
                <span className="muted">awaiting module</span>
                <strong>{runDetail?.awaitingModule ?? "-"}</strong>
              </div>
            </div>
          </article>

          <article className="workflow-context-card">
            <h4>Run Config Summary</h4>
            {configForContext ? (
              <>
                <div className="workflow-context-grid">
                  <div>
                    <span className="muted">thinking mode</span>
                    <strong>{configForContext.thinkingMode}</strong>
                  </div>
                  <div>
                    <span className="muted">network</span>
                    <strong>{configForContext.online ? "online" : "offline"}</strong>
                  </div>
                  <div>
                    <span className="muted">preset</span>
                    <strong>{configForContext.presetName}</strong>
                  </div>
                </div>
                <div className="workflow-context-modules">
                  {AGENT_IDS.map((agentId) => {
                    const moduleConfig = configForContext.modules[agentId];
                    return (
                      <div key={agentId} className="workflow-context-module-item">
                        <h5>{agentId}</h5>
                        <p>enabled: {moduleConfig.enabled ? "true" : "false"}</p>
                        <p>model: {moduleConfig.model}</p>
                        <p>requireHuman: {moduleConfig.requireHuman ? "true" : "false"}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted">Using default config.</p>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === "cli" ? (
        <section className="workflow-cli-panel">
          {cliCommands.map((item) => (
            <article key={item.key} className="workflow-cli-item">
              <header>
                <h4>{item.label}</h4>
                <button type="button" onClick={() => void copyCommand(item.key, item.command)}>
                  {copiedCommandKey === item.key ? "Copied" : "Copy"}
                </button>
              </header>
              <pre>{item.command}</pre>
            </article>
          ))}
          <p className="muted">If needed, replace token value with your own Bearer token.</p>
        </section>
      ) : null}
    </>
  );

  if (isClassicView) {
    const classicEvents = selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events;

    return (
      <section className="topic-page">
        <header className="topic-topbar">
          <div className="topic-topbar-meta">
            <span className="topic-topbar-label">Workflow Builder</span>
            <h2>{headerTitle}</h2>
            <div className="topic-topbar-statusline">
              <span>status: {topic?.status ?? fallbackTopic?.status ?? "unknown"}</span>
              <span className={`ws-state ws-${wsStatus}`}>WS: {wsStatus}</span>
              {selectedRunId ? <span>run: {selectedRunId}</span> : null}
              <span className={`status-badge ${toRunStatusClass(runStatus)}`}>{runStatus}</span>
            </div>
          </div>
          <div className="topic-topbar-actions">
            <button type="button" onClick={() => openDrawer("log")}>Open Drawer</button>
            <button type="button" className="run-button" onClick={() => void handleStartRun({ allowTopicFallbackPrompt: true })} disabled={submittingRun || loadingSnapshot || loadingRunConfig}>
              {submittingRun ? "Running..." : "Run"}
            </button>
            <ThemeToggle />
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {promptError ? <div className="error-banner">{promptError}</div> : null}

        <div className="topic-view-tabs">
          <div className="topic-view-tabs-left">
            <button
              type="button"
              className={classicPrimaryTab === "pipeline" ? "active" : ""}
              onClick={() => setClassicPrimaryTab("pipeline")}
            >
              Pipeline
            </button>
            <button
              type="button"
              className={classicPrimaryTab === "trace" ? "active" : ""}
              onClick={() => setClassicPrimaryTab("trace")}
            >
              Trace
            </button>
          </div>
          <div className="topic-view-tabs-right">
            {selectedRunId ? <span className="trace-run-id">Run: {selectedRunId}</span> : null}
          </div>
        </div>

        {(approvalSummary || (runDetail?.awaitingApproval && awaitingModule)) ? (
          <section className="workflow-approval-card">
            <h3>Approval Required</h3>
            <p>{approvalSummary ?? "This module is waiting for manual approval."}</p>
            {awaitingModule ? <p className="muted">module: {awaitingModule}</p> : null}
            <textarea
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              placeholder="Optional note"
              rows={2}
              disabled={approving}
            />
            <div className="workflow-approval-actions">
              <button type="button" disabled={approving} onClick={() => void handleApproveRun(true)}>
                {approving ? "Submitting..." : "Approve"}
              </button>
              <button type="button" className="danger-button" disabled={approving} onClick={() => void handleApproveRun(false)}>
                {approving ? "Submitting..." : "Reject"}
              </button>
            </div>
            {runError ? <p className="form-error">{runError}</p> : null}
          </section>
        ) : null}

        {classicPrimaryTab === "pipeline" ? (
          <div className="topic-workspace">
            <section className="topic-flow-panel">
              <FlowCanvas
                agentsStatus={agentsStatus}
                agentSubtasks={agentSubtasks}
                onSelectAgent={handleSelectAgent}
              />
            </section>
            <EventFeed events={classicEvents} />
          </div>
        ) : (
          <section className="topic-trace-panel">
            <WorkflowTracePanel
              traceView={traceView}
              onTraceViewChange={setTraceView}
              traceItems={traceItems}
              artifacts={runArtifacts}
              loading={loadingTrace}
              error={traceError}
            />
          </section>
        )}

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
          <div className="artifact-modal-overlay" role="dialog" aria-label="Artifact preview">
            <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
              <header className="artifact-modal-header">
                <div>
                  <h4>{artifactModalTitle || "Artifact"}</h4>
                  <p className="muted">{artifactModalType}</p>
                </div>
                <button type="button" onClick={closeArtifactPreview}>Close</button>
              </header>
              <div className="artifact-modal-body">
                {artifactModalLoading ? <p>Loading artifact...</p> : null}
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
    <section className="workflow-page">
      <header className="workflow-header">
        <div className="workflow-header-main">
          <span className="workflow-header-label">Workflow</span>
          <h2>{headerTitle}</h2>
          <div className="workflow-status-row">
            <span>status: {topic?.status ?? fallbackTopic?.status ?? "unknown"}</span>
            <span className={`ws-state ws-${wsStatus}`}>WS: {wsStatus}</span>
            {selectedRunId ? <span>run: {selectedRunId}</span> : null}
          </div>
        </div>
        <div className="workflow-header-actions">
          <button type="button" onClick={openClassicTraceView}>Trace View</button>
          <button type="button" onClick={() => openDrawer("log")}>Open Drawer</button>
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
            <span className={`status-badge ${toRunStatusClass(runStatus)}`}>{runStatus}</span>
            <span>current: {runDetail?.currentModule ?? "-"}</span>
            <span>events: {feedEvents.length}</span>
            <span>artifacts: {runArtifacts.length}</span>
          </section>

          <section className="workflow-feed">
            <header className="workflow-feed-header">
              <div>
                <h3>Run Feed</h3>
                <p>Progress and results in one stream</p>
              </div>
              <div className="workflow-feed-actions">
                <button type="button" onClick={() => openDrawer("artifacts")}>Artifacts</button>
                <button type="button" onClick={() => openDrawer("context")}>Context</button>
                <button type="button" onClick={() => openDrawer("cli")}>CLI</button>
              </div>
            </header>

            <div className="workflow-feed-list">
              {feedEvents.length === 0 ? <p className="muted">No events yet. Start a run to see progress.</p> : null}
              {(approvalSummary || (runDetail?.awaitingApproval && awaitingModule)) ? (
                <article className="workflow-feed-card workflow-feed-card-approval">
                  <header>
                    <div className="workflow-feed-meta">
                      <span className="event-badge">approval</span>
                      {awaitingModule ? <span className="event-badge">{awaitingModule}</span> : null}
                    </div>
                    <span className="event-badge event-badge-severity severity-warn">action_required</span>
                  </header>
                  <h3>Approval Required</h3>
                  <p className="workflow-feed-summary">{approvalSummary ?? "This module is waiting for manual approval."}</p>
                  <textarea
                    value={approvalNote}
                    onChange={(event) => setApprovalNote(event.target.value)}
                    placeholder="Optional note"
                    rows={2}
                    disabled={approving}
                  />
                  <div className="workflow-approval-actions">
                    <button type="button" disabled={approving} onClick={() => void handleApproveRun(true)}>
                      {approving ? "Submitting..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={approving}
                      onClick={() => void handleApproveRun(false)}
                    >
                      {approving ? "Submitting..." : "Reject"}
                    </button>
                  </div>
                  {runError ? <p className="form-error">{runError}</p> : null}
                </article>
              ) : null}

              {runArtifacts.length > 0 ? (
                <article className="workflow-feed-card workflow-feed-card-artifacts">
                  <header>
                    <div className="workflow-feed-meta">
                      <span className="event-badge">artifacts</span>
                    </div>
                    <span className="event-badge">{runArtifacts.length}</span>
                  </header>
                  <p className="workflow-feed-summary">Generated outputs for the current run.</p>
                  <div className="workflow-feed-artifacts">
                    {runArtifacts.map((artifact) => (
                      <button
                        key={artifact.artifactId}
                        type="button"
                        className="workflow-artifact-button"
                        onClick={() => void openArtifactPreview(artifact)}
                      >
                        {artifact.name}
                      </button>
                    ))}
                  </div>
                </article>
              ) : null}

              {feedEvents.map((event) => (
                <article
                  key={event.eventId}
                  className={`workflow-feed-card event-${event.severity} ${MODULE_EVENT_KINDS.has(event.kind) ? "workflow-feed-card-module" : ""}`}
                >
                  <header>
                    <div className="workflow-feed-meta">
                      <span className="event-time">{formatEventTime(event.ts)}</span>
                      <span className="event-badge">{event.agentId}</span>
                      <span className="event-badge event-badge-kind">{event.kind}</span>
                    </div>
                    <span className={`event-badge event-badge-severity severity-${event.severity}`}>{event.severity}</span>
                  </header>
                  <p className="workflow-feed-summary">{event.summary}</p>

                  {event.kind === "artifact_created" && Array.isArray(event.artifacts) && event.artifacts.length > 0 ? (
                    <div className="workflow-feed-artifacts">
                      {event.artifacts.map((artifact) => (
                        <button
                          key={artifact.artifactId}
                          type="button"
                          className="workflow-artifact-button"
                          onClick={() => void openArtifactPreview(artifact)}
                        >
                          {artifact.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
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
        <div className="artifact-modal-overlay" role="dialog" aria-label="Artifact preview">
          <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
            <header className="artifact-modal-header">
              <div>
                <h4>{artifactModalTitle || "Artifact"}</h4>
                <p className="muted">{artifactModalType}</p>
              </div>
              <button type="button" onClick={closeArtifactPreview}>Close</button>
            </header>
            <div className="artifact-modal-body">
              {artifactModalLoading ? <p>Loading artifact...</p> : null}
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
