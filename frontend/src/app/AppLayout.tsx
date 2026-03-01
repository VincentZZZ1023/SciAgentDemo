import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
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
  const location = useLocation();
  const { topicId } = useParams();
  const searchParams = new URLSearchParams(location.search);
  const queryTopicId = searchParams.get("topicId");
  const queryRunId = searchParams.get("runId");

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
    if (!topicId && queryTopicId && topics.some((topic) => topic.topicId === queryTopicId)) {
      const query = queryRunId ? `?runId=${encodeURIComponent(queryRunId)}` : "";
      navigate(`/app/${queryTopicId}${query}`, { replace: true });
      return;
    }

    if (!topicId && topics.length > 0) {
      navigate(`/app/${topics[0].topicId}`, { replace: true });
      return;
    }

    if (
      topicId &&
      topics.length > 0 &&
      !loadingTopics &&
      !topicsError &&
      !topics.some((topic) => topic.topicId === topicId)
    ) {
      navigate(`/app/${topics[0].topicId}`, { replace: true });
    }
  }, [loadingTopics, navigate, queryRunId, queryTopicId, topicId, topics, topicsError]);

  const handleSelectTopic = (selectedTopicId: string) => {
    navigate(`/app/${selectedTopicId}`);
  };

  const handleCreateTopic = async (name: string, description: string) => {
    const created = await createTopic(name, description);
    navigate(`/app/${created.topicId}`);
    void refreshTopics();
  };

  const handleDeleteTopic = async (topicIdToDelete: string) => {
    await deleteTopic(topicIdToDelete);
    const refreshedTopics = await refreshTopics();

    if (refreshedTopics.length === 0) {
      navigate("/app", { replace: true });
      return;
    }

    if (!topicId || topicId === topicIdToDelete) {
      navigate(`/app/${refreshedTopics[0].topicId}`, { replace: true });
      return;
    }

    const stillExists = refreshedTopics.some((topic) => topic.topicId === topicId);
    if (!stillExists) {
      navigate(`/app/${refreshedTopics[0].topicId}`, { replace: true });
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
