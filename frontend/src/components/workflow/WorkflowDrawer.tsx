import type { ReactNode } from "react";
import { DrawerTabHeader, type DrawerTab } from "./DrawerTabHeader";

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
        aria-label="Close workflow drawer"
        onClick={onClose}
      />

      <aside
        className="workflow-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Workflow details"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="workflow-drawer-header">
          <div>
            <h3>Workflow Details</h3>
            <p className="muted">Log, artifacts, context, and CLI helpers</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <DrawerTabHeader activeTab={activeTab} onSelectTab={onSelectTab} />
        <div className="workflow-drawer-body">{children}</div>
      </aside>
    </div>
  );
};
