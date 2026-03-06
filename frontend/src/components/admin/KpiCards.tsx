import type { AdminMetricsPayload } from "../../types/events";

interface KpiCardsProps {
  metrics: AdminMetricsPayload;
}

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

const formatRate = (value: number): string => {
  return `${(value * 100).toFixed(2)}%`;
};

export const KpiCards = ({ metrics }: KpiCardsProps) => {
  return (
    <section className="admin-kpi-grid">
      <article className="admin-kpi-card kpi-active">
        <span className="admin-kpi-label">Active Runs</span>
        <strong>{formatNumber(metrics.activeRuns)}</strong>
        <small>queued + running + paused</small>
      </article>
      <article className="admin-kpi-card kpi-approval">
        <span className="admin-kpi-label">Approvals Pending</span>
        <strong>{formatNumber(metrics.approvalsPending)}</strong>
        <small>awaiting_approval=true</small>
      </article>
      <article className="admin-kpi-card kpi-events">
        <span className="admin-kpi-label">Events (5m)</span>
        <strong>{formatNumber(metrics.eventsLast5m)}</strong>
        <small>rolling 5-minute window</small>
      </article>
      <article className="admin-kpi-card kpi-error">
        <span className="admin-kpi-label">Error Rate (5m)</span>
        <strong>{formatRate(metrics.errorRateLast5m)}</strong>
        <small>error / total events</small>
      </article>
    </section>
  );
};

