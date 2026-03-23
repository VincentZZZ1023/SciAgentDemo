import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, getAdminOverview, getAuthMe, getSnapshot, getTopics } from "../api/client";
import { connectAdminWs, type TopicWsConnection, type WsStatus } from "../api/ws";
import { ActiveRunsTable } from "../components/admin/ActiveRunsTable";
import { AdminCharts } from "../components/admin/AdminCharts";
import { ApprovalsList } from "../components/admin/ApprovalsList";
import { KpiCards } from "../components/admin/KpiCards";
import { ModuleSpinner } from "../components/admin/ModuleSpinner";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ActiveRunRow } from "../components/admin/types";
import { parseAdminMetricsFromEvent, type AdminMetricsPayload, type TopicSummary } from "../types/events";

const EMPTY_METRICS: AdminMetricsPayload = {
  ts: 0,
  activeRuns: 0,
  runsLast5m: 0,
  eventsLast5m: 0,
  moduleInFlight: {
    review: 0,
    ideation: 0,
    experiment: 0,
    unknown: 0,
  },
  approvalsPending: 0,
  errorRateLast5m: 0,
  eventsSeries: [],
  errorSeries: [],
  pendingApprovals: [],
  recentErrors: [],
};

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const sortRuns = (rows: ActiveRunRow[]): ActiveRunRow[] => {
  return [...rows].sort((left, right) => {
    const priority = (value: string): number => {
      if (value === "running") {
        return 0;
      }
      if (value === "paused") {
        return 1;
      }
      if (value === "queued") {
        return 2;
      }
      return 3;
    };
    const priorityDiff = priority(left.status) - priority(right.status);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return right.updatedAt - left.updatedAt;
  });
};

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const wsRef = useRef<TopicWsConnection | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const lastRunsRefreshAtRef = useRef<number>(0);

  const [metrics, setMetrics] = useState<AdminMetricsPayload>(EMPTY_METRICS);
  const [activeRuns, setActiveRuns] = useState<ActiveRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState("");
  const [wsStatus, setWsStatus] = useState<WsStatus>("closed");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const refreshActiveRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const topics = await getTopics();
      const snapshots = await Promise.all(
        topics.map(async (topic: TopicSummary) => {
          try {
            return await getSnapshot(topic.topicId, 1);
          } catch {
            return null;
          }
        }),
      );

      const dedup = new Map<string, ActiveRunRow>();
      for (const snapshot of snapshots) {
        if (!snapshot || !snapshot.activeRun) {
          continue;
        }

        const run = snapshot.activeRun;
        if (!ACTIVE_RUN_STATUSES.has(run.status)) {
          continue;
        }

        dedup.set(run.runId, {
          topicId: snapshot.topic.topicId,
          topicTitle: snapshot.topic.title,
          runId: run.runId,
          status: run.status,
          currentModule: run.currentModule ?? "",
          awaitingApproval: Boolean(run.awaitingApproval),
          updatedAt: run.startedAt ?? run.createdAt,
        });
      }

      setActiveRuns(sortRuns(Array.from(dedup.values())));
      lastRunsRefreshAtRef.current = Date.now();
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const scheduleRunsRefresh = useCallback(
    (delayMs = 500) => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshActiveRuns();
      }, delayMs);
    },
    [refreshActiveRuns],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoading(true);
      setError("");

      try {
        const me = await getAuthMe();
        const admin = me.role === "admin";
        if (cancelled) {
          return;
        }
        setIsAdmin(admin);

        if (!admin) {
          setLoading(false);
          return;
        }

        const [overview] = await Promise.all([getAdminOverview(), refreshActiveRuns()]);
        if (cancelled) {
          return;
        }

        setMetrics(overview);
      } catch (loadError) {
        if (!cancelled) {
          if (loadError instanceof ApiError && loadError.status === 403) {
            setIsAdmin(false);
          } else {
            setError(getErrorMessage(loadError));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshActiveRuns]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    wsRef.current?.close();
    wsRef.current = connectAdminWs({
      onStatusChange: setWsStatus,
      onError: (message) => {
        setError(message);
      },
      onEvent: (event) => {
        const payload = parseAdminMetricsFromEvent(event);
        if (!payload) {
          return;
        }

        setMetrics(payload);

        const now = Date.now();
        const elapsed = now - lastRunsRefreshAtRef.current;
        if (elapsed >= 4000) {
          scheduleRunsRefresh(300);
        }
      },
    });

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      setWsStatus("closed");
    };
  }, [isAdmin, scheduleRunsRefresh]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshActiveRuns();
    }, 10_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isAdmin, refreshActiveRuns]);

  const mergedModuleInFlight = useMemo(() => {
    return {
      review: metrics.moduleInFlight.review ?? 0,
      ideation: metrics.moduleInFlight.ideation ?? 0,
      experiment: metrics.moduleInFlight.experiment ?? 0,
      unknown: metrics.moduleInFlight.unknown ?? 0,
    };
  }, [metrics.moduleInFlight]);

  const openUserViewByIds = (topicId: string, runId: string) => {
    const params = new URLSearchParams();
    params.set("topicId", topicId);
    params.set("runId", runId);
    params.set("view", "classic");
    navigate(`/app?${params.toString()}`);
  };

  const openUserView = (row: ActiveRunRow) => {
    openUserViewByIds(row.topicId, row.runId);
  };

  if (loading) {
    return <section className="admin-page"><p className="muted">Loading admin dashboard...</p></section>;
  }

  if (!isAdmin) {
    return (
      <section className="admin-page">
        <article className="admin-unauthorized-card">
          <h2>Admin access required</h2>
          <p>You are logged in as a non-admin user.</p>
          <button type="button" onClick={() => navigate("/app-center")}>
            Back to Home
          </button>
        </article>
      </section>
    );
  }

  return (
    <section className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-header-label">xcientist Admin</span>
          <h2>Real-Time Command Center</h2>
          <p>
            WS status: <span className={`ws-state ws-${wsStatus}`}>{wsStatus}</span>
          </p>
        </div>
        <div className="admin-header-actions">
          <button type="button" onClick={() => void refreshActiveRuns()} disabled={loadingRuns}>
            {loadingRuns ? "Refreshing..." : "Refresh Runs"}
          </button>
          <button type="button" onClick={() => navigate("/app-center")}>
            Back
          </button>
          <ThemeToggle />
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <KpiCards metrics={metrics} />
      <AdminCharts metrics={metrics} />

      <div className="admin-middle-grid">
        <ModuleSpinner moduleInFlight={mergedModuleInFlight} />
        <ApprovalsList
          approvalsPending={metrics.approvalsPending}
          errorRateLast5m={metrics.errorRateLast5m}
          eventsLast5m={metrics.eventsLast5m}
          pendingApprovals={metrics.pendingApprovals}
          recentErrors={metrics.recentErrors}
          onOpenRun={openUserViewByIds}
        />
      </div>

      <ActiveRunsTable rows={activeRuns} loading={loadingRuns} onOpenRun={openUserView} />
    </section>
  );
};
