import { useMemo, useState } from "react";
import { APP_COPY, formatAgentLabel, formatModuleStatusLabel, formatRunStatusLabel } from "../../lib/copy";
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
          <h3>{APP_COPY.runPanel.title}</h3>
          <p className="muted">{APP_COPY.runPanel.subtitle}</p>
        </div>
        <button type="button" onClick={onOpenTrace}>
          {APP_COPY.runPanel.openTrace}
        </button>
      </div>

      {!runId ? (
        <p className="muted">{APP_COPY.runPanel.noRunSelected}</p>
      ) : (
        <>
          <article className="run-panel-status-card">
            <div>
              <span className="muted run-panel-kv-label">{APP_COPY.runPanel.runId}</span>
              <code>{runId}</code>
            </div>
            <div>
              <span className="muted run-panel-kv-label">{APP_COPY.runPanel.status}</span>
              <span className={`status-badge status-${status || "idle"}`}>
                {formatRunStatusLabel(status)}
              </span>
            </div>
            <div>
              <span className="muted run-panel-kv-label">{APP_COPY.runPanel.currentModule}</span>
              <strong>{currentModule ?? "-"}</strong>
            </div>
          </article>

          {canApprove ? (
            <article className="run-panel-approval-card">
              <h4>{APP_COPY.runs.approvalRequired} ({awaitingModule})</h4>
              <p>{approvalSummary ?? APP_COPY.runs.approvalWaitingDesc}</p>
              <textarea
                placeholder={APP_COPY.common.optionalNote}
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
                  {approving ? APP_COPY.common.submitting : "通过"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={approving}
                  onClick={() => void onApprove(false, note.trim() || undefined)}
                >
                  {approving ? APP_COPY.common.submitting : "拒绝"}
                </button>
              </div>
            </article>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <article className="run-panel-modules">
            <h4>{APP_COPY.runPanel.modules}</h4>
            <div className="run-panel-module-list">
              {modules.map((item) => (
                <div key={item.module} className="run-panel-module-item">
                  <div className="run-panel-module-head">
                    <strong>{formatAgentLabel(item.module)}</strong>
                    <span className={`status-badge status-${item.status}`}>{formatModuleStatusLabel(item.status)}</span>
                  </div>
                  <p className="muted">{item.summary || "-"}</p>
                  <div className="run-panel-module-meta">
                    {item.model ? <span>{APP_COPY.runConfig.model}: {item.model}</span> : null}
                    {item.requireHuman ? <span>{APP_COPY.runConfig.requireHuman}</span> : null}
                    {item.artifactNames.length > 0 ? (
                      <span>{APP_COPY.runPanel.artifacts}: {item.artifactNames.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="run-panel-artifacts">
            <h4>{APP_COPY.runPanel.artifacts} ({artifacts.length})</h4>
            {artifacts.length === 0 ? <p className="muted">{APP_COPY.runPanel.noArtifacts}</p> : null}
            {artifacts.slice(-8).reverse().map((artifact) => (
              <div key={artifact.artifactId} className="run-panel-artifact-item">
                <strong>{artifact.name}</strong>
                <span className="muted">{artifact.contentType}</span>
              </div>
            ))}
          </article>

          <article className="run-panel-trace-preview">
            <h4>{APP_COPY.runPanel.recentTrace}</h4>
            {recentTrace.length === 0 ? <p className="muted">{APP_COPY.runPanel.noTrace}</p> : null}
            {recentTrace.map((item) => (
              <div key={item.id} className="run-panel-trace-item">
                <span className="muted">{formatTime(item.ts)}</span>
                <strong>{formatAgentLabel(item.agentId)}</strong>
                <span>{item.summary}</span>
              </div>
            ))}
          </article>
        </>
      )}
    </section>
  );
};
