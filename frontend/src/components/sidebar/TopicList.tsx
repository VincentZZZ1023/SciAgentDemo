import { FormEvent, MouseEvent, useState } from "react";
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

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
      <div className="topic-list-header">
        <h2>Topics</h2>
        <button type="button" onClick={() => void onRefresh()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <div className="topic-list-error">{error}</div> : null}

      <div className="topic-items">
        {topics.length === 0 && !loading ? <p className="muted">No topics yet</p> : null}
        {topics.map((topic) => {
          const active = topic.topicId === currentTopicId;
          const deleting = deletingTopicId === topic.topicId;

          return (
            <div key={topic.topicId} className={active ? "topic-item-row active" : "topic-item-row"}>
              <button type="button" className="topic-item" onClick={() => onSelect(topic.topicId)}>
                <span className="topic-item-title">{topic.title}</span>
                <span className="topic-item-status">{topic.status}</span>
              </button>
              <button
                type="button"
                className="topic-delete-button"
                title="Delete topic"
                aria-label={`Delete ${topic.title}`}
                onClick={(event) => void handleDelete(event, topic)}
                disabled={deleting}
              >
                {deleting ? "..." : "🗑️"}
              </button>
            </div>
          );
        })}
      </div>

      <form className="topic-create-form" onSubmit={handleCreate}>
        <h3>New Topic</h3>
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
