import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTopic, getDefaultRunConfig, startRun } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ScholarSidebar } from "../components/sidebar/ScholarSidebar";
import {
  ScholarExampleCards,
  type ScholarExampleItem,
} from "../components/search/ScholarExampleCards";
import { ScholarSearchBox, type ScholarMode } from "../components/search/ScholarSearchBox";
import { RunConfigBar, RUN_MODEL_OPTIONS } from "../components/run/RunConfigBar";
import { applyModePreset, cloneRunConfig, runConfigToMode, sanitizeRunConfig } from "../lib/runConfig";
import type { RunConfig } from "../types/events";

const EXAMPLE_ITEMS: ScholarExampleItem[] = [
  {
    id: "review-1",
    category: "Review",
    prompt:
      "Review recent AI4Science papers from the last 3 years and summarize open problems.",
  },
  {
    id: "idea-1",
    category: "Ideation",
    prompt:
      "Generate 5 experiment-ready research ideas from graph neural network literature.",
  },
  {
    id: "exp-1",
    category: "Experiment",
    prompt:
      "Design an experiment plan with metrics, baselines, and ablation strategy for the best idea.",
  },
];

const FRONTEND_FALLBACK_CONFIG: RunConfig = {
  thinkingMode: "deep",
  online: true,
  presetName: "frontend-fallback",
  modules: {
    review: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: false,
    },
    ideation: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: false,
    },
    experiment: {
      enabled: true,
      model: RUN_MODEL_OPTIONS[0],
      requireHuman: true,
    },
  },
};

export const ScholarSearchHome = () => {
  const navigate = useNavigate();
  const { user, isAdmin, logout, switchAccount } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ScholarMode>("deep");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [defaultConfig, setDefaultConfig] = useState<RunConfig | null>(null);
  const [runConfigDraft, setRunConfigDraft] = useState<RunConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoadingConfig(true);
      try {
        const config = await getDefaultRunConfig();
        if (!cancelled) {
          setDefaultConfig(config);
          setRunConfigDraft(cloneRunConfig(config));
          setMode(runConfigToMode(config));
        }
      } catch {
        if (!cancelled) {
          setDefaultConfig(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setRunConfigDraft(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setMode("deep");
        }
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const handleSidebarNavigate = (target: "home" | "topics" | "runs" | "admin" | "settings") => {
    if (target === "home") {
      navigate("/app-center");
      return;
    }

    if (target === "settings") {
      setConfigExpanded(true);
      focusInput();
      return;
    }

    if (target === "topics" || target === "runs") {
      navigate("/app");
      return;
    }

    if (target === "admin") {
      if (!isAdmin) {
        setError("Admin role is required.");
        return;
      }
      navigate("/admin");
      return;
    }

    navigate("/app");
  };

  const toTopicName = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "New Run";
    }
    return trimmed.slice(0, 64);
  };

  const getErrorMessage = (input: unknown): string => {
    if (input instanceof Error) {
      return input.message;
    }
    return "Failed to create run.";
  };

  const activeRunConfig = useMemo(() => {
    if (!runConfigDraft) {
      return cloneRunConfig(FRONTEND_FALLBACK_CONFIG);
    }
    return runConfigDraft;
  }, [runConfigDraft]);

  const handleModeChange = (nextMode: ScholarMode) => {
    setMode(nextMode);
    setRunConfigDraft((current) => {
      const base = current ? cloneRunConfig(current) : cloneRunConfig(FRONTEND_FALLBACK_CONFIG);
      return applyModePreset(base, nextMode);
    });
  };

  const handleConfigChange = (nextConfig: RunConfig) => {
    setRunConfigDraft(nextConfig);
    setMode(runConfigToMode(nextConfig));
  };

  const handleResetConfig = () => {
    const base = defaultConfig ? cloneRunConfig(defaultConfig) : cloneRunConfig(FRONTEND_FALLBACK_CONFIG);
    setRunConfigDraft(base);
    setMode(runConfigToMode(base));
  };

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Please enter a SciAgent task.");
      focusInput();
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const topic = await createTopic(toTopicName(trimmed), trimmed);
      const submitConfig = sanitizeRunConfig(applyModePreset(activeRunConfig, mode));
      const run = await startRun(topic.topicId, { prompt: trimmed, config: submitConfig });

      const params = new URLSearchParams();
      params.set("runId", run.runId);
      params.set("mode", mode);
      params.set("view", "classic");

      navigate(`/app/${encodeURIComponent(topic.topicId)}?${params.toString()}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="scholar-home-page">
      <ScholarSidebar
        user={user}
        isAdmin={isAdmin}
        onNewRun={focusInput}
        onNavigate={handleSidebarNavigate}
        onSwitchAccount={() => {
          switchAccount();
          navigate("/login", { replace: true });
        }}
        onLogout={() => {
          logout();
          navigate("/login", { replace: true });
        }}
      />

      <main className="scholar-home-main">
        <div className="scholar-hero">
          <h1>Hi . What should SciAgent review, ideate, and experiment today?</h1>
          <ScholarSearchBox
            query={query}
            mode={mode}
            onQueryChange={setQuery}
            onModeChange={handleModeChange}
            onSubmit={() => void handleSearch()}
            submitting={submitting}
            inputRef={inputRef}
          />
          <div className="scholar-config-toggle">
            <button
              type="button"
              onClick={() => setConfigExpanded((current) => !current)}
              disabled={submitting}
            >
              {configExpanded ? "Hide Run Config" : "Show Run Config"}
            </button>
          </div>
          {configExpanded ? (
            <RunConfigBar
              config={activeRunConfig}
              loading={loadingConfig}
              onChange={handleConfigChange}
              onReset={handleResetConfig}
            />
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <p className="scholar-hero-note">
            Start with one task. SciAgent will orchestrate review, idea generation, and experiment
            planning in sequence.
          </p>
        </div>

        <ScholarExampleCards
          items={EXAMPLE_ITEMS}
          onSelect={(item) => {
            setQuery(item.prompt);
            setError("");
            focusInput();
          }}
        />
      </main>
    </section>
  );
};
