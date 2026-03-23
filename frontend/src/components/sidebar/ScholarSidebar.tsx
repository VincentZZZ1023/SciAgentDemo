import { useMemo, useState } from "react";
import type { AuthUser } from "../../auth/AuthContext";
import { BrandSymbol } from "../brand";

export interface SidebarRunHistoryItem {
  topicId: string;
  runId?: string | null;
  title: string;
  summary: string;
  status: "running" | "paused" | "done";
  updatedAtLabel: string;
}

interface ScholarSidebarProps {
  user: AuthUser | null;
  historyItems: SidebarRunHistoryItem[];
  loadingHistory?: boolean;
  activeRunId?: string | null;
  sessionMode?: "new" | "history";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNewChat?: () => void;
  onOpenRuns?: () => void;
  onSelectHistoryItem?: (item: SidebarRunHistoryItem) => void;
  onSwitchAccount?: () => void;
  onLogout?: () => void;
}

export const ScholarSidebar = ({
  user,
  historyItems,
  loadingHistory,
  activeRunId,
  collapsed = false,
  onToggleCollapsed,
  onNewChat,
  onOpenRuns,
  onSelectHistoryItem,
  onLogout,
}: ScholarSidebarProps) => {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearch = searchValue.trim().toLowerCase();

  const filteredHistoryItems = useMemo(() => {
    if (!normalizedSearch) {
      return historyItems;
    }

    return historyItems.filter((item) => {
      const haystack = `${item.title} ${item.summary} ${item.status} ${item.updatedAtLabel}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [historyItems, normalizedSearch]);

  return (
    <aside className={`scholar-sidebar hidden md:flex ${collapsed ? "scholar-sidebar-collapsed" : ""}`}>
      <div className={`scholar-sidebar-fixed-top ${collapsed ? "scholar-sidebar-fixed-top-collapsed" : ""}`}>
        <div className={`scholar-sidebar-header ${collapsed ? "scholar-sidebar-header-collapsed" : ""}`}>
          <div className="scholar-brand-mark" aria-hidden="true">
            <BrandSymbol size={collapsed ? 28 : 38} theme="light" />
          </div>
          {!collapsed ? (
            <div className="scholar-brand-copy">
              <p className="scholar-brand-subtitle">AI Research Platform</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="scholar-sidebar-collapse"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <span className="material-symbols-outlined">{collapsed ? "left_panel_open" : "left_panel_close"}</span>
          </button>
        </div>

        <nav className="scholar-sidebar-actions">
          <button
            type="button"
            onClick={onNewChat}
            className={`scholar-new-search ${collapsed ? "scholar-new-search-collapsed" : ""}`}
            title="新对话"
          >
            <span className="material-symbols-outlined">add_circle</span>
            {!collapsed ? <span>New Chat</span> : null}
          </button>
          <button
            type="button"
            onClick={onOpenRuns}
            className={`scholar-nav-link ${collapsed ? "scholar-nav-link-collapsed" : ""}`}
            title="运行页"
          >
            <span className="material-symbols-outlined scholar-nav-link-icon">sync</span>
            {!collapsed ? <span>Running Flows</span> : null}
          </button>
        </nav>

        {!collapsed ? (
          <label className="scholar-sidebar-search" aria-label="搜索历史会话">
            <span className="material-symbols-outlined scholar-sidebar-search-icon">search</span>
            <input
              type="text"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索历史会话"
            />
          </label>
        ) : null}
      </div>

      <div className={`scholar-sidebar-scroll-region ${collapsed ? "scholar-sidebar-scroll-region-collapsed" : ""}`}>
        {!collapsed ? (
          <>
            <div className="scholar-sidebar-section-head scholar-sidebar-history-head">
              <h2>Recent</h2>
            </div>
            <div className="scholar-history-list" role="list">
              {loadingHistory ? <div className="scholar-history-empty scholar-history-empty-compact">正在加载历史记录...</div> : null}
              {!loadingHistory && filteredHistoryItems.length === 0 ? (
                <div className="scholar-history-empty scholar-history-empty-compact">
                  {normalizedSearch ? "没有匹配的历史会话" : "发起对话后，这里会显示最近历史"}
                </div>
              ) : null}
              {!loadingHistory && filteredHistoryItems.map((item) => (
                <button
                  key={`${item.topicId}:${item.runId ?? "topic"}`}
                  type="button"
                  onClick={() => onSelectHistoryItem?.(item)}
                  className={`scholar-history-card ${activeRunId === item.runId ? "active" : ""}`}
                  title={item.title}
                >
                  <div className="scholar-history-card-title">{item.title}</div>
                  <div className="scholar-history-card-summary">{item.summary}</div>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className={`scholar-account-card ${collapsed ? "scholar-account-card-collapsed" : ""}`}>
        {!collapsed ? (
          <div className="scholar-account-shell">
            <div className="scholar-account-avatar">{(user?.username ?? "G").slice(0, 1).toUpperCase()}</div>
            <div className="scholar-account-meta">
              <div className="scholar-account-name">{user?.username ?? "Guest"}</div>
              <div className="scholar-account-role">{user?.role ?? "user"}</div>
            </div>
            <button type="button" onClick={onLogout} className="scholar-account-logout">
              退出登录
            </button>
          </div>
        ) : (
          <button type="button" onClick={onLogout} className="scholar-icon-footer" title="退出登录" aria-label="退出登录">
            <span className="material-symbols-outlined">logout</span>
          </button>
        )}
      </div>
    </aside>
  );
};
