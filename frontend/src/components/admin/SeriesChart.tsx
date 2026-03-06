import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { AdminSeriesPoint } from "../../types/events";

interface SeriesChartProps {
  title: string;
  subtitle: string;
  points: AdminSeriesPoint[];
  variant: "line" | "bar";
  tone: "accent" | "danger";
}

const CHART_WIDTH = 680;
const CHART_HEIGHT = 240;
const PADDING = { top: 16, right: 14, bottom: 34, left: 40 };

const formatLabel = (ts: number): string => {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatTooltip = (point: AdminSeriesPoint): string => {
  return `${formatLabel(point.t)}: ${point.count}`;
};

export const SeriesChart = ({ title, subtitle, points, variant, tone }: SeriesChartProps) => {
  const sorted = useMemo(() => {
    return [...points].sort((left, right) => left.t - right.t);
  }, [points]);

  const maxY = useMemo(() => {
    const maxValue = sorted.reduce((acc, item) => Math.max(acc, item.count), 0);
    return Math.max(1, maxValue);
  }, [sorted]);

  const chartInnerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const chartInnerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const projected = useMemo(() => {
    if (sorted.length === 0) {
      return [];
    }

    const divisor = Math.max(1, sorted.length - 1);
    return sorted.map((point, index) => {
      const x = PADDING.left + (index / divisor) * chartInnerWidth;
      const y = PADDING.top + chartInnerHeight * (1 - point.count / maxY);
      return { ...point, x, y };
    });
  }, [chartInnerHeight, chartInnerWidth, maxY, sorted]);

  const polylinePoints = projected.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = (() => {
    if (projected.length === 0) {
      return "";
    }
    const first = projected[0];
    const last = projected[projected.length - 1];
    return [
      `M ${first.x} ${PADDING.top + chartInnerHeight}`,
      `L ${first.x} ${first.y}`,
      ...projected.slice(1).map((point) => `L ${point.x} ${point.y}`),
      `L ${last.x} ${PADDING.top + chartInnerHeight}`,
      "Z",
    ].join(" ");
  })();

  const yTicks = [0, Math.ceil(maxY / 2), maxY];
  const xStart = sorted.length > 0 ? sorted[0].t : 0;
  const xMid = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)].t : 0;
  const xEnd = sorted.length > 0 ? sorted[sorted.length - 1].t : 0;
  const chartStyle = { "--admin-chart-color": `var(--${tone})` } as CSSProperties;

  return (
    <article className="admin-chart-card" style={chartStyle}>
      <header className="admin-panel-header">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </header>

      <div className="admin-chart-wrap">
        {projected.length === 0 ? (
          <div className="admin-chart-empty muted">No data in this window.</div>
        ) : (
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="admin-chart-svg" role="img" aria-label={title}>
            <g className="admin-chart-grid">
              {yTicks.map((tick) => {
                const y = PADDING.top + chartInnerHeight * (1 - tick / maxY);
                return <line key={tick} x1={PADDING.left} y1={y} x2={CHART_WIDTH - PADDING.right} y2={y} />;
              })}
            </g>

            {variant === "line" ? (
              <g className="admin-chart-line-group">
                <path d={areaPath} className="admin-chart-area" />
                <polyline points={polylinePoints} className="admin-chart-line" />
                {projected.map((point) => (
                  <circle key={`${point.t}-${point.x}`} cx={point.x} cy={point.y} r={3.2} className="admin-chart-point">
                    <title>{formatTooltip(point)}</title>
                  </circle>
                ))}
              </g>
            ) : (
              <g className="admin-chart-bar-group">
                {projected.map((point, index) => {
                  const slot = chartInnerWidth / Math.max(1, projected.length);
                  const width = Math.max(5, slot * 0.62);
                  const x = PADDING.left + slot * index + (slot - width) / 2;
                  const height = PADDING.top + chartInnerHeight - point.y;
                  return (
                    <rect
                      key={`${point.t}-${index}`}
                      x={x}
                      y={point.y}
                      width={width}
                      height={Math.max(2, height)}
                      rx={3}
                      className="admin-chart-bar"
                    >
                      <title>{formatTooltip(point)}</title>
                    </rect>
                  );
                })}
              </g>
            )}

            <g className="admin-chart-y-axis">
              {yTicks.map((tick) => {
                const y = PADDING.top + chartInnerHeight * (1 - tick / maxY);
                return (
                  <text key={`y-${tick}`} x={8} y={y + 4}>
                    {tick}
                  </text>
                );
              })}
            </g>

            <g className="admin-chart-x-axis">
              <text x={PADDING.left} y={CHART_HEIGHT - 8}>
                {formatLabel(xStart)}
              </text>
              <text x={CHART_WIDTH / 2} y={CHART_HEIGHT - 8} textAnchor="middle">
                {formatLabel(xMid)}
              </text>
              <text x={CHART_WIDTH - PADDING.right} y={CHART_HEIGHT - 8} textAnchor="end">
                {formatLabel(xEnd)}
              </text>
            </g>
          </svg>
        )}
      </div>
    </article>
  );
};
