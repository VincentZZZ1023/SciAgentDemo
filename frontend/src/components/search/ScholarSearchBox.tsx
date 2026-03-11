import { FormEvent, KeyboardEvent, type RefObject } from "react";
import { IDEA_TASTE_OPTIONS, type IdeaTasteMode } from "../../lib/ideaPreference";

export type ScholarMode = "quick" | "deep" | "pro";

interface ScholarAgentChip {
  key: "review" | "idea" | "experiment";
  label: string;
  active: boolean;
}

interface ScholarSearchBoxProps {
  query: string;
  mode: ScholarMode;
  ideaTasteMode: IdeaTasteMode;
  ideaPreferenceEnabled: boolean;
  configExpanded: boolean;
  agentChips: ScholarAgentChip[];
  onQueryChange: (value: string) => void;
  onModeChange: (mode: ScholarMode) => void;
  onIdeaTasteModeChange: (value: IdeaTasteMode) => void;
  onAgentSelect: (agent: ScholarAgentChip["key"]) => void;
  onToggleConfig: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  canSubmit?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement>;
}

export const ScholarSearchBox = ({
  query,
  mode,
  ideaTasteMode,
  ideaPreferenceEnabled,
  configExpanded,
  agentChips,
  onQueryChange,
  onModeChange,
  onIdeaTasteModeChange,
  onAgentSelect,
  onToggleConfig,
  onSubmit,
  submitting = false,
  disabled = false,
  canSubmit = true,
  inputRef,
}: ScholarSearchBoxProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || disabled || submitting) {
      return;
    }
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!canSubmit || disabled || submitting) {
        return;
      }
      onSubmit();
    }
  };

  return (
    <form className="scholar-search-box" onSubmit={handleSubmit}>
      <textarea
        ref={inputRef}
        rows={4}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe a research task. SciAgent will coordinate review, idea generation, and experiment planning."
        aria-label="SciAgent task input"
        disabled={disabled || submitting}
      />

      <div className="scholar-search-actions">
        <div className="scholar-search-top-controls">
          <div className="scholar-mode-toggle" role="tablist" aria-label="Run mode">
            <button
              type="button"
              className={mode === "quick" ? "active" : ""}
              onClick={() => onModeChange("quick")}
              disabled={disabled || submitting}
            >
              <span className="scholar-mode-icon">Q</span>
              <span>Quick</span>
            </button>

            <button
              type="button"
              className={mode === "deep" ? "active" : ""}
              onClick={() => onModeChange("deep")}
              disabled={disabled || submitting}
            >
              <span className="scholar-mode-icon">D</span>
              <span>Deep</span>
            </button>

            <button
              type="button"
              className={mode === "pro" ? "active" : ""}
              onClick={() => onModeChange("pro")}
              disabled={disabled || submitting}
            >
              <span className="scholar-mode-icon">P</span>
              <span>Pro</span>
            </button>
          </div>

          <label className={`scholar-idea-preference ${ideaPreferenceEnabled ? "" : "disabled"}`}>
            <span className="scholar-idea-preference-label">Idea Preference</span>
            <select
              value={ideaTasteMode}
              onChange={(event) => onIdeaTasteModeChange(event.target.value as IdeaTasteMode)}
              disabled={disabled || submitting || !ideaPreferenceEnabled}
            >
              {IDEA_TASTE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {`${option.label} | ${option.englishLabel} | ${option.summary}`}
                </option>
              ))}
            </select>
            <small>{ideaPreferenceEnabled ? "作用于 Idea agent" : "仅对 Idea 生效"}</small>
          </label>
        </div>

        <div className="scholar-launch-controls">
          <div className="scholar-agent-toggle" role="group" aria-label="Selected agents">
            {agentChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={chip.active ? "active" : ""}
                onClick={() => onAgentSelect(chip.key)}
                disabled={disabled || submitting}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className={configExpanded ? "active" : ""}
              onClick={onToggleConfig}
              disabled={disabled || submitting}
            >
              setting
            </button>
          </div>

          <button
            type="submit"
            className="scholar-search-submit"
            aria-label="Start run"
            disabled={disabled || submitting || !canSubmit}
          >
            {submitting ? "..." : "go"}
          </button>
        </div>
      </div>
    </form>
  );
};
