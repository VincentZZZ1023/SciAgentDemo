import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifactContent,
  getAgentMessages,
  postAgentMessage,
} from "../../api/client";
import {
  parseMessageFromEvent,
  type AgentId,
  type Artifact,
  type Event,
  type Message,
  type TopicDetail,
} from "../../types/events";

type DrawerTab = "logs" | "artifacts" | "context" | "chat";

interface AgentDrawerProps {
  open: boolean;
  topicId: string;
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

interface AgentArtifactRecord {
  artifact: Artifact;
  ts: number;
  source: "event" | "snapshot";
}

const inferArtifactAgent = (artifact: Artifact): AgentId => {
  const lowered = artifact.name.toLowerCase();
  if (lowered.includes("survey")) {
    return "review";
  }
  if (lowered.includes("idea")) {
    return "ideation";
  }
  return "experiment";
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

const mergeMessages = (current: Message[], incoming: Message[]): Message[] => {
  const map = new Map<string, Message>();

  for (const item of current) {
    map.set(item.messageId, item);
  }
  for (const item of incoming) {
    map.set(item.messageId, item);
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
};

export const AgentDrawer = ({
  open,
  topicId,
  agentId,
  events,
  artifacts,
  topic,
  onClose,
  onSendCommand,
}: AgentDrawerProps) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>("logs");

  const [commandText, setCommandText] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);
  const [sendCommandError, setSendCommandError] = useState("");

  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactContent, setArtifactContent] = useState("");
  const [artifactContentType, setArtifactContentType] = useState("text/plain");
  const [artifactError, setArtifactError] = useState("");

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const topicEvents = useMemo(() => {
    return events
      .filter((event) => event.topicId === topicId)
      .sort((a, b) => b.ts - a.ts);
  }, [events, topicId]);

  const agentEvents = useMemo(() => {
    if (!agentId) {
      return [];
    }
    return topicEvents.filter((event) => event.agentId === agentId);
  }, [agentId, topicEvents]);

  const agentArtifacts = useMemo<AgentArtifactRecord[]>(() => {
    if (!agentId) {
      return [];
    }

    const map = new Map<string, AgentArtifactRecord>();

    for (const event of topicEvents) {
      if (
        event.kind !== "artifact_created" ||
        event.agentId !== agentId ||
        !Array.isArray(event.artifacts)
      ) {
        continue;
      }

      for (const artifact of event.artifacts) {
        map.set(artifact.artifactId, {
          artifact,
          ts: event.ts,
          source: "event",
        });
      }
    }

    // Fallback for older snapshots that may not include artifact_created events in memory.
    for (const artifact of artifacts) {
      if (inferArtifactAgent(artifact) !== agentId) {
        continue;
      }
      if (map.has(artifact.artifactId)) {
        continue;
      }
      map.set(artifact.artifactId, {
        artifact,
        ts: 0,
        source: "snapshot",
      });
    }

    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }, [agentId, artifacts, topicEvents]);

  const latestUserNotes = useMemo(() => {
    return chatMessages
      .filter((message) => message.role === "user")
      .slice(-3)
      .reverse();
  }, [chatMessages]);

  const renderedArtifactContent = useMemo(
    () => formatArtifactContent(artifactContentType, artifactContent),
    [artifactContent, artifactContentType],
  );

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    let cancelled = false;
    setLoadingChat(true);
    setChatError("");
    setChatMessages([]);

    void getAgentMessages(topicId, agentId)
      .then((messages) => {
        if (!cancelled) {
          setChatMessages(messages);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = getErrorMessage(error);
          setChatError(message);
          showToast(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChat(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, open, topicId]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const incoming: Message[] = [];
    for (const event of events) {
      if (event.topicId !== topicId || event.agentId !== agentId) {
        continue;
      }
      const message = parseMessageFromEvent(event);
      if (message) {
        incoming.push(message);
      }
    }

    if (incoming.length > 0) {
      setChatMessages((current) => mergeMessages(current, incoming));
    }
  }, [agentId, events, open, topicId]);

  const handleSendCommand = async () => {
    if (!agentId) {
      return;
    }

    const text = commandText.trim();
    if (!text) {
      return;
    }

    setSendingCommand(true);
    setSendCommandError("");

    try {
      await onSendCommand(agentId, text);
      setCommandText("");
    } catch (error) {
      const message = getErrorMessage(error);
      setSendCommandError(message);
      showToast(message);
    } finally {
      setSendingCommand(false);
    }
  };

  const handleCommandEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSendCommand();
    }
  };

