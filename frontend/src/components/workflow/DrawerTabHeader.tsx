export type DrawerTab = "log" | "artifacts" | "context" | "cli";

interface DrawerTabHeaderProps {
  activeTab: DrawerTab;
  onSelectTab: (tab: DrawerTab) => void;
}

const TAB_ITEMS: Array<{ id: DrawerTab; label: string }> = [
  { id: "log", label: "Log" },
  { id: "artifacts", label: "Artifacts" },
  { id: "context", label: "Context" },
  { id: "cli", label: "CLI" },
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
