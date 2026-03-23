import { formatDrawerTabLabel } from "../../lib/copy";

export type DrawerTab = "log" | "artifacts" | "context";

interface DrawerTabHeaderProps {
  activeTab: DrawerTab;
  onSelectTab: (tab: DrawerTab) => void;
}

const TAB_ITEMS: Array<{ id: DrawerTab; label: string }> = [
  { id: "log", label: formatDrawerTabLabel("log") },
  { id: "artifacts", label: formatDrawerTabLabel("artifacts") },
  { id: "context", label: formatDrawerTabLabel("context") },
];

export const DrawerTabHeader = ({ activeTab, onSelectTab }: DrawerTabHeaderProps) => {
  return (
    <div className="workflow-drawer-tabs">
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={activeTab === item.id ? "active" : ""}
          onClick={() => onSelectTab(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
