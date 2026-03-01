import { AGENT_IDS, type AgentId, type RunConfig } from "../../types/events";

export const RUN_MODEL_OPTIONS = ["deepseek-chat", "deepseek-reasoner", "gpt-4.1"] as const;

interface RunConfigBarProps {
  config: RunConfig | null;
  loading: boolean;
  onChange: (next: RunConfig) => void;
  onReset: () => void;
}

const formatAgentLabel = (agentId: AgentId): string => {
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
};

export const RunConfigBar = ({ config, loading, onChange, onReset }: RunConfigBarProps) => {
  if (loading) {
    return <section className="run-config-bar muted">Loading default config...</section>;
  }

  if (!config) {
    return <section className="run-config-bar muted">Config unavailable</section>;
  }

  return (
    <section className="run-config-bar">
      <div className="run-config-head">
        <h3>Run Config</h3>
        <p className="muted">Toggle modules and model routing before launch.</p>
      </div>

      <div className="run-config-top-row">
        <div className="run-config-pill-group">
          <label className="run-config-pill">
            Thinking Mode
            <select
              value={config.thinkingMode}
              onChange={(event) =>
                onChange({
                  ...config,
                  thinkingMode: event.target.value === "deep" ? "deep" : "normal",
                })
              }
            >
              <option value="normal">normal</option>
              <option value="deep">deep</option>
            </select>
          </label>

          <label className="run-config-toggle">
            <input
              type="checkbox"
              checked={config.online}
              onChange={(event) => onChange({ ...config, online: event.target.checked })}
            />
            <span>Online</span>
          </label>
        </div>

        <button type="button" className="run-config-reset" onClick={onReset}>
          Restore Default
        </button>
      </div>

      <div className="run-config-modules">
        {AGENT_IDS.map((agentId) => {
          const moduleConfig = config.modules[agentId];
          return (
            <article key={agentId} className="run-config-module-card">
              <header>
                <h4>{formatAgentLabel(agentId)}</h4>
                <label className="run-config-toggle">
                  <input
                    type="checkbox"
                    checked={moduleConfig.enabled}
                    onChange={(event) =>
                      onChange({
                        ...config,
                        modules: {
                          ...config.modules,
                          [agentId]: {
                            ...moduleConfig,
                            enabled: event.target.checked,
                          },
                        },
                      })
                    }
                  />
                  <span>Enabled</span>
                </label>
              </header>

              <label>
                Model
                <select
                  value={moduleConfig.model}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      modules: {
                        ...config.modules,
                        [agentId]: {
                          ...moduleConfig,
                          model: event.target.value,
                        },
                      },
                    })
                  }
                >
                  {RUN_MODEL_OPTIONS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  {!RUN_MODEL_OPTIONS.includes(moduleConfig.model as (typeof RUN_MODEL_OPTIONS)[number]) ? (
                    <option value={moduleConfig.model}>{moduleConfig.model}</option>
                  ) : null}
                </select>
              </label>

              <label className="run-config-toggle">
                <input
                  type="checkbox"
                  checked={moduleConfig.requireHuman}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      modules: {
                        ...config.modules,
                        [agentId]: {
                          ...moduleConfig,
                          requireHuman: event.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>Require Human</span>
              </label>
            </article>
          );
        })}
      </div>
    </section>
  );
};
