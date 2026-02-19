import { useMemo } from "react";
import type { Event } from "../../types/events";

interface EventFeedProps {
  events: Event[];
}

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleString();
};

export const EventFeed = ({ events }: EventFeedProps) => {
  const orderedEvents = useMemo(() => {
    return [...events].sort((a, b) => a.ts - b.ts);
  }, [events]);

  return (
    <section className="event-feed">
      <div className="panel-header">
        <h3>Event Feed</h3>
        <span>{orderedEvents.length}</span>
      </div>

      <div className="event-list">
        {orderedEvents.length === 0 ? <p className="muted">No events yet</p> : null}

        {orderedEvents.map((event) => (
          <article key={event.eventId} className={`event-item event-${event.severity}`}>
            <header>
              <span className="event-time">{formatTime(event.ts)}</span>
              <div className="event-badges">
                <span className="event-badge event-badge-agent">{event.agentId}</span>
                <span className="event-badge event-badge-kind">{event.kind}</span>
                <span className={`event-badge event-badge-severity severity-${event.severity}`}>
                  {event.severity}
                </span>
              </div>
            </header>
            <p>{event.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
};
