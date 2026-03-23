import { IDEA_TASTE_OPTIONS, type IdeaTasteMode } from "../../lib/ideaPreference";
import { AGENT_IDS, type AgentId, type RunConfig } from "../../types/events";
import { APP_COPY, formatAgentLabel } from "../../lib/copy";

export const RUN_MODEL_OPTIONS = ["deepseek-chat", "deepseek-reasoner", "gpt-4.1"] as const;

interface RunConfigBarProps {
  config: RunConfig | null;
  loading: boolean;
  onChange: (next: RunConfig) => void;
  onReset: () => void;
  lockModuleEnabled?: boolean;
  currentAgent?: AgentId;
  currentAgentLabel?: string;
  singleAgentMode?: boolean;
  visibleAgents?: AgentId[];
  showIdeaPreference?: boolean;
  ideaPreferenceEnabled?: boolean;
  ideaTasteMode?: IdeaTasteMode;
  ideaPreferenceHint?: string;
  onIdeaTasteModeChange?: (value: IdeaTasteMode) => void;
}

export const RunConfigBar = ({
  config,
  loading,
  onChange,
  onReset,
  lockModuleEnabled = false,
  currentAgent,
  currentAgentLabel,
  singleAgentMode = false,
  visibleAgents,
  showIdeaPreference = false,
  ideaPreferenceEnabled = true,
  ideaTasteMode,
  ideaPreferenceHint = "仅对 idea 生效",
  onIdeaTasteModeChange,
}: RunConfigBarProps) => {
  if (loading) {
    return <section className="run-config-bar muted">{APP_COPY.runConfig.loadingDefault}</section>;
  }

  if (!config) {
    return <section className="run-config-bar muted">{APP_COPY.runConfig.unavailable}</section>;
  }

  const activeAgent = currentAgent ?? "review";
  const activeModuleConfig = config.modules[activeAgent];
  const agentTitle = currentAgentLabel ?? formatAgentLabel(activeAgent);
  const filteredAgents = visibleAgents?.length ? visibleAgents : AGENT_IDS;

  return (
    <section className="run-config-bar">
      <div className="run-config-head">
        <h3>{APP_COPY.runConfig.title}</h3>
        <p className="muted">
          {singleAgentMode
            ? APP_COPY.runConfig.singleAgentHint(agentTitle)
            : lockModuleEnabled
              ? APP_COPY.runConfig.lockedModulesHint
              : APP_COPY.runConfig.multiAgentHint}
        </p>
      </div>

      <div className="run-config-top-row">
        <div className="run-config-pill-group">
          <label className="run-config-toggle">
            <input
              type="checkbox"
              checked={config.online}
              onChange={(event) => onChange({ ...config, online: event.target.checked })}
            />
            <span>{APP_COPY.runConfig.online}</span>
          </label>
          {showIdeaPreference ? (
            <label className={`run-config-pill run-config-idea-preference ${ideaPreferenceEnabled ? "" : "disabled"}`}>
              <span>{APP_COPY.runConfig.ideaPreference}</span>
              <select
                value={ideaTasteMode ?? IDEA_TASTE_OPTIONS[0].value}
                onChange={(event) => onIdeaTasteModeChange?.(event.target.value as IdeaTasteMode)}
                disabled={!ideaPreferenceEnabled}
              >
                {IDEA_TASTE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`${option.label} | ${option.englishLabel} | ${option.summary}`}
                  </option>
                ))}
              </select>
              <small>{ideaPreferenceHint}</small>
            </label>
          ) : null}
        </div>

        <button type="button" className="run-config-reset" onClick={onReset}>
          {APP_COPY.runConfig.restoreDefault}
        </button>
      </div>

      {singleAgentMode ? (
        <article className="run-config-module-card run-config-focus-card">
          <header>
            <h4>{agentTitle}</h4>
            <label className="run-config-toggle">
              <input type="checkbox" checked={activeModuleConfig.enabled} disabled />
              <span>{APP_COPY.runConfig.enabled}</span>
            </label>
          </header>

          <div className="run-config-focus-fields">
            <label>
              {APP_COPY.runConfig.model}
              <select
                value={activeModuleConfig.model}
                onChange={(event) =>
                  onChange({
                    ...config,
                    modules: {
                      ...config.modules,
                      [activeAgent]: {
                        ...activeModuleConfig,
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
                {!RUN_MODEL_OPTIONS.includes(activeModuleConfig.model as (typeof RUN_MODEL_OPTIONS)[number]) ? (
                  <option value={activeModuleConfig.model}>{activeModuleConfig.model}</option>
                ) : null}
              </select>
            </label>

            <label className="run-config-toggle run-config-inline-toggle">
              <input
                type="checkbox"
                checked={config.online}
                onChange={(event) => onChange({ ...config, online: event.target.checked })}
              />
              <span>{APP_COPY.runConfig.online}</span>
            </label>

            <label className="run-config-toggle run-config-inline-toggle">
              <input
                type="checkbox"
                checked={activeModuleConfig.requireHuman}
                onChange={(event) =>
                  onChange({
                    ...config,
                    modules: {
                      ...config.modules,
                      [activeAgent]: {
                        ...activeModuleConfig,
                        requireHuman: event.target.checked,
                      },
                    },
                  })
                }
              />
              <span>{APP_COPY.runConfig.requireHuman}</span>
            </label>
          </div>
        </article>
      ) : (
        <div className="run-config-modules">
          {filteredAgents.map((agentId) => {
            const moduleConfig = config.modules[agentId];
            return (
              <article key={agentId} className="run-config-module-card">
                <header>
                  <h4>{formatAgentLabel(agentId)}</h4>
                  <label className="run-config-toggle">
                    <input
                      type="checkbox"
                      checked={moduleConfig.enabled}
                      disabled={lockModuleEnabled}
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
                    <span>{APP_COPY.runConfig.enabled}</span>
                  </label>
                </header>

                <label>
                  {APP_COPY.runConfig.model}
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
                  <span>{APP_COPY.runConfig.requireHuman}</span>
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
