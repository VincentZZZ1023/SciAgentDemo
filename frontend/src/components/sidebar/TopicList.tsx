import { FormEvent, MouseEvent, useMemo, useState } from "react";
import type { TopicSummary } from "../../types/events";

interface TopicListProps {
  topics: TopicSummary[];
  currentTopicId?: string;
  loading: boolean;
  error: string;
  onSelect: (topicId: string) => void;
  onCreate: (name: string, description: string) => Promise<void>;
  onDelete: (topicId: string) => Promise<void>;
  onRefresh: () => Promise<TopicSummary[]>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const formatTopicTime = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "just now";
  }
  return new Date(timestamp).toLocaleDateString();
};

export const TopicList = ({
  topics,
  currentTopicId,
  loading,
  error,
  onSelect,
  onCreate,
  onDelete,
  onRefresh,
}: TopicListProps) => {
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  const filteredTopics = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return topics;
    }
    return topics.filter((topic) => topic.title.toLowerCase().includes(keyword));
  }, [search, topics]);

  const activeCount = useMemo(() => {
    return topics.filter((topic) => topic.status === "active").length;
  }, [topics]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const topicName = name.trim();

    if (!topicName) {
      setCreateError("Topic name is required");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      await onCreate(topicName, description.trim());
      setName("");
      setDescription("");
    } catch (createFailed) {
      setCreateError(getErrorMessage(createFailed));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>, topic: TopicSummary) => {
    event.stopPropagation();

    const confirmed = window.confirm(`Delete topic \"${topic.title}\"?`);
    if (!confirmed) {
      return;
    }

    setDeletingTopicId(topic.topicId);
    setCreateError("");

    try {
      await onDelete(topic.topicId);
    } catch (deleteError) {
      setCreateError(getErrorMessage(deleteError));
    } finally {
      setDeletingTopicId(null);
    }
  };

  return (
    <div className="topic-list">
      <div className="topic-list-brand">
        <div className="topic-list-brand-mark">S</div>
        <div>
          <h2>SciAgent Console</h2>
          <p className="muted">Workflow control center</p>
        </div>
      </div>

      <div className="topic-list-header">
        <div className="topic-list-header-meta">
          <h3>Topics</h3>
          <span className="topic-list-counter">{topics.length}</span>
        </div>
        <button
          type="button"
          className="topic-refresh-button"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="topic-list-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search topics"
          className="topic-search-input"
        />
        <div className="topic-list-stats">
          <span className="topic-stat">
            <strong>{activeCount}</strong> active
          </span>
          <span className="topic-stat">
            <strong>{topics.length}</strong> total
          </span>
        </div>
      </div>

      {error ? <div className="topic-list-error">{error}</div> : null}

      <div className="topic-items">
        {filteredTopics.length === 0 && !loading ? (
          <p className="muted">{topics.length > 0 ? "No matching topics" : "No topics yet"}</p>
        ) : null}
        {filteredTopics.map((topic) => {
          const active = topic.topicId === currentTopicId;
          const deleting = deletingTopicId === topic.topicId;

          return (
            <div key={topic.topicId} className={active ? "topic-item-row active" : "topic-item-row"}>
              <button type="button" className="topic-item" onClick={() => onSelect(topic.topicId)}>
                <div className="topic-item-main">
                  <span className="topic-item-dot" />
                  <span className="topic-item-title">{topic.title}</span>
                </div>
                <div className="topic-item-meta">
                  <span className={`topic-item-status topic-status-${topic.status}`}>{topic.status}</span>
                  <span className="topic-item-time">{formatTopicTime(topic.updatedAt)}</span>
                </div>
              </button>
              <button
                type="button"
                className="topic-delete-button"
                title="Delete topic"
                aria-label={`Delete ${topic.title}`}
                onClick={(event) => void handleDelete(event, topic)}
                disabled={deleting}
              >
                {deleting ? "..." : "Delete"}
              </button>
            </div>
          );
        })}
      </div>

      <form className="topic-create-form" onSubmit={handleCreate}>
        <div className="topic-create-head">
          <h3>Create Topic</h3>
          <p className="muted">Start a new research workflow</p>
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Topic name"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          rows={3}
        />

        {createError ? <p className="topic-list-error">{createError}</p> : null}

        <button type="submit" disabled={creating}>
          {creating ? "Creating..." : "Create Topic"}
        </button>
      </form>
    </div>
  );
};
