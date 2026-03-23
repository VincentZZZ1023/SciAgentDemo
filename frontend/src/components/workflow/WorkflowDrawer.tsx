import type { ReactNode } from "react";
import { DrawerTabHeader, type DrawerTab } from "./DrawerTabHeader";
import { APP_COPY } from "../../lib/copy";

interface WorkflowDrawerProps {
  open: boolean;
  activeTab: DrawerTab;
  onSelectTab: (tab: DrawerTab) => void;
  onClose: () => void;
  children: ReactNode;
}

export const WorkflowDrawer = ({
  open,
  activeTab,
  onSelectTab,
  onClose,
  children,
}: WorkflowDrawerProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="workflow-drawer-overlay" role="presentation">
      <button
        type="button"
        className="workflow-drawer-backdrop"
        aria-label={APP_COPY.drawer.closeAria}
        onClick={onClose}
      />

      <aside
        className="workflow-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={APP_COPY.drawer.dialogAria}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="workflow-drawer-header">
          <div>
            <h3>{APP_COPY.drawer.title}</h3>
            <p className="muted">{APP_COPY.drawer.subtitle}</p>
          </div>
          <button type="button" onClick={onClose}>
            {APP_COPY.common.close}
          </button>
        </header>

        <DrawerTabHeader activeTab={activeTab} onSelectTab={onSelectTab} />
        <div className="workflow-drawer-body">{children}</div>
      </aside>
    </div>
  );
};
