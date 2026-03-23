import { FormEvent } from "react";
import { APP_COPY } from "../../lib/copy";

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
            {APP_COPY.composer.title}
          </label>
          <p className="composer-subtitle">{APP_COPY.composer.subtitle}</p>
        </div>
        <textarea
          id="run-prompt"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={APP_COPY.composer.placeholder}
          rows={4}
          disabled={disabled || submitting}
        />

        <div className="composer-actions">
          {error ? <p className="form-error">{error}</p> : <span className="muted">{APP_COPY.composer.promptRequired}</span>}
          <button type="submit" className="run-button" disabled={disabled || submitting}>
            {submitting ? APP_COPY.composer.launching : APP_COPY.common.run}
          </button>
        </div>
      </form>
    </section>
  );
};
