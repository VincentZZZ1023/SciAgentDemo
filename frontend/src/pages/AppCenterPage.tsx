import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTopic, getTopics } from "../api/client";

const APP_CARDS = [
  { id: "workflow", title: "Workflow", subtitle: "Multi-agent research loop", tag: "Ready", action: "open" },
  { id: "insights", title: "Insights", subtitle: "Research feed stream", tag: "Soon", action: "soon" },
  { id: "reader", title: "Paper Reader", subtitle: "Read and annotate literature", tag: "Soon", action: "soon" },
  { id: "experiment", title: "Experiment Lab", subtitle: "Evaluate and compare runs", tag: "Soon", action: "soon" },
] as const;

const toTopicName = (draft: string): string => {
  const trimmed = draft.trim();
  if (!trimmed) {
    return `Research Topic ${new Date().toLocaleDateString()}`;
  }
  return trimmed.slice(0, 42);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

export const AppCenterPage = () => {
  const navigate = useNavigate();
  const [draftPrompt, setDraftPrompt] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const quickHints = useMemo(
    () => [
      "Research an MVP architecture for a multi-agent science workflow",
      "Generate a review -> ideation -> experiment loop with measurable outcomes",
      "Evaluate this topic and propose a stronger experiment plan",
    ],
    [],
  );

  const openWorkflow = async (prompt: string) => {
    setOpening(true);
    setError("");

    try {
      const topics = await getTopics();
      let targetTopicId = topics[0]?.topicId;

      if (!targetTopicId) {
        const created = await createTopic(toTopicName(prompt), prompt.trim());
        targetTopicId = created.topicId;
      }

      const query = prompt.trim() ? `?draft=${encodeURIComponent(prompt.trim())}` : "";
      navigate(`/app/${targetTopicId}${query}`);
    } catch (openError) {
      setError(getErrorMessage(openError));
    } finally {
      setOpening(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await openWorkflow(draftPrompt);
  };

  const handleCardClick = async (action: "open" | "soon") => {
    if (action === "open") {
      await openWorkflow(draftPrompt);
      return;
    }
    setError("This module is reserved for next stage.");
  };

  return (
    <section className="app-center-page">
      <header className="app-center-header">
        <div className="app-center-brand">
          <span className="app-center-brand-mark">SC</span>
          <div>
            <h1>SciAgent App Center</h1>
            <p>Pick an app and start from one focused input.</p>
          </div>
        </div>
      </header>

      <form className="app-center-composer" onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="app-center-input">Input your research question...</label>
        <div className="app-center-composer-row">
          <input
            id="app-center-input"
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            placeholder="Input your research question..."
          />
          <button type="submit" className="run-button" disabled={opening}>
            {opening ? "Opening..." : "Open Workflow"}
          </button>
        </div>
        <div className="app-center-hints">
          {quickHints.map((hint) => (
            <button key={hint} type="button" onClick={() => setDraftPrompt(hint)}>
              {hint}
            </button>
          ))}
        </div>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="app-center-grid">
        {APP_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="app-center-card"
            onClick={() => void handleCardClick(card.action)}
          >
            <div className="app-center-card-head">
              <h3>{card.title}</h3>
              <span className={`app-center-card-tag tag-${card.tag.toLowerCase()}`}>{card.tag}</span>
            </div>
            <p>{card.subtitle}</p>
          </button>
        ))}
      </section>
    </section>
  );
};
