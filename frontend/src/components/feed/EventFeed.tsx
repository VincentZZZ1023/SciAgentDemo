import { useMemo } from "react";
import type { Event } from "../../types/events";
import { APP_COPY, formatAgentLabel, formatEventKindLabel, formatSeverityLabel } from "../../lib/copy";

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
        <div className="panel-header-main">
          <h3>{APP_COPY.eventFeed.title}</h3>
          <span className="panel-header-subtitle">{APP_COPY.eventFeed.subtitle}</span>
        </div>
        <span>{orderedEvents.length}</span>
      </div>

      <div className="event-list">
        {orderedEvents.length === 0 ? <p className="muted">{APP_COPY.eventFeed.empty}</p> : null}

        {orderedEvents.map((event) => (
          <article key={event.eventId} className={`event-item event-${event.severity}`}>
            <header>
              <span className="event-time">{formatTime(event.ts)}</span>
              <div className="event-badges">
                <span className="event-badge event-badge-agent">{formatAgentLabel(event.agentId)}</span>
                <span className="event-badge event-badge-kind">{formatEventKindLabel(event.kind)}</span>
                <span className={`event-badge event-badge-severity severity-${event.severity}`}>
                  {formatSeverityLabel(event.severity)}
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
