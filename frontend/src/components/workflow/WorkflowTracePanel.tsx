import { TraceFlowCanvas } from "../trace/TraceFlowCanvas";
import { TraceTimeline } from "../trace/TraceTimeline";
import { APP_COPY, formatResultStatusLabel, type ResultStatus } from "../../lib/copy";
import type { Artifact, TraceItem } from "../../types/events";

export type TraceView = "timeline" | "graph";

interface WorkflowTracePanelProps {
  traceView: TraceView;
  onTraceViewChange: (view: TraceView) => void;
  traceItems: TraceItem[];
  artifacts: Artifact[];
  loading: boolean;
  error: string;
  runStatus: string;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled", "completed", "stopped"]);

const toResultStatusClass = (status: ResultStatus): string => {
  if (status === "running") {
    return "status-running";
  }
  if (status === "done") {
    return "status-succeeded";
  }
  return "status-idle";
};

const getReportStatus = (runStatus: string, hasReportSignals: boolean): ResultStatus => {
  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    return "running";
  }
  if (TERMINAL_RUN_STATUSES.has(runStatus) || hasReportSignals) {
    return "done";
  }
  return "coming soon";
};

const getGraphStatus = (runStatus: string, hasGraphSignals: boolean): ResultStatus => {
  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    return "running";
  }
  if (TERMINAL_RUN_STATUSES.has(runStatus) || hasGraphSignals) {
    return "done";
  }
  return "coming soon";
};

export const WorkflowTracePanel = ({
  traceView,
  onTraceViewChange,
  traceItems,
  artifacts,
  loading,
  error,
  runStatus,
}: WorkflowTracePanelProps) => {
  const reportStatus = getReportStatus(runStatus, artifacts.length > 0 || traceItems.length > 0);
  const graphStatus = getGraphStatus(runStatus, traceItems.length > 0);

  return (
    <div className="workflow-trace-tab">
      <div className="workflow-trace-switch">
        <button
          type="button"
          className={traceView === "timeline" ? "active" : ""}
          onClick={() => onTraceViewChange("timeline")}
        >
          {APP_COPY.trace.timeline}
        </button>
        <button
          type="button"
          className={traceView === "graph" ? "active" : ""}
          onClick={() => onTraceViewChange("graph")}
        >
          {APP_COPY.trace.graph}
        </button>
      </div>

      <div className="workflow-trace-body">
        <div className="workflow-trace-layout">
          <div className="workflow-trace-main">
            {traceView === "timeline" ? (
              <TraceTimeline items={traceItems} artifacts={artifacts} loading={loading} error={error} />
            ) : null}

            {traceView === "graph" ? (
              <TraceFlowCanvas items={traceItems} artifacts={artifacts} loading={loading} error={error} />
            ) : null}
          </div>

          <aside className="workflow-result-panel">
            <header className="workflow-result-panel-header">
              <div>
                <h4>{APP_COPY.trace.result}</h4>
                <p>{APP_COPY.trace.resultSubtitle}</p>
              </div>
            </header>

            <article className="workflow-result-card">
              <header>
                <div>
                  <h5>{APP_COPY.trace.report}</h5>
                  <p>{APP_COPY.trace.reportSubtitle}</p>
                </div>
                <span className={`status-badge ${toResultStatusClass(reportStatus)}`}>{formatResultStatusLabel(reportStatus)}</span>
              </header>
              <p className="workflow-result-placeholder">
                {reportStatus === "running"
                  ? APP_COPY.trace.reportRunning
                  : reportStatus === "done"
                    ? APP_COPY.trace.reportDone
                    : APP_COPY.trace.reportComingSoon}
              </p>
            </article>

            <article className="workflow-result-card">
              <header>
                <div>
                  <h5>{APP_COPY.trace.graphCardTitle}</h5>
                  <p>{APP_COPY.trace.graphCardSubtitle}</p>
                </div>
                <span className={`status-badge ${toResultStatusClass(graphStatus)}`}>{formatResultStatusLabel(graphStatus)}</span>
              </header>
              <p className="workflow-result-placeholder">
                {graphStatus === "running"
                  ? APP_COPY.trace.graphRunning
                  : graphStatus === "done"
                    ? APP_COPY.trace.graphDone
                    : APP_COPY.trace.graphComingSoon}
              </p>
            </article>
          </aside>
        </div>
      </div>
    </div>
  );
};
