import { useMemo, useState } from "react";
import { fetchArtifactContent } from "../../api/client";
import { ArtifactContentView } from "../artifact/ArtifactContentView";
import {
  isArtifact,
  isMessage,
  type AgentId,
  type Artifact,
  type Message,
  type TraceItem,
} from "../../types/events";

type AgentFilter = "all" | AgentId;
type KindFilter = "all" | "message" | "artifact" | "status";

interface TraceTimelineProps {
  items: TraceItem[];
  artifacts: Artifact[];
  loading: boolean;
  error: string;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getTraceMessage = (item: TraceItem): Message | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  const raw = item.payload.message;
  return isMessage(raw) ? raw : null;
};

const getTraceArtifact = (item: TraceItem): Artifact | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  const raw = item.payload.artifact;
  return isArtifact(raw) ? raw : null;
};

const getTraceStatus = (item: TraceItem): string | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  const status = item.payload.status;
  return typeof status === "string" && status ? status : null;
};

const trimSummary = (text: string, max = 160): string => {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
};

const parseArtifactNameFromSummary = (summary: string): string | null => {
  const prefix = "artifact: ";
  if (!summary.startsWith(prefix)) {
    return null;
  }
  const value = summary.slice(prefix.length).trim();
  return value || null;
};

export const TraceTimeline = ({ items, artifacts, loading, error }: TraceTimelineProps) => {
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [selectedArtifactName, setSelectedArtifactName] = useState("");
  const [artifactContentType, setArtifactContentType] = useState("text/plain");
  const [artifactContent, setArtifactContent] = useState("");
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState("");

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.ts - b.ts);
  }, [items]);

  const filteredItems = useMemo(() => {
    return sortedItems.filter((item) => {
      if (agentFilter !== "all" && item.agentId !== agentFilter) {
        return false;
      }
      if (kindFilter !== "all" && item.kind !== kindFilter) {
        return false;
      }
      return true;
    });
  }, [agentFilter, kindFilter, sortedItems]);

  const openArtifactPreview = async (artifact: Artifact) => {
    setSelectedArtifactName(artifact.name);
    setArtifactModalOpen(true);
    setArtifactContentType(artifact.contentType);
    setArtifactContent("");
    setArtifactError("");
    setArtifactLoading(true);

    try {
      const loaded = await fetchArtifactContent(artifact.uri);
      setArtifactContent(loaded.content);
      setArtifactContentType(loaded.contentType);
    } catch (loadError) {
      setArtifactError(getErrorMessage(loadError));
    } finally {
      setArtifactLoading(false);
    }
  };

  const closeArtifactPreview = () => {
    setArtifactModalOpen(false);
    setSelectedArtifactName("");
    setArtifactContentType("text/plain");
    setArtifactContent("");
    setArtifactError("");
    setArtifactLoading(false);
  };

  return (
    <div className="trace-timeline">
      <header className="panel-header trace-header">
        <h3>Trace Timeline</h3>
        <span>{filteredItems.length} items</span>
      </header>

      <div className="trace-filters">
        <label>
          Agent
          <select
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value as AgentFilter)}
          >
            <option value="all">All</option>
            <option value="review">review</option>
            <option value="ideation">ideation</option>
            <option value="experiment">experiment</option>
          </select>
        </label>

        <label>
          Kind
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)}>
            <option value="all">All</option>
            <option value="message">message</option>
            <option value="artifact">artifact</option>
            <option value="status">status</option>
          </select>
        </label>
      </div>

      <div className="trace-list">
        {loading ? <p className="muted">Loading trace...</p> : null}
        {!loading && error ? <p className="form-error">{error}</p> : null}
        {!loading && !error && filteredItems.length === 0 ? <p className="muted">No trace items</p> : null}

        {!loading && !error
          ? filteredItems.map((item) => {
              const message = item.kind === "message" ? getTraceMessage(item) : null;
              const artifact = item.kind === "artifact" ? getTraceArtifact(item) : null;
              const status = item.kind === "status" ? getTraceStatus(item) : null;
              const isExpanded = expandedMessages[item.id] ?? false;
              const content = message?.content ?? item.summary;
              const shortContent = trimSummary(content, 180);

              return (
                <article key={item.id} className="trace-item">
                  <header>
                    <div className="trace-meta">
                      <span className="event-badge">{item.agentId}</span>
                      <span className="event-badge event-badge-kind">{item.kind}</span>
                      <span className="event-time">{new Date(item.ts).toLocaleString()}</span>
                    </div>
                  </header>

                  {item.kind === "message" ? (
                    <div className="trace-message">
                      <p>
                        <strong>{message?.role ?? "assistant"}:</strong>{" "}
                        {isExpanded ? content : shortContent}
                      </p>
                      {content.length > 180 ? (
                        <button
                          type="button"
                          className="trace-link-button"
                          onClick={() =>
                            setExpandedMessages((current) => ({
                              ...current,
                              [item.id]: !isExpanded,
                            }))
                          }
                        >
                          {isExpanded ? "Collapse" : "Expand"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {item.kind === "artifact" ? (
                    <div className="trace-artifact">
                      <p>{artifact ? artifact.name : item.summary}</p>
                      {artifact ? (
                        <button
                          type="button"
                          className="trace-link-button"
                          onClick={() => void openArtifactPreview(artifact)}
                        >
                          Preview
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {item.kind === "status" ? (
                    <p>
                      <strong>Status:</strong> {status ?? "unknown"} - {item.summary}
                    </p>
                  ) : null}

                  {item.kind === "event" ? <p>{item.summary}</p> : null}

                  {item.kind === "artifact" && !artifact ? (
                    <button
                      type="button"
                      className="trace-link-button"
                      onClick={() => {
                        const artifactName = parseArtifactNameFromSummary(item.summary);
                        if (!artifactName) {
                          return;
                        }
                        const fallback = artifacts.find((entry) => entry.name === artifactName);
                        if (fallback) {
                          void openArtifactPreview(fallback);
                        }
                      }}
                    >
                      Try preview
                    </button>
                  ) : null}
                </article>
              );
            })
          : null}
      </div>

      {artifactModalOpen ? (
        <div className="artifact-modal-overlay" role="dialog" aria-label="Trace artifact modal">
          <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
            <header className="artifact-modal-header">
              <div>
                <h4>{selectedArtifactName || "Artifact"}</h4>
                <p className="muted">{artifactContentType}</p>
              </div>
              <button type="button" onClick={closeArtifactPreview}>
                Close
              </button>
            </header>

            <div className="artifact-modal-body">
              {artifactLoading ? <p>Loading artifact...</p> : null}
              {!artifactLoading && artifactError ? <p className="form-error">{artifactError}</p> : null}
              {!artifactLoading && !artifactError ? (
                <ArtifactContentView
                  contentType={artifactContentType}
                  content={artifactContent}
                  artifactName={selectedArtifactName}
                />
              ) : null}
            </div>
          </div>
          <button type="button" className="artifact-modal-backdrop" onClick={closeArtifactPreview} />
        </div>
      ) : null}
    </div>
  );
};
