import { useMemo, useState } from "react";
import type { AgentId, Artifact, TraceItem } from "../../types/events";

export type RunModuleState = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface RunModuleView {
  module: AgentId;
  status: RunModuleState;
  summary: string;
  artifactNames: string[];
  model?: string;
  requireHuman?: boolean;
}

interface RunPanelProps {
  runId: string | null;
  status: string;
  currentModule: string | null;
  awaitingApproval: boolean;
  awaitingModule: AgentId | null;
  approvalSummary: string | null;
  approving: boolean;
  modules: RunModuleView[];
  artifacts: Artifact[];
  traceItems: TraceItem[];
  error?: string;
  onApprove: (approved: boolean, note?: string) => Promise<void>;
  onOpenTrace: () => void;
}

const formatRunStatus = (status: string): string => {
  if (!status) {
    return "unknown";
  }
  return status;
};

const formatTime = (ts: number): string => new Date(ts).toLocaleString();

export const RunPanel = ({
  runId,
  status,
  currentModule,
  awaitingApproval,
  awaitingModule,
  approvalSummary,
  approving,
  modules,
  artifacts,
  traceItems,
  error,
  onApprove,
  onOpenTrace,
}: RunPanelProps) => {
  const [note, setNote] = useState("");

  const recentTrace = useMemo(() => {
    return [...traceItems].sort((a, b) => b.ts - a.ts).slice(0, 8);
  }, [traceItems]);

  const canApprove = awaitingApproval && Boolean(awaitingModule);

  return (
    <section className="run-panel">
      <div className="run-panel-header">
        <div>
          <h3>Run Panel</h3>
          <p className="muted">Inspect progress, artifacts and approval flow</p>
        </div>
        <button type="button" onClick={onOpenTrace}>
          Open Trace
        </button>
      </div>

      {!runId ? (
        <p className="muted">No run selected yet.</p>
      ) : (
        <>
          <article className="run-panel-status-card">
            <div>
              <span className="muted run-panel-kv-label">Run ID</span>
              <code>{runId}</code>
            </div>
            <div>
              <span className="muted run-panel-kv-label">Status</span>
              <span className={`status-badge status-${formatRunStatus(status)}`}>
                {formatRunStatus(status)}
              </span>
            </div>
            <div>
              <span className="muted run-panel-kv-label">Current Module</span>
              <strong>{currentModule ?? "-"}</strong>
            </div>
          </article>

          {canApprove ? (
            <article className="run-panel-approval-card">
              <h4>Approval Required ({awaitingModule})</h4>
              <p>{approvalSummary ?? "This module is waiting for manual approval."}</p>
              <textarea
                placeholder="Optional note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                disabled={approving}
              />
              <div className="run-panel-approval-actions">
                <button
                  type="button"
                  disabled={approving}
                  onClick={() => void onApprove(true, note.trim() || undefined)}
                >
                  {approving ? "Submitting..." : "Approve"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={approving}
                  onClick={() => void onApprove(false, note.trim() || undefined)}
                >
                  {approving ? "Submitting..." : "Reject"}
                </button>
              </div>
            </article>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <article className="run-panel-modules">
            <h4>Modules</h4>
            <div className="run-panel-module-list">
              {modules.map((item) => (
                <div key={item.module} className="run-panel-module-item">
                  <div className="run-panel-module-head">
                    <strong>{item.module}</strong>
                    <span className={`status-badge status-${item.status}`}>{item.status}</span>
                  </div>
                  <p className="muted">{item.summary || "-"}</p>
                  <div className="run-panel-module-meta">
                    {item.model ? <span>model: {item.model}</span> : null}
                    {item.requireHuman ? <span>requireHuman</span> : null}
                    {item.artifactNames.length > 0 ? (
                      <span>artifacts: {item.artifactNames.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="run-panel-artifacts">
            <h4>Artifacts ({artifacts.length})</h4>
            {artifacts.length === 0 ? <p className="muted">No artifacts yet.</p> : null}
            {artifacts.slice(-8).reverse().map((artifact) => (
              <div key={artifact.artifactId} className="run-panel-artifact-item">
                <strong>{artifact.name}</strong>
                <span className="muted">{artifact.contentType}</span>
              </div>
            ))}
          </article>

          <article className="run-panel-trace-preview">
            <h4>Recent Trace</h4>
            {recentTrace.length === 0 ? <p className="muted">No trace items yet.</p> : null}
            {recentTrace.map((item) => (
              <div key={item.id} className="run-panel-trace-item">
                <span className="muted">{formatTime(item.ts)}</span>
                <strong>{item.agentId}</strong>
                <span>{item.summary}</span>
              </div>
            ))}
          </article>
        </>
      )}
    </section>
  );
};
