
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
import { RunConfigBar } from "../components/run/RunConfigBar";
import { TraceFlowCanvas } from "../components/trace/TraceFlowCanvas";
import { TraceTimeline } from "../components/trace/TraceTimeline";
import { ThemeToggle } from "../components/ThemeToggle";
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

type DrawerTab = "settings" | "trace" | "debug";
type TraceView = "timeline" | "pipeline" | "graph";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const cloneRunConfig = (config: RunConfig): RunConfig => JSON.parse(JSON.stringify(config)) as RunConfig;

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

const formatEventTime = (ts: number): string => new Date(ts).toLocaleString();

const toRunStatusClass = (status: string): string => `status-${status || "idle"}`;

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
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("settings");
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

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const fallbackTopic = useMemo(() => topics.find((item) => item.topicId === topicId) ?? null, [topicId, topics]);

  const runStatus = runDetail?.status ?? "idle";

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
    return [...source].sort((a, b) => b.ts - a.ts);
  }, [events, selectedRunId]);

  const activeRunConfig = useMemo(() => {
    if (runDetail?.config && isRunConfig(runDetail.config)) {
      return runDetail.config;
    }
    return runConfigDraft;
  }, [runConfigDraft, runDetail?.config]);

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

        const snapshotEvents = normalizeEvents((snapshot.events ?? []) as unknown[]);
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

        const initialRunId = queryRunId || snapshot.topic.activeRunId || snapshot.topic.lastRunId || null;
        setSelectedRunId(initialRunId);
        if (!queryRunId && initialRunId) {
          const nextParams = new URLSearchParams();
          nextParams.set("runId", initialRunId);
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

          setEvents((current) => [...current, event].slice(-1500));
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
  }, [applyIncomingEvent, queryRunId, setSearchParams, topicId]);

  useEffect(() => {
    if (!queryRunId || !topicId) {
      return;
    }
    setSelectedRunId(queryRunId);
  }, [queryRunId, topicId]);

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

  const handleStartRun = async () => {
    if (!topicId) {
      return;
    }

    const trimmedPrompt = prompt.trim();
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
      const run = await startRun(topicId, {
        prompt: trimmedPrompt,
        config: runConfigDraft,
      });

      setPrompt("");
      setSelectedRunId(run.runId);
      setRunDetail(run);
      setTraceItems([]);
      setApprovalSummary(null);
      setApprovalNote("");

      const params = new URLSearchParams();
      params.set("runId", run.runId);
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
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  const resetRunConfig = () => {
    if (!defaultRunConfig) {
      return;
    }
    setRunConfigDraft(cloneRunConfig(defaultRunConfig));
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
          <button type="button" onClick={() => openDrawer("settings")}>Settings</button>
          <button type="button" onClick={() => openDrawer("trace")}>Trace</button>
          <button type="button" onClick={() => openDrawer("debug")}>Debug</button>
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

          {(approvalSummary || (runDetail?.awaitingApproval && awaitingModule)) ? (
            <article className="workflow-approval-card">
              <h3>Approval Required {awaitingModule ? `(${awaitingModule})` : ""}</h3>
              <p>{approvalSummary ?? "This module is waiting for manual approval."}</p>
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
            </article>
          ) : null}

          <section className="workflow-feed">
            <header className="workflow-feed-header">
              <div>
                <h3>Run Feed</h3>
                <p>Progress and results in one stream</p>
              </div>
              <div className="workflow-feed-actions">
                <button type="button" onClick={() => openDrawer("trace")}>Open Trace</button>
                <button type="button" onClick={() => openDrawer("debug")}>Open Debug</button>
              </div>
            </header>

            <div className="workflow-feed-list">
              {feedEvents.length === 0 ? <p className="muted">No events yet. Start a run to see progress.</p> : null}
              {feedEvents.map((event) => (
                <article key={event.eventId} className={`workflow-feed-card event-${event.severity}`}>
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

        <aside className={`workflow-drawer ${drawerOpen ? "open" : ""}`}>
          <header className="workflow-drawer-header">
            <div>
              <h3>Workflow Details</h3>
              <p className="muted">Settings, trace and debug</p>
            </div>
            <button type="button" onClick={() => setDrawerOpen(false)}>Close</button>
          </header>

          <div className="workflow-drawer-tabs">
            <button type="button" className={drawerTab === "settings" ? "active" : ""} onClick={() => setDrawerTab("settings")}>Settings</button>
            <button type="button" className={drawerTab === "trace" ? "active" : ""} onClick={() => setDrawerTab("trace")}>Trace</button>
            <button type="button" className={drawerTab === "debug" ? "active" : ""} onClick={() => setDrawerTab("debug")}>Debug</button>
          </div>

          <div className="workflow-drawer-body">
            {drawerTab === "settings" ? (
              <RunConfigBar config={activeRunConfig} loading={loadingRunConfig} onChange={setRunConfigDraft} onReset={resetRunConfig} />
            ) : null}

            {drawerTab === "trace" ? (
              <div className="workflow-trace-tab">
                <div className="workflow-trace-switch">
                  <button type="button" className={traceView === "timeline" ? "active" : ""} onClick={() => setTraceView("timeline")}>Timeline</button>
                  <button type="button" className={traceView === "pipeline" ? "active" : ""} onClick={() => setTraceView("pipeline")}>Pipeline</button>
                  <button type="button" className={traceView === "graph" ? "active" : ""} onClick={() => setTraceView("graph")}>Graph</button>
                </div>

                <div className="workflow-trace-body">
                  {traceView === "timeline" ? <TraceTimeline items={traceItems} artifacts={runArtifacts} loading={loadingTrace} error={traceError} /> : null}
                  {traceView === "pipeline" ? (
                    <div className="workflow-pipeline-wrap">
                      <FlowCanvas agentsStatus={agentsStatus} agentSubtasks={agentSubtasks} onSelectAgent={handleSelectAgent} />
                    </div>
                  ) : null}
                  {traceView === "graph" ? <TraceFlowCanvas items={traceItems} artifacts={runArtifacts} loading={loadingTrace} error={traceError} /> : null}
                </div>
              </div>
            ) : null}

            {drawerTab === "debug" ? (
              <EventFeed events={selectedRunId ? events.filter((event) => event.runId === selectedRunId) : events} />
            ) : null}
          </div>
        </aside>
      </div>

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
