import { useMemo, useState } from "react";
import type { AuthUser } from "../../auth/AuthContext";

export interface SidebarRunHistoryItem {
  topicId: string;
  runId?: string | null;
  title: string;
  summary: string;
  status: "running" | "paused" | "done";
  updatedAtLabel: string;
}

const toHistoryStatusClass = (status: SidebarRunHistoryItem["status"]): string => {
  if (status === "running") {
    return "status-running";
  }
  if (status === "paused") {
    return "status-paused";
  }
  return "status-succeeded";
};

interface ScholarSidebarProps {
  user: AuthUser | null;
  historyItems: SidebarRunHistoryItem[];
  loadingHistory?: boolean;
  activeHistoryKey?: string | null;
  onOpenRuns?: () => void;
  onSelectHistoryItem?: (item: SidebarRunHistoryItem) => void;
  onSwitchAccount?: () => void;
  onLogout?: () => void;
}

export const ScholarSidebar = ({
  user,
  historyItems,
  loadingHistory,
  activeHistoryKey,
  onOpenRuns,
  onSelectHistoryItem,
  onSwitchAccount,
  onLogout,
}: ScholarSidebarProps) => {
  const [searchValue, setSearchValue] = useState("");
  const displayName = user?.username ?? "guest";
  const role = user?.role ?? "user";
  const roleLabel = role === "admin" ? "Admin" : "User";
  const accountMonogram = displayName.trim().slice(0, 2).toUpperCase() || "SA";

  const filteredHistory = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();
    if (!keyword) {
      return historyItems;
    }
    return historyItems.filter(
      (item) =>
        item.title.toLowerCase().includes(keyword) ||
        item.summary.toLowerCase().includes(keyword),
    );
  }, [historyItems, searchValue]);

  return (
    <aside className="scholar-sidebar">
      <header className="scholar-sidebar-header">
        <div className="scholar-brand">
          <span className="scholar-brand-mark">SA</span>
          <span className="scholar-brand-copy">
            <span className="scholar-brand-title">SciAgentDemo</span>
            <span className="scholar-brand-subtitle">Research workflow studio</span>
          </span>
        </div>
      </header>

      <section className="scholar-sidebar-section">
        <div className="scholar-sidebar-section-head">
          <h2>Search</h2>
          <p>Find previous runs.</p>
        </div>
        <label className="scholar-nav-search">
          <span className="scholar-nav-search-icon">/</span>
          <input
            type="text"
            placeholder="Search run history"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </label>
      </section>

      <section className="scholar-sidebar-section">
        <div className="scholar-sidebar-section-head">
          <h2>Runs</h2>
          <p>Open the latest run workspace.</p>
        </div>
        <button type="button" className="scholar-new-search scholar-runs-entry" onClick={onOpenRuns}>
          <span>Open Runs</span>
          <span>-&gt;</span>
        </button>
      </section>

      <section className="scholar-sidebar-section scholar-history-panel">
        <div className="scholar-sidebar-section-head">
          <h2>Run history</h2>
          <p>Recent runs in a scrollable list.</p>
        </div>

        <div className="scholar-history-list" role="list" aria-label="Run history">
          {loadingHistory ? (
            <p className="muted">Loading recent runs...</p>
          ) : filteredHistory.length > 0 ? (
            filteredHistory.map((item) => (
              <button
                key={`${item.topicId}:${item.runId ?? "topic"}`}
                type="button"
                className={
                  activeHistoryKey === `${item.topicId}:${item.runId ?? "topic"}`
                    ? "scholar-history-card active"
                    : "scholar-history-card"
                }
                role="listitem"
                onClick={() => onSelectHistoryItem?.(item)}
              >
                <div className="scholar-history-card-head">
                  <strong>{item.title}</strong>
                  <span className={`status-badge ${toHistoryStatusClass(item.status)}`}>{item.status}</span>
                </div>
                <p>{item.summary}</p>
                <span className="scholar-history-updated">{item.updatedAtLabel}</span>
              </button>
            ))
          ) : (
            <div className="scholar-history-empty">
              <div className="scholar-history-icon">...</div>
              <div className="scholar-history-copy">
                <p className="scholar-history-title">No matching runs</p>
                <p className="scholar-history-hint">
                  Recent run history will appear here once runs are available.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="scholar-account-footer">
        <div className="scholar-sidebar-section-head scholar-user-head">
          <h2>User</h2>
          <p>Current workspace identity.</p>
        </div>
        <div className="scholar-account-card">
          <div className="scholar-account-avatar" aria-hidden="true">
            {accountMonogram}
          </div>
          <div className="scholar-account-content">
            <div className="scholar-account-meta">
              <div className="scholar-account-main">
                <strong className="scholar-account-name" title={displayName}>
                  {displayName}
                </strong>
                <small className="scholar-account-subtitle">Current workspace account</small>
              </div>
              <span className="scholar-account-role">{roleLabel}</span>
            </div>

            <div className="scholar-account-actions">
              <button type="button" className="scholar-auth-button" onClick={onSwitchAccount}>
                Switch account
              </button>
              <button type="button" className="scholar-auth-button primary" onClick={onLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </footer>
    </aside>
  );
};
