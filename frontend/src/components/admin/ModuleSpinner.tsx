interface ModuleSpinnerProps {
  moduleInFlight: Record<string, number>;
}

const MODULES = [
  { key: "review", label: "Review" },
  { key: "ideation", label: "Ideation" },
  { key: "experiment", label: "Experiment" },
] as const;

export const ModuleSpinner = ({ moduleInFlight }: ModuleSpinnerProps) => {
  const unknownCount = moduleInFlight.unknown ?? 0;

  return (
    <section className="admin-modules-panel">
      <header className="admin-panel-header">
        <h3>Module In-Flight</h3>
        <span>running by current_module</span>
      </header>
      <div className="admin-module-grid">
        {MODULES.map((module) => {
          const count = moduleInFlight[module.key] ?? 0;
          const active = count > 0;
          return (
            <article key={module.key} className={`admin-module-card ${active ? "active" : ""}`}>
              <div className={`admin-module-spinner ${active ? "spinning" : ""}`} />
              <div className="admin-module-meta">
                <strong>{module.label}</strong>
                <span>{count} running</span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="admin-module-unknown">
        <span>unknown module</span>
        <strong>{unknownCount}</strong>
      </div>
    </section>
  );
};

