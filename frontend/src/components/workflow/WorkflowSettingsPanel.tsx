import { useEffect, useMemo, useState } from "react";
import { RUN_MODEL_OPTIONS } from "../run/RunConfigBar";
import { applyModePreset, cloneRunConfig, runConfigToMode, sanitizeRunConfig, type RunMode } from "../../lib/runConfig";
import { AGENT_IDS, type AgentId, type ModuleConfig, type RunConfig } from "../../types/events";
import {
  APP_COPY,
  formatAgentLabel,
  formatModeHint,
  formatModeLabel,
  formatOnOffLabel,
} from "../../lib/copy";

interface WorkflowSettingsPanelProps {
  config: RunConfig | null;
  defaultConfig: RunConfig | null;
  loading: boolean;
  applying: boolean;
  error: string;
  onApplyAndRun: (draftConfig: RunConfig) => Promise<boolean>;
  onDraftChange?: (draftConfig: RunConfig) => void;
}

const formatBoolean = (value: boolean): string => {
  return formatOnOffLabel(value);
};

const getBaseConfig = (config: RunConfig | null, defaultConfig: RunConfig | null): RunConfig | null => {
  if (config) {
    return sanitizeRunConfig(config);
  }
  if (defaultConfig) {
    return sanitizeRunConfig(defaultConfig);
  }
  return null;
};

