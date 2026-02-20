import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { getSnapshot, getTopicTrace, sendAgentCommand, startRun } from "../api/client";
import { connectTopicWs, type TopicWsConnection, type WsStatus } from "../api/ws";
import type { AppLayoutContext } from "../app/AppLayout";
import { AgentDrawer } from "../components/cli/AgentDrawer";
import { EventFeed } from "../components/feed/EventFeed";
import { FlowCanvas } from "../components/flow/FlowCanvas";
import { TraceTimeline } from "../components/trace/TraceTimeline";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  AGENT_IDS,
  mapEventToTraceItems,
  parseWsEvent,
  type AgentId,
  type AgentStatus,
  type Artifact,
  type Event,
  type TraceItem,
  type TopicDetail,
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

const createDefaultAgentRecord = (): Record<AgentId, AgentStatus> => {
  return {
    review: createEmptyStatus("review"),
    ideation: createEmptyStatus("ideation"),
    experiment: createEmptyStatus("experiment"),
  };
};

const buildAgentRecord = (items: AgentStatus[]): Record<AgentId, AgentStatus> => {
  const record = createDefaultAgentRecord();
  for (const item of items) {
    if (AGENT_IDS.includes(item.agentId)) {
      record[item.agentId] = {
        ...record[item.agentId],
        ...item,
      };
    }
  }
  return record;
};

const mergeArtifacts = (current: Artifact[], incoming: Artifact[]): Artifact[] => {
  const map = new Map<string, Artifact>();

  for (const artifact of current) {
    map.set(artifact.artifactId, artifact);
  }

  for (const artifact of incoming) {
    map.set(artifact.artifactId, artifact);
  }

  return Array.from(map.values());
};

