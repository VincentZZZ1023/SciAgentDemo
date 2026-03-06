import type { AdminPendingApproval, AdminRecentError } from "../../types/events";

interface ApprovalsListProps {
  approvalsPending: number;
  errorRateLast5m: number;
  eventsLast5m: number;
  pendingApprovals: AdminPendingApproval[];
  recentErrors: AdminRecentError[];
  onOpenRun: (topicId: string, runId: string) => void;
}

const formatRate = (value: number): string => `${(value * 100).toFixed(2)}%`;
const formatTs = (ts: number): string => {
  if (!Number.isFinite(ts) || ts <= 0) {
    return "-";
  }
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const ApprovalsList = ({
  approvalsPending,
  errorRateLast5m,
  eventsLast5m,
  pendingApprovals,
  recentErrors,
  onOpenRun,
}: ApprovalsListProps) => {
  const anomalies: string[] = [];

  if (errorRateLast5m > 0) {
    anomalies.push(`Error rate in last 5m: ${formatRate(errorRateLast5m)}`);
  }
  if (eventsLast5m === 0) {
    anomalies.push("No events in the last 5 minutes.");
  }
  if (approvalsPending > 0) {
    anomalies.push(`${approvalsPending} run(s) waiting for manual approval.`);
  }

  return (
    <section className="admin-side-panel">
      <header className="admin-panel-header">
        <h3>Approvals / Anomalies</h3>
        <span>real-time control lane</span>
      </header>

      <div className="admin-side-metrics">
        <div>
          <span>Pending</span>
          <strong>{approvalsPending}</strong>
        </div>
        <div>
          <span>Error Rate</span>
          <strong>{formatRate(errorRateLast5m)}</strong>
        </div>
      </div>

      <div className="admin-approvals-list">
        <h4>Pending Approval Runs</h4>
        {pendingApprovals.length === 0 ? <p className="muted">No pending approvals.</p> : null}
        {pendingApprovals.map((item) => (
          <article key={`${item.runId}-${item.updatedAt}`} className="admin-approval-item">
            <div>
              <strong>{item.runId}</strong>
              <p>
                {item.topicId} | {item.awaitingModule ?? "unknown"} | {formatTs(item.updatedAt)}
              </p>
            </div>
            <button type="button" onClick={() => onOpenRun(item.topicId, item.runId)}>
              Open User View
            </button>
          </article>
        ))}
      </div>

      <div className="admin-anomaly-list">
        <h4>Recent Errors</h4>
        {recentErrors.length === 0 ? <p className="muted">No recent errors.</p> : null}
        {recentErrors.map((item) => (
          <details key={`${item.ts}-${item.runId}-${item.module}`} className="admin-error-item">
            <summary>
              <span>{formatTs(item.ts)}</span>
              <strong>{item.module}</strong>
              <span>{item.runId}</span>
            </summary>
            <p>{item.message}</p>
          </details>
        ))}
      </div>

      <div className="admin-anomaly-list">
        <h4>Anomaly Signals</h4>
        {anomalies.length === 0 ? <p className="muted">No anomaly signals.</p> : null}
        {anomalies.map((item) => (
          <p key={item} className="admin-anomaly-item">
            {item}
          </p>
        ))}
      </div>
    </section>
  );
};
