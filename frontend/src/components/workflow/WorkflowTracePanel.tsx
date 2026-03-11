import { TraceFlowCanvas } from "../trace/TraceFlowCanvas";
import { TraceTimeline } from "../trace/TraceTimeline";
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

type ResultStatus = "running" | "done" | "coming soon";

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
          Timeline
        </button>
        <button
          type="button"
          className={traceView === "graph" ? "active" : ""}
          onClick={() => onTraceViewChange("graph")}
        >
          Graph
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
                <h4>Result</h4>
                <p>Lightweight placeholders for downstream outputs.</p>
              </div>
            </header>

            <article className="workflow-result-card">
              <header>
                <div>
                  <h5>Report</h5>
                  <p>Run summary and structured write-up.</p>
                </div>
                <span className={`status-badge ${toResultStatusClass(reportStatus)}`}>{reportStatus}</span>
              </header>
              <p className="workflow-result-placeholder">
                {reportStatus === "running"
                  ? "Collecting module outputs and assembling report content."
                  : reportStatus === "done"
                    ? "Report stage is ready to be surfaced here."
                    : "Report view is reserved for future expansion."}
              </p>
            </article>

            <article className="workflow-result-card">
              <header>
                <div>
                  <h5>Graph</h5>
                  <p>High-level relationship view placeholder.</p>
                </div>
                <span className={`status-badge ${toResultStatusClass(graphStatus)}`}>{graphStatus}</span>
              </header>
              <p className="workflow-result-placeholder">
                {graphStatus === "running"
                  ? "Graph insights are being prepared from current run signals."
                  : graphStatus === "done"
                    ? "Graph slot is ready for future visualization output."
                    : "Graph rendering is coming soon."}
              </p>
            </article>
          </aside>
        </div>
      </div>
    </div>
  );
};
