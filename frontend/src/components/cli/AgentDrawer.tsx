import { KeyboardEvent, useMemo, useState } from "react";
import { fetchArtifactContent } from "../../api/client";
import type { AgentId, Artifact, Event, TopicDetail } from "../../types/events";

type DrawerTab = "logs" | "artifacts" | "context";

interface AgentDrawerProps {
  open: boolean;
  agentId: AgentId | null;
  events: Event[];
  artifacts: Artifact[];
  topic: TopicDetail | null;
  onClose: () => void;
  onSendCommand: (agentId: AgentId, text: string) => Promise<void>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const findLatestArtifact = (artifacts: Artifact[], keyword: string): Artifact | null => {
  const lowered = keyword.toLowerCase();
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const item = artifacts[index];
    if (item.name.toLowerCase().includes(lowered)) {
      return item;
    }
  }
  return null;
};

const formatArtifactContent = (contentType: string, raw: string): string => {
  if (contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
};

export const AgentDrawer = ({
  open,
  agentId,
  events,
  artifacts,
  topic,
  onClose,
  onSendCommand,
}: AgentDrawerProps) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>("logs");
  const [commandText, setCommandText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactContent, setArtifactContent] = useState("");
  const [artifactContentType, setArtifactContentType] = useState("text/plain");
  const [artifactError, setArtifactError] = useState("");

  const agentEvents = useMemo(() => {
    if (!agentId) {
      return [];
    }
    return events.filter((event) => event.agentId === agentId).sort((a, b) => b.ts - a.ts);
  }, [agentId, events]);

  const survey = useMemo(() => findLatestArtifact(artifacts, "survey"), [artifacts]);
  const idea = useMemo(() => findLatestArtifact(artifacts, "idea"), [artifacts]);
  const results = useMemo(() => findLatestArtifact(artifacts, "result"), [artifacts]);

  const renderedArtifactContent = useMemo(
    () => formatArtifactContent(artifactContentType, artifactContent),
    [artifactContent, artifactContentType],
  );

  const handleSend = async () => {
    if (!agentId) {
      return;
    }

    const text = commandText.trim();
    if (!text) {
      return;
    }

    setSending(true);
    setSendError("");

    try {
      await onSendCommand(agentId, text);
      setCommandText("");
    } catch (error) {
      setSendError(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const handleCommandEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleOpenArtifact = async (artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setArtifactModalOpen(true);
    setArtifactLoading(true);
    setArtifactError("");
    setArtifactContent("");
    setArtifactContentType(artifact.contentType);

    try {
      const result = await fetchArtifactContent(artifact.uri);
      setArtifactContent(result.content);
      setArtifactContentType(result.contentType);
    } catch (error) {
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  };

  const closeArtifactModal = () => {
    setArtifactModalOpen(false);
    setSelectedArtifact(null);
    setArtifactLoading(false);
    setArtifactError("");
    setArtifactContent("");
    setArtifactContentType("text/plain");
  };

  if (!open || !agentId) {
    return null;
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="agent-drawer" role="dialog" aria-label="Agent drawer">
        <header className="drawer-header">
          <div>
            <h3>{agentId} CLI</h3>
            <p>Send command and inspect logs/artifacts/context</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="drawer-tabs">
          <button
            type="button"
            className={activeTab === "logs" ? "active" : ""}
            onClick={() => setActiveTab("logs")}
          >
            Logs
          </button>
          <button
            type="button"
            className={activeTab === "artifacts" ? "active" : ""}
            onClick={() => setActiveTab("artifacts")}
          >
            Artifacts
          </button>
          <button
            type="button"
            className={activeTab === "context" ? "active" : ""}
            onClick={() => setActiveTab("context")}
          >
            Context
          </button>
        </div>

        <div className="drawer-body">
          {activeTab === "logs" ? (
            <div className="drawer-list">
              {agentEvents.length === 0 ? <p className="muted">No logs for this agent</p> : null}
              {agentEvents.map((event) => (
                <article key={event.eventId} className={`event-item event-${event.severity}`}>
                  <header>
                    <span>{new Date(event.ts).toLocaleString()}</span>
                    <span>{event.kind}</span>
                  </header>
                  <p>{event.summary}</p>
                </article>
              ))}
            </div>
          ) : null}

          {activeTab === "artifacts" ? (
            <div className="drawer-list">
              {artifacts.length === 0 ? <p className="muted">No artifacts yet</p> : null}
              {artifacts.map((artifact) => (
                <button
                  type="button"
                  key={artifact.artifactId}
                  className="artifact-item artifact-item-button"
                  onClick={() => void handleOpenArtifact(artifact)}
                >
                  <strong>{artifact.name}</strong>
                  <span>{artifact.contentType}</span>
                  <code>{artifact.uri}</code>
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === "context" ? (
            <div className="context-panel">
              <h4>Topic</h4>
              <p>{topic?.title ?? "Unknown topic"}</p>
              <p className="muted">{topic?.description || "暂无"}</p>

              <h4>Recent Survey</h4>
              <p>{survey ? survey.name : "暂无"}</p>

              <h4>Recent Idea</h4>
              <p>{idea ? idea.name : "暂无"}</p>

              <h4>Recent Results</h4>
              <p>{results ? results.name : "暂无"}</p>
            </div>
          ) : null}
        </div>

        <footer className="drawer-footer">
          <input
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            onKeyDown={handleCommandEnter}
            placeholder={`Command to ${agentId}`}
          />
          <button type="button" onClick={() => void handleSend()} disabled={sending}>
            {sending ? "Sending..." : "Send"}
          </button>
        </footer>

        {sendError ? <p className="form-error">{sendError}</p> : null}
      </aside>

      {artifactModalOpen ? (
        <div className="artifact-modal-overlay" role="dialog" aria-label="Artifact content modal">
          <div className="artifact-modal" onClick={(event) => event.stopPropagation()}>
            <header className="artifact-modal-header">
              <div>
                <h4>{selectedArtifact?.name ?? "Artifact"}</h4>
                <p className="muted">{artifactContentType}</p>
              </div>
              <button type="button" onClick={closeArtifactModal}>
                Close
              </button>
            </header>

            <div className="artifact-modal-body">
              {artifactLoading ? <p>Loading artifact...</p> : null}
              {!artifactLoading && artifactError ? <p className="form-error">{artifactError}</p> : null}
              {!artifactLoading && !artifactError ? <pre>{renderedArtifactContent || "(empty)"}</pre> : null}
            </div>
          </div>
          <button type="button" className="artifact-modal-backdrop" onClick={closeArtifactModal} />
        </div>
      ) : null}
    </>
  );
};
