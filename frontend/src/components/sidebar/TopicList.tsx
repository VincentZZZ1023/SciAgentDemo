import { useMemo, useState } from "react";
import type { AuthUser } from "../../auth/AuthContext";
import type { TopicSummary } from "../../types/events";
import { BrandSymbol } from "../brand";

interface TopicListProps {
  user: AuthUser | null;
  isAdmin: boolean;
  topics: TopicSummary[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  currentTopicId?: string;
  loading: boolean;
  error: string;
  onSelect: (topicId: string) => void;
  onCreate: (name: string, description: string) => Promise<void>;
  onDelete: (topicId: string) => Promise<void>;
  onRefresh: () => Promise<TopicSummary[]>;
  onSwitchAccount: () => void;
  onLogout: () => void;
}

const getTopicDisplayTitle = (topic: TopicSummary): string => {
  const historyTitle = typeof topic.historyTitle === "string" ? topic.historyTitle.trim() : "";
  if (historyTitle) {
    return historyTitle;
  }
  return topic.title?.trim() || topic.topicId;
};

export const TopicList = ({
  user,
  topics,
  collapsed = false,
  onToggleCollapsed,
  currentTopicId,
  loading,
  error,
  onSelect,
  onCreate,
  onLogout,
}: TopicListProps) => {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearch = searchValue.trim().toLowerCase();

  const orderedTopics = useMemo(() => {
    const sorted = [...topics].sort((left, right) => right.updatedAt - left.updatedAt);
    if (!normalizedSearch) {
      return sorted;
    }

    return sorted.filter((topic) => {
      const haystack = `${getTopicDisplayTitle(topic)} ${topic.topicId}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [topics, normalizedSearch]);

  const handleCreate = async () => {
    const name = window.prompt("输入新任务标题");
    const trimmed = name?.trim();
    if (!trimmed) {
      return;
    }
    await onCreate(trimmed, "");
  };

  return (
    <div className={`topic-console-sidebar ${collapsed ? "topic-console-sidebar-collapsed" : ""}`}>
      <div className={`topic-console-fixed-top ${collapsed ? "topic-console-fixed-top-collapsed" : ""}`}>
        <div className={`topic-console-brand ${collapsed ? "topic-console-brand-collapsed" : ""}`}>
          <div className="topic-list-brand-mark" aria-hidden="true">
            <BrandSymbol size={collapsed ? 28 : 38} theme="light" />
          </div>
          {!collapsed ? (
            <div className="topic-list-brand">
              <div>
                <p>AI Research Agent</p>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="topic-console-collapse"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <span className="material-symbols-outlined">{collapsed ? "left_panel_open" : "left_panel_close"}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleCreate()}
          className={`topic-console-primary ${collapsed ? "topic-console-primary-collapsed" : ""}`}
          title="新建任务"
        >
          <span className="material-symbols-outlined">add</span>
          {!collapsed ? <span>New Research Task</span> : null}
        </button>

        {!collapsed ? (
          <label className="topic-console-search" aria-label="搜索历史会话">
            <span className="material-symbols-outlined topic-console-search-icon">search</span>
            <input
              type="text"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索历史会话"
            />
          </label>
        ) : null}
      </div>

      <div className={`topic-console-scroll-region ${collapsed ? "topic-console-scroll-region-collapsed" : ""}`}>
        {!collapsed ? (
          <>
            <div className="topic-console-nav">
              <div className="topic-console-nav-item active" title="Task History">
                <span className="material-symbols-outlined">history</span>
                <span>Task History</span>
              </div>
            </div>

            <div className="topic-console-history" role="list">
              {loading ? <div className="topic-console-empty">Loading history...</div> : null}
              {!loading && orderedTopics.length === 0 ? (
                <div className="topic-console-empty">
                  {normalizedSearch ? "No matching history." : "No task history yet."}
                </div>
              ) : null}
              {!loading && orderedTopics.map((topic) => {
                const active = topic.topicId === currentTopicId;
                return (
                  <button
                    key={topic.topicId}
                    type="button"
                    onClick={() => onSelect(topic.topicId)}
                    className={`topic-console-history-item ${active ? "active" : ""}`}
                    title={getTopicDisplayTitle(topic)}
                  >
                    <div className="topic-console-history-title">{getTopicDisplayTitle(topic)}</div>
                    <div className="topic-console-history-time">
                      {topic.updatedAt ? new Date(topic.updatedAt).toLocaleString() : "Recently updated"}
                    </div>
                  </button>
                );
              })}
              {!loading && error ? <div className="topic-console-error">{error}</div> : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="topic-console-footer">
        {!collapsed ? (
          <div className="topic-console-account-card">
            <div className="topic-console-account">
              <div className="topic-console-avatar">{(user?.username ?? "G").slice(0, 1).toUpperCase()}</div>
              <div className="topic-console-account-copy">
                <div className="topic-console-account-name">{user?.username ?? "Guest"}</div>
                <div className="topic-console-role">{user?.role ?? "user"}</div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="topic-console-account-logout"
                title="退出登录"
              >
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className="topic-console-footer-item"
            title="退出登录"
            aria-label="退出登录"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        )}
      </div>
    </div>
  );
};
