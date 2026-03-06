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
}

export const WorkflowTracePanel = ({
  traceView,
  onTraceViewChange,
  traceItems,
  artifacts,
  loading,
  error,
}: WorkflowTracePanelProps) => {
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
        {traceView === "timeline" ? (
          <TraceTimeline items={traceItems} artifacts={artifacts} loading={loading} error={error} />
        ) : null}

        {traceView === "graph" ? (
          <TraceFlowCanvas items={traceItems} artifacts={artifacts} loading={loading} error={error} />
        ) : null}
      </div>
    </div>
  );
};
