import { useMemo } from "react";
import type { Event } from "../../types/events";

interface WorkflowDebugPanelProps {
  events: Event[];
}

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleString();
};

const sortEventsByTime = (events: Event[]): Event[] => {
  return [...events].sort((left, right) => {
    const tsDiff = left.ts - right.ts;
    if (tsDiff !== 0) {
      return tsDiff;
    }
    return left.eventId.localeCompare(right.eventId);
  });
};

const stringifyPayload = (event: Event): string => {
  const payload = event.payload ?? {};
  return JSON.stringify(payload, null, 2);
};

export const WorkflowDebugPanel = ({ events }: WorkflowDebugPanelProps) => {
  const orderedEvents = useMemo(() => sortEventsByTime(events), [events]);

  return (
    <section className="workflow-debug-panel">
      <header className="workflow-debug-panel-header">
        <h4>Raw Events</h4>
        <span className="muted">{orderedEvents.length}</span>
      </header>

      <div className="workflow-debug-list">
        {orderedEvents.length === 0 ? <p className="muted">No debug events.</p> : null}

        {orderedEvents.map((event) => (
          <article key={event.eventId} className={`workflow-debug-item event-${event.severity}`}>
            <header>
              <span className="event-time">{formatTime(event.ts)}</span>
              <div className="event-badges">
                <span className="event-badge">{event.agentId}</span>
                <span className="event-badge event-badge-kind">{event.kind}</span>
                <span className={`event-badge event-badge-severity severity-${event.severity}`}>
                  {event.severity}
                </span>
              </div>
            </header>

            <p className="workflow-feed-summary">{event.summary}</p>

            <details className="workflow-debug-payload">
              <summary>Payload</summary>
              <pre>{stringifyPayload(event)}</pre>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
};
