import type { AdminMetricsPayload } from "../../types/events";
import { SeriesChart } from "./SeriesChart";

interface AdminChartsProps {
  metrics: AdminMetricsPayload;
}

export const AdminCharts = ({ metrics }: AdminChartsProps) => {
  return (
    <section className="admin-charts-grid">
      <SeriesChart
        title="Events / min"
        subtitle="Rolling 60-minute event throughput"
        points={metrics.eventsSeries}
        variant="line"
        tone="accent"
      />
      <SeriesChart
        title="Errors / min"
        subtitle="Rolling 60-minute error volume"
        points={metrics.errorSeries}
        variant="bar"
        tone="danger"
      />
    </section>
  );
};

