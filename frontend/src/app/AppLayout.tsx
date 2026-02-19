import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { createTopic, deleteTopic, getTopics } from "../api/client";
import { TopicList } from "../components/sidebar/TopicList";
import type { TopicSummary } from "../types/events";

export interface AppLayoutContext {
  topics: TopicSummary[];
  currentTopicId?: string;
  refreshTopics: () => Promise<TopicSummary[]>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
};

export const AppLayout = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();

  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicsError, setTopicsError] = useState("");

  const refreshTopics = useCallback(async (): Promise<TopicSummary[]> => {
    setLoadingTopics(true);
    setTopicsError("");

    try {
      const data = await getTopics();
      setTopics(data);
      return data;
    } catch (error) {
      setTopicsError(getErrorMessage(error));
      return [];
    } finally {
      setLoadingTopics(false);
    }
  }, []);

  useEffect(() => {
    void refreshTopics();
  }, [refreshTopics]);

  useEffect(() => {
    if (!topicId && topics.length > 0) {
      navigate(`/topics/${topics[0].topicId}`, { replace: true });
      return;
    }

    if (
      topicId &&
      topics.length > 0 &&
      !loadingTopics &&
      !topicsError &&
      !topics.some((topic) => topic.topicId === topicId)
    ) {
      navigate(`/topics/${topics[0].topicId}`, { replace: true });
    }
  }, [loadingTopics, navigate, topicId, topics, topicsError]);

  const handleSelectTopic = (selectedTopicId: string) => {
    navigate(`/topics/${selectedTopicId}`);
  };

  const handleCreateTopic = async (name: string, description: string) => {
    const created = await createTopic(name, description);
    navigate(`/topics/${created.topicId}`);
    void refreshTopics();
  };

  const handleDeleteTopic = async (topicIdToDelete: string) => {
    await deleteTopic(topicIdToDelete);
    const refreshedTopics = await refreshTopics();

    if (refreshedTopics.length === 0) {
      navigate("/topics", { replace: true });
      return;
    }

    if (!topicId || topicId === topicIdToDelete) {
      navigate(`/topics/${refreshedTopics[0].topicId}`, { replace: true });
      return;
    }

    const stillExists = refreshedTopics.some((topic) => topic.topicId === topicId);
    if (!stillExists) {
      navigate(`/topics/${refreshedTopics[0].topicId}`, { replace: true });
    }
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <TopicList
          topics={topics}
          currentTopicId={topicId}
          loading={loadingTopics}
          error={topicsError}
          onSelect={handleSelectTopic}
          onCreate={handleCreateTopic}
          onDelete={handleDeleteTopic}
          onRefresh={refreshTopics}
        />
      </aside>

      <main className="app-main">
        <Outlet
          context={
            {
              topics,
              currentTopicId: topicId,
              refreshTopics,
            } satisfies AppLayoutContext
          }
        />
      </main>
    </div>
  );
};
