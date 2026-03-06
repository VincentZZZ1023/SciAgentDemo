import { FormEvent, type RefObject } from "react";

export type ScholarMode = "quick" | "deep";

interface ScholarSearchBoxProps {
  query: string;
  mode: ScholarMode;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: ScholarMode) => void;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
}

export const ScholarSearchBox = ({
  query,
  mode,
  onQueryChange,
  onModeChange,
  onSubmit,
  submitting = false,
  disabled = false,
  inputRef,
}: ScholarSearchBoxProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="scholar-search-box" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="e.g., Summarize recent papers, propose ideas, and design experiments for AI4Science..."
        aria-label="SciAgent task input"
        disabled={disabled || submitting}
      />

      <div className="scholar-search-actions">
        <div className="scholar-mode-toggle" role="tablist" aria-label="Search mode">
          <button
            type="button"
            className={mode === "quick" ? "active" : ""}
            onClick={() => onModeChange("quick")}
            disabled={disabled || submitting}
          >
            <span className="scholar-mode-icon">Q</span>
            <span>Quick Mode</span>
          </button>

          <button
            type="button"
            className={mode === "deep" ? "active" : ""}
            onClick={() => onModeChange("deep")}
            disabled={disabled || submitting}
          >
            <span className="scholar-mode-icon">D</span>
            <span>Deep Mode</span>
            <span className="scholar-mode-info" title="Best for full review -> ideation -> experiment planning.">
              i
            </span>
          </button>
        </div>

        <button
          type="submit"
          className="scholar-search-submit"
          aria-label="Search"
          disabled={disabled || submitting}
        >
          {submitting ? "..." : "Go"}
        </button>
      </div>
    </form>
  );
};