const mergeTraceItems = (current: TraceItem[], incoming: TraceItem[]): TraceItem[] => {
  const map = new Map<string, TraceItem>();

  for (const item of current) {
    map.set(item.id, item);
  }

  for (const item of incoming) {
    map.set(item.id, item);
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
};

const normalizeEvents = (rawEvents: unknown[]): Event[] => {
  const parsedEvents: Event[] = [];
  for (const item of rawEvents) {
    const event = parseWsEvent(item);
    if (event) {
      parsedEvents.push(event);
    }
  }
  return parsedEvents;
};

export const TopicPage = () => {
  const { topicId } = useParams();
  const { topics, refreshTopics } = useOutletContext<AppLayoutContext>();

  const wsRef = useRef<TopicWsConnection | null>(null);
  const traceRunIdRef = useRef<string | null>(null);

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [agentsStatus, setAgentsStatus] = useState<Record<AgentId, AgentStatus>>(
    createDefaultAgentRecord(),
  );
  const [events, setEvents] = useState<Event[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [traceError, setTraceError] = useState("");

  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [wsStatus, setWsStatus] = useState<WsStatus>("closed");
  const [viewMode, setViewMode] = useState<"pipeline" | "trace">("pipeline");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);

  const fallbackTopic = useMemo(() => {
    return topics.find((item) => item.topicId === topicId) ?? null;
  }, [topicId, topics]);

  const applyIncomingEvent = useCallback((event: Event) => {
    const payload = event.payload ?? {};

    const statusFromPayload =
      typeof payload.status === "string" && payload.status.length > 0
        ? payload.status
        : undefined;

    const progressFromPayload =
      typeof payload.progress === "number" && Number.isFinite(payload.progress)
        ? Math.max(0, Math.min(1, payload.progress))
        : undefined;

    if (event.kind === "agent_status_updated") {
      setAgentsStatus((current) => {
        const prev = current[event.agentId] ?? createEmptyStatus(event.agentId);
        return {
          ...current,
          [event.agentId]: {
            ...prev,
            status: statusFromPayload ?? prev.status,
            progress: progressFromPayload ?? prev.progress,
            lastUpdate: event.ts,
            runId: event.runId,
            lastSummary: event.summary,
          },
        };
      });
    } else {
      setAgentsStatus((current) => {
        const prev = current[event.agentId] ?? createEmptyStatus(event.agentId);
        return {
          ...current,
          [event.agentId]: {
            ...prev,
            lastUpdate: event.ts,
            runId: event.runId,
            lastSummary: event.summary,
          },
        };
      });
    }

    if (event.kind === "artifact_created" && Array.isArray(event.artifacts)) {
      const incomingArtifacts = event.artifacts as Artifact[];
      setArtifacts((current) => mergeArtifacts(current, incomingArtifacts));
    }
  }, []);

  useEffect(() => {
    traceRunIdRef.current = traceRunId;
  }, [traceRunId]);

  useEffect(() => {
    if (!topicId) {
      setTopic(null);
      setEvents([]);
      setArtifacts([]);
      setTraceItems([]);
      setTraceRunId(null);
      setLoadingTrace(false);
      setTraceError("");
      setAgentsStatus(createDefaultAgentRecord());
      return;
    }

    let cancelled = false;

    wsRef.current?.close();
    wsRef.current = null;

    setLoadingSnapshot(true);
    setLoadingTrace(true);
    setError("");
    setTraceError("");
    setWsStatus("connecting");
    setViewMode("pipeline");
    setTopic(null);
    setEvents([]);
    setArtifacts([]);
    setTraceItems([]);
    setTraceRunId(null);
    setAgentsStatus(createDefaultAgentRecord());

    const bootstrap = async () => {
      try {
        const snapshot = await getSnapshot(topicId, 200);
        if (cancelled) {
          return;
        }

        setTopic(snapshot.topic);
        setAgentsStatus(buildAgentRecord(snapshot.agents ?? []));
        setEvents(normalizeEvents((snapshot.events ?? []) as unknown[]));
        setArtifacts(snapshot.artifacts ?? []);
      } catch (snapshotError) {
        if (!cancelled) {
          setError(getErrorMessage(snapshotError));
          setWsStatus("closed");
          setLoadingTrace(false);
        }
        return;
      } finally {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      }

      try {
        const trace = await getTopicTrace(topicId);
        if (!cancelled) {
          setTraceItems(trace.items ?? []);
          setTraceRunId(trace.runId ?? null);
          setTraceError("");
        }
      } catch (loadTraceError) {
        if (!cancelled) {
          setTraceError(getErrorMessage(loadTraceError));
        }
      } finally {
        if (!cancelled) {
          setLoadingTrace(false);
        }
      }

      if (cancelled) {
        return;
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

          setEvents((current) => [...current, event].slice(-500));
          applyIncomingEvent(event);

          const activeTraceRunId = traceRunIdRef.current;
          if (activeTraceRunId && event.runId !== activeTraceRunId) {
            return;
          }

          if (!activeTraceRunId) {
            traceRunIdRef.current = event.runId;
            setTraceRunId(event.runId);
          }

          const incomingTraceItems = mapEventToTraceItems(event);
          if (incomingTraceItems.length > 0) {
            setTraceItems((current) => mergeTraceItems(current, incomingTraceItems));
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
  }, [applyIncomingEvent, topicId]);

  const handleStartRun = async () => {
    if (!topicId) {
      return;
    }

    setRunning(true);
    setError("");

    try {
      const run = await startRun(topicId);
      setTraceRunId(run.runId);
      traceRunIdRef.current = run.runId;
      setTraceItems([]);
      setTraceError("");
      setLoadingTrace(true);

      try {
        const trace = await getTopicTrace(topicId, run.runId);
        setTraceItems(trace.items ?? []);
      } catch (loadTraceError) {
        setTraceError(getErrorMessage(loadTraceError));
      } finally {
        setLoadingTrace(false);
      }

      await refreshTopics();
    } catch (runError) {
      setError(getErrorMessage(runError));
    } finally {
      setRunning(false);
    }
  };

  const handleSelectAgent = (agentId: AgentId) => {
    setSelectedAgentId(agentId);
    setDrawerOpen(true);
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

  return (
    <section className="topic-page">
      <header className="topic-topbar">
        <div className="topic-topbar-meta">
          <h2>{topic?.title ?? fallbackTopic?.title ?? topicId}</h2>
          <p>
            Status: <strong>{topic?.status ?? fallbackTopic?.status ?? "unknown"}</strong>
            <span className={`ws-state ws-${wsStatus}`}>WS: {wsStatus}</span>
          </p>
        </div>

        <div className="topic-topbar-actions">
          <ThemeToggle />
          <button
            type="button"
            className="run-button"
            onClick={() => void handleStartRun()}
            disabled={running || loadingSnapshot}
          >
            {running ? "Running..." : "Run"}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="topic-view-tabs">
        <button
          type="button"
          className={viewMode === "pipeline" ? "active" : ""}
          onClick={() => setViewMode("pipeline")}
        >
          Pipeline
        </button>
        <button
          type="button"
          className={viewMode === "trace" ? "active" : ""}
          onClick={() => setViewMode("trace")}
        >
          Trace
        </button>
        {traceRunId ? <span className="trace-run-id">Run: {traceRunId}</span> : null}
      </div>

      {viewMode === "pipeline" ? (
        <div className="topic-body">
          <div className="topic-flow-panel">
            <FlowCanvas agentsStatus={agentsStatus} onSelectAgent={handleSelectAgent} />
          </div>
          <div className="topic-feed-panel">
            <EventFeed events={events} />
          </div>
        </div>
      ) : (
        <div className="topic-trace-panel">
          <TraceTimeline
            items={traceItems}
            artifacts={artifacts}
            loading={loadingTrace}
            error={traceError}
          />
        </div>
      )}

      <AgentDrawer
        open={drawerOpen}
        topicId={topicId}
        agentId={selectedAgentId}
        events={events}
        artifacts={artifacts}
        topic={topic}
        onClose={() => setDrawerOpen(false)}
        onSendCommand={handleSendCommand}
      />
    </section>
  );
};