  const handleSendChat = async () => {
    if (!agentId) {
      return;
    }

    const content = chatInput.trim();
    if (!content) {
      return;
    }

    setSendingChat(true);
    setChatError("");

    try {
      const created = await postAgentMessage(topicId, agentId, content);
      setChatMessages((current) => mergeMessages(current, created));
      setChatInput("");
    } catch (error) {
      const message = getErrorMessage(error);
      setChatError(message);
      showToast(message);
    } finally {
      setSendingChat(false);
    }
  };

  const handleChatEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSendChat();
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
            <p>Send command and inspect logs/artifacts/context/chat</p>
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
          <button
            type="button"
            className={activeTab === "chat" ? "active" : ""}
            onClick={() => setActiveTab("chat")}
          >
            Chat
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
              {agentArtifacts.length === 0 ? (
                <p className="muted">No artifacts for this agent yet</p>
              ) : null}
              {agentArtifacts.map((record) => (
                <button
                  type="button"
                  key={record.artifact.artifactId}
                  className="artifact-item artifact-item-button"
                  onClick={() => void handleOpenArtifact(record.artifact)}
                >
                  <strong>{record.artifact.name}</strong>
                  <span>{record.artifact.contentType}</span>
                  <span className="muted">
                    {record.ts > 0
                      ? new Date(record.ts).toLocaleString()
                      : "time unavailable (snapshot)"}
                  </span>
                  <code>{record.artifact.uri}</code>
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === "context" ? (
            <div className="context-panel">
              <h4>Topic</h4>
              <p>{topic?.title ?? "Unknown topic"}</p>
              <p className="muted">{topic?.description || "N/A"}</p>

              <h4>Latest Agent Activity</h4>
              {agentEvents.length === 0 ? <p className="muted">No recent events</p> : null}
              {agentEvents.slice(0, 3).map((event) => (
                <p key={event.eventId}>
                  <strong>{new Date(event.ts).toLocaleTimeString()}:</strong> {event.summary}
                </p>
              ))}

              <h4>Recent Artifacts ({agentId})</h4>
              {agentArtifacts.length === 0 ? <p className="muted">No artifacts</p> : null}
              {agentArtifacts.slice(0, 3).map((record) => (
                <p key={record.artifact.artifactId}>
                  <strong>{record.artifact.name}</strong>
                  <span className="muted">
                    {" "}
                    {record.ts > 0
                      ? `(${new Date(record.ts).toLocaleTimeString()})`
                      : "(snapshot)"}
                  </span>
                </p>
              ))}

              <h4>Recent User Constraints</h4>
              {latestUserNotes.length === 0 ? <p className="muted">No user notes yet</p> : null}
              {latestUserNotes.map((message) => (
                <p key={message.messageId}>{message.content}</p>
              ))}
            </div>
          ) : null}

          {activeTab === "chat" ? (
            <div className="chat-panel">
              {loadingChat ? <p className="muted">Loading messages...</p> : null}
              {!loadingChat && chatMessages.length === 0 ? <p className="muted">No messages yet</p> : null}

              <div className="chat-list">
                {chatMessages.map((message) => (
                  <article
                    key={message.messageId}
                    className={`chat-bubble chat-bubble-${message.role}`}
                  >
                    <p>{message.content}</p>
                    <span className="chat-meta">{new Date(message.ts).toLocaleString()}</span>
                  </article>
                ))}
              </div>

              {chatError ? <p className="form-error">{chatError}</p> : null}
            </div>
          ) : null}
        </div>

        {activeTab === "chat" ? (
          <footer className="drawer-footer">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={handleChatEnter}
              placeholder={`Message to ${agentId}`}
            />
            <button type="button" onClick={() => void handleSendChat()} disabled={sendingChat}>
              {sendingChat ? "Sending..." : "Send"}
            </button>
          </footer>
        ) : (
          <footer className="drawer-footer">
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              onKeyDown={handleCommandEnter}
              placeholder={`Command to ${agentId}`}
            />
            <button type="button" onClick={() => void handleSendCommand()} disabled={sendingCommand}>
              {sendingCommand ? "Sending..." : "Send"}
            </button>
          </footer>
        )}

        {sendCommandError ? <p className="form-error">{sendCommandError}</p> : null}
        {toastMessage ? <div className="drawer-toast">{toastMessage}</div> : null}
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