export const WorkflowSettingsPanel = ({
  config,
  defaultConfig,
  loading,
  applying,
  error,
  onApplyAndRun,
  onDraftChange,
}: WorkflowSettingsPanelProps) => {
  const [editing, setEditing] = useState(false);
  const [draftConfig, setDraftConfig] = useState<RunConfig | null>(null);
  const [mode, setMode] = useState<RunMode>("deep");

  const effectiveConfig = useMemo(() => {
    return getBaseConfig(config, defaultConfig);
  }, [config, defaultConfig]);

  useEffect(() => {
    if (!effectiveConfig) {
      return;
    }
    if (!editing) {
      setDraftConfig(cloneRunConfig(effectiveConfig));
      setMode(runConfigToMode(effectiveConfig));
    }
  }, [effectiveConfig, editing]);

  const updateDraft = (updater: (current: RunConfig) => RunConfig) => {
    setDraftConfig((current) => {
      const base = current ? cloneRunConfig(current) : (effectiveConfig ? cloneRunConfig(effectiveConfig) : null);
      if (!base) {
        return current;
      }
      const next = sanitizeRunConfig(updater(base));
      onDraftChange?.(next);
      setMode(runConfigToMode(next));
      return next;
    });
  };

  const handleModeChange = (nextMode: RunMode) => {
    setMode(nextMode);
    updateDraft((current) => applyModePreset(current, nextMode));
  };

  const handleReset = () => {
    const base = getBaseConfig(defaultConfig, defaultConfig) ?? getBaseConfig(config, defaultConfig);
    if (!base) {
      return;
    }
    const next = cloneRunConfig(base);
    setDraftConfig(next);
    setMode(runConfigToMode(next));
    onDraftChange?.(next);
  };

  const updateModule = (agentId: AgentId, patch: Partial<ModuleConfig>) => {
    updateDraft((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [agentId]: {
          ...current.modules[agentId],
          ...patch,
        },
      },
    }));
  };

  const handleApply = async () => {
    if (!draftConfig) {
      return;
    }
    const ok = await onApplyAndRun(sanitizeRunConfig(draftConfig));
    if (ok) {
      setEditing(false);
    }
  };

  if (loading && !effectiveConfig) {
    return (
      <section className="workflow-settings-panel">
        <h4>{APP_COPY.workflowSettings.title}</h4>
        <p className="muted">{APP_COPY.workflowSettings.loading}</p>
      </section>
    );
  }

  if (!effectiveConfig) {
    return (
      <section className="workflow-settings-panel">
        <h4>{APP_COPY.workflowSettings.title}</h4>
        <p className="muted">{APP_COPY.workflowSettings.usingDefault}</p>
      </section>
    );
  }

  const displayConfig = draftConfig ?? effectiveConfig;

  if (editing) {
    return (
      <section className="run-config-bar workflow-settings-panel">
        <div className="run-config-head">
          <h3>{APP_COPY.workflowSettings.title}</h3>
          <span className="workflow-settings-tag">{APP_COPY.workflowSettings.editMode}</span>
        </div>

        <div className="workflow-settings-mode-toggle">
          <button
            type="button"
            className={mode === "quick" ? "active" : ""}
            onClick={() => handleModeChange("quick")}
            disabled={applying}
            title={formatModeHint("quick")}
          >
            {formatModeLabel("quick")}
          </button>
          <button
            type="button"
            className={mode === "deep" ? "active" : ""}
            onClick={() => handleModeChange("deep")}
            disabled={applying}
            title={formatModeHint("deep")}
          >
            {formatModeLabel("deep")}
          </button>
          <button
            type="button"
            className={mode === "pro" ? "active" : ""}
            onClick={() => handleModeChange("pro")}
            disabled={applying}
            title={formatModeHint("pro")}
          >
            {formatModeLabel("pro")}
          </button>
        </div>

        <div className="run-config-top-row">
          <div className="run-config-pill-group">
            <label className="run-config-pill">
              {APP_COPY.workflowSettings.thinkingMode}
              <select
                value={displayConfig.thinkingMode}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    thinkingMode:
                      event.target.value === "deep" || event.target.value === "pro"
                        ? event.target.value
                        : "quick",
                  }))
                }
                disabled={applying}
              >
                <option value="quick">quick</option>
                <option value="deep">deep</option>
                <option value="pro">pro</option>
              </select>
            </label>
            <label className="run-config-toggle">
              <input
                type="checkbox"
                checked={displayConfig.online}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    online: event.target.checked,
                  }))
                }
                disabled={applying}
              />
              <span>{APP_COPY.workflowSettings.network}</span>
            </label>
          </div>
          <button type="button" className="run-config-reset" onClick={handleReset} disabled={applying}>
            {APP_COPY.workflowSettings.restoreDefault}
          </button>
        </div>

        <div className="run-config-modules">
          {AGENT_IDS.map((agentId) => {
            const moduleConfig = displayConfig.modules[agentId];
            return (
              <article key={agentId} className="run-config-module-card">
                <header>
                  <h4>{formatAgentLabel(agentId)}</h4>
                  <label className="run-config-toggle">
                    <input
                      type="checkbox"
                      checked={moduleConfig.enabled}
                      onChange={(event) => updateModule(agentId, { enabled: event.target.checked })}
                      disabled={applying}
                    />
                    <span>{APP_COPY.workflowSettings.enabled}</span>
                  </label>
                </header>

                <label>
                  {APP_COPY.workflowSettings.model}
                  <select
                    value={moduleConfig.model}
                    onChange={(event) => updateModule(agentId, { model: event.target.value })}
                    disabled={applying}
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
                    onChange={(event) => updateModule(agentId, { requireHuman: event.target.checked })}
                    disabled={applying}
                  />
                  <span>{APP_COPY.workflowSettings.requireHuman}</span>
                </label>
              </article>
            );
          })}
        </div>

        <div className="workflow-settings-actions">
          <button type="button" onClick={() => setEditing(false)} disabled={applying}>
            {APP_COPY.workflowSettings.cancel}
          </button>
          <button type="button" className="run-button" onClick={() => void handleApply()} disabled={applying}>
            {applying ? APP_COPY.workflowSettings.applying : APP_COPY.workflowSettings.applyAndRun}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="workflow-settings-panel">
      <div className="workflow-settings-header">
        <h4>{APP_COPY.workflowSettings.title}</h4>
        <span className="workflow-settings-tag">{APP_COPY.workflowSettings.readOnly}</span>
      </div>

      <div className="workflow-settings-grid">
        <article className="workflow-settings-item">
          <span className="muted">{APP_COPY.workflowSettings.thinkingMode}</span>
          <strong>{displayConfig.thinkingMode}</strong>
        </article>
        <article className="workflow-settings-item">
          <span className="muted">{APP_COPY.workflowSettings.mode}</span>
          <strong>{runConfigToMode(displayConfig)}</strong>
        </article>
        <article className="workflow-settings-item">
          <span className="muted">{APP_COPY.workflowSettings.network}</span>
          <strong>{formatBoolean(displayConfig.online)}</strong>
        </article>
        <article className="workflow-settings-item">
          <span className="muted">{APP_COPY.workflowSettings.preset}</span>
          <strong>{displayConfig.presetName || "default"}</strong>
        </article>
      </div>

      <div className="workflow-settings-modules">
        {AGENT_IDS.map((agentId) => {
          const moduleConfig = displayConfig.modules[agentId];
          if (!moduleConfig) {
            return null;
          }

          return (
            <article key={agentId} className="workflow-settings-module">
              <header>
                <h5>{formatAgentLabel(agentId)}</h5>
                <span className={`status-badge ${moduleConfig.enabled ? "status-running" : "status-idle"}`}>
                  {moduleConfig.enabled ? APP_COPY.workflowSettings.enabled : APP_COPY.workflowSettings.disabled}
                </span>
              </header>
              <p>
                <span className="muted">{APP_COPY.workflowSettings.model}:</span> {moduleConfig.model}
              </p>
              <p>
                <span className="muted">{APP_COPY.workflowSettings.requireHuman}:</span> {formatBoolean(moduleConfig.requireHuman)}
              </p>
            </article>
          );
        })}
      </div>

      <div className="workflow-settings-actions">
        <button type="button" onClick={() => setEditing(true)}>
          {APP_COPY.workflowSettings.edit}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
};
