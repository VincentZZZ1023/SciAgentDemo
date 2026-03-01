import { FormEvent } from "react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled?: boolean;
  error?: string;
}

export const Composer = ({
  value,
  onChange,
  onSubmit,
  submitting,
  disabled = false,
  error,
}: ComposerProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className="composer-card">
      <form className="composer-form" onSubmit={handleSubmit}>
        <div className="composer-head">
          <label htmlFor="run-prompt" className="composer-title">
            Start A New Run
          </label>
          <p className="composer-subtitle">Describe target, constraints and expected output format.</p>
        </div>
        <textarea
          id="run-prompt"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Describe what you want the agents to research and deliver..."
          rows={4}
          disabled={disabled || submitting}
        />

        <div className="composer-actions">
          {error ? <p className="form-error">{error}</p> : <span className="muted">Prompt is required</span>}
          <button type="submit" className="run-button" disabled={disabled || submitting}>
            {submitting ? "Launching..." : "Run"}
          </button>
        </div>
      </form>
    </section>
  );
};
