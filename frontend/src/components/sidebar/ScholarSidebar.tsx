import type { AuthUser } from "../../auth/AuthContext";

interface ScholarNavItem {
  label: string;
  target: "home" | "topics" | "runs" | "admin" | "settings";
  badge?: string;
}

const BASE_ITEMS: ScholarNavItem[] = [
  { label: "Home", target: "home" },
  { label: "Topics", target: "topics" },
  { label: "Runs", target: "runs" },
  { label: "Settings", target: "settings" },
];

interface ScholarSidebarProps {
  user: AuthUser | null;
  isAdmin: boolean;
  onNewRun?: () => void;
  onNavigate?: (target: "home" | "topics" | "runs" | "admin" | "settings") => void;
  onSwitchAccount?: () => void;
  onLogout?: () => void;
}

export const ScholarSidebar = ({
  user,
  isAdmin,
  onNewRun,
  onNavigate,
  onSwitchAccount,
  onLogout,
}: ScholarSidebarProps) => {
  const displayName = user?.username ?? "guest";
  const role = user?.role ?? "user";
  const roleLabel = role === "admin" ? "Admin" : "User";

  const items: ScholarNavItem[] = isAdmin
    ? [...BASE_ITEMS.slice(0, 3), { label: "Admin", target: "admin", badge: "Admin" }, BASE_ITEMS[3]]
    : BASE_ITEMS;

  return (
    <aside className="scholar-sidebar">
      <header className="scholar-sidebar-header">
        <div className="scholar-brand">
          <span className="scholar-brand-mark">SA</span>
          <span className="scholar-brand-text">SciAgentDemo</span>
        </div>
        <button type="button" className="scholar-collapse-button" aria-label="Collapse sidebar">
          []
        </button>
      </header>

      <button type="button" className="scholar-new-search" onClick={onNewRun}>
        <span>+ New Run</span>
        <span>-&gt;</span>
      </button>

      <label className="scholar-nav-search">
        <span className="scholar-nav-search-icon">/</span>
        <input type="text" placeholder="Search topics or runs" />
      </label>

      <nav className="scholar-nav-group">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className="scholar-nav-item"
            onClick={() => onNavigate?.(item.target)}
          >
            <span>{item.label}</span>
            {item.badge ? <span className="scholar-beta-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>

      <div className="scholar-history-empty">
        <div className="scholar-history-icon">...</div>
        <p>No run history</p>
      </div>

      <footer className="scholar-sidebar-footer scholar-account-footer">
        <div className="scholar-account-meta">
          <div className="scholar-account-main">
            <strong className="scholar-account-name" title={displayName}>
              {displayName}
            </strong>
            <small className="scholar-account-subtitle">Current workspace account</small>
          </div>
          <span className="scholar-account-role">{roleLabel}</span>
        </div>
        <button type="button" className="scholar-auth-button" onClick={onSwitchAccount}>
          Switch account
        </button>
        <button type="button" className="scholar-auth-button primary" onClick={onLogout}>
          Logout
        </button>
      </footer>
    </aside>
  );
};
