import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTopic, getDefaultRunConfig, getRun, getTopics, startRun } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ScholarSidebar, type SidebarRunHistoryItem } from "../components/sidebar/ScholarSidebar";
import { ScholarSearchBox, type ScholarMode } from "../components/search/ScholarSearchBox";
import { RunConfigBar, RUN_MODEL_OPTIONS } from "../components/run/RunConfigBar";
import { DEFAULT_IDEA_TASTE_MODE, type IdeaTasteMode } from "../lib/ideaPreference";
import { cloneRunConfig, getRunConfigIdeaTasteMode, runConfigToMode, sanitizeRunConfig } from "../lib/runConfig";
import type { AgentId, RunConfig, RunDetail, TopicSummary } from "../types/events";

type LauncherAgent = "review" | "idea" | "experiment";
const LAST_SELECTED_RUN_KEY = "sciagent_last_selected_run";

const FRONTEND_FALLBACK_CONFIG: RunConfig = {
  thinkingMode: "quick",
  online: true,
  presetName: "frontend-fallback",
  selectedAgents: ["review", "ideation", "experiment"],
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
      idea_taste_mode: DEFAULT_IDEA_TASTE_MODE,
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
  const { user, logout, switchAccount } = useAuth();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [thinkingMode, setThinkingMode] = useState<ScholarMode>("quick");
  const [ideaTasteMode, setIdeaTasteMode] = useState<IdeaTasteMode>(DEFAULT_IDEA_TASTE_MODE);
  const [selectedAgents, setSelectedAgents] = useState<LauncherAgent[]>(["review"]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [defaultConfig, setDefaultConfig] = useState<RunConfig | null>(null);
  const [runConfigDraft, setRunConfigDraft] = useState<RunConfig | null>(null);
  const [historyItems, setHistoryItems] = useState<SidebarRunHistoryItem[]>([]);
  const [activeHistoryKey, setActiveHistoryKey] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.sessionStorage.getItem(LAST_SELECTED_RUN_KEY);
  });

  const toRunStatusBadge = (status: string | undefined): SidebarRunHistoryItem["status"] => {
    if (status === "paused") {
      return "paused";
    }
    if (status === "queued" || status === "running") {
      return "running";
    }
    return "done";
  };

  const formatUpdatedAtLabel = (updatedAt: number): string => {
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return "Updated recently";
    }
    return new Date(updatedAt).toLocaleString();
  };

  const buildHistorySummary = (topic: TopicSummary, run: RunDetail | null): string => {
    const runLabel = run?.runId ? `run ${run.runId.slice(-8)}` : "topic workspace";
    const moduleLabel = run?.currentModule ? ` | ${run.currentModule}` : "";
    return `${runLabel}${moduleLabel}`;
  };

  const buildRunHref = (item: { topicId: string; runId?: string | null }): string => {
    const params = new URLSearchParams();
    params.set("view", "classic");
    if (item.runId) {
      params.set("runId", item.runId);
    }
    const nextQuery = params.toString();
    return nextQuery ? `/app/${encodeURIComponent(item.topicId)}?${nextQuery}` : `/app/${encodeURIComponent(item.topicId)}`;
  };

  const buildHistoryKey = (item: { topicId: string; runId?: string | null }): string => `${item.topicId}:${item.runId ?? "topic"}`;

  const rememberHistorySelection = (item: { topicId: string; runId?: string | null }) => {
    const nextKey = buildHistoryKey(item);
    setActiveHistoryKey(nextKey);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LAST_SELECTED_RUN_KEY, nextKey);
    }
  };

  const launcherAgentToModule = (agent: LauncherAgent): AgentId => {
    if (agent === "idea") {
      return "ideation";
    }
    return agent;
  };

  const applyLauncherStateToConfig = (
    config: RunConfig,
    agents: LauncherAgent[],
    nextThinkingMode: ScholarMode,
    nextIdeaTasteMode: IdeaTasteMode,
  ): RunConfig => {
    const next = cloneRunConfig(config);
    const selectedModules = new Set(agents.map((agent) => launcherAgentToModule(agent)));
    const orderedSelectedModules = (["review", "ideation", "experiment"] as AgentId[]).filter((agentId) =>
      selectedModules.has(agentId),
    );

    next.thinkingMode = nextThinkingMode;
    next.selectedAgents = orderedSelectedModules;
    next.modules.review.enabled = selectedModules.has("review");
    next.modules.ideation.enabled = selectedModules.has("ideation");
    next.modules.experiment.enabled = selectedModules.has("experiment");
    delete next.modules.review.idea_taste_mode;
    delete next.modules.experiment.idea_taste_mode;

    if (selectedModules.has("ideation")) {
      next.modules.ideation.idea_taste_mode = nextIdeaTasteMode;
    } else {
      delete next.modules.ideation.idea_taste_mode;
    }

    return next;
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setLoadingConfig(true);
      try {
        const config = await getDefaultRunConfig();
        if (!cancelled) {
          setDefaultConfig(cloneRunConfig(config));
          setRunConfigDraft(cloneRunConfig(config));
          setThinkingMode(runConfigToMode(config));
          setIdeaTasteMode(getRunConfigIdeaTasteMode(config));
        }
      } catch {
        if (!cancelled) {
          setDefaultConfig(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setRunConfigDraft(cloneRunConfig(FRONTEND_FALLBACK_CONFIG));
          setThinkingMode(runConfigToMode(FRONTEND_FALLBACK_CONFIG));
          setIdeaTasteMode(getRunConfigIdeaTasteMode(FRONTEND_FALLBACK_CONFIG));
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

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const topics = await getTopics();
        const orderedTopics = [...topics]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 20);

        const runDetails = await Promise.all(
          orderedTopics.map(async (topic) => {
            if (!topic.lastRunId) {
              return null;
            }
            try {
              return await getRun(topic.lastRunId);
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const nextHistory = orderedTopics.map((topic, index) => {
          const runDetail = runDetails[index];
          return {
            topicId: topic.topicId,
            runId: runDetail?.runId ?? topic.lastRunId ?? null,
            title: topic.title || topic.topicId,
            summary: buildHistorySummary(topic, runDetail),
            status: toRunStatusBadge(runDetail?.status ?? topic.status),
            updatedAtLabel: formatUpdatedAtLabel(topic.updatedAt),
          } satisfies SidebarRunHistoryItem;
        });

        setHistoryItems(nextHistory);
      } catch {
        if (!cancelled) {
          setHistoryItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  const focusInput = () => {
    inputRef.current?.focus();
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

  const primarySelectedAgent = selectedAgents[0] ?? "review";
  const selectedModules = useMemo(
    () => selectedAgents.map((agent) => launcherAgentToModule(agent)),
    [selectedAgents],
  );

  const activeRunConfig = useMemo(() => {
    if (!runConfigDraft) {
      return applyLauncherStateToConfig(
        FRONTEND_FALLBACK_CONFIG,
        selectedAgents,
        thinkingMode,
        ideaTasteMode,
      );
    }
    return applyLauncherStateToConfig(runConfigDraft, selectedAgents, thinkingMode, ideaTasteMode);
  }, [ideaTasteMode, runConfigDraft, selectedAgents, thinkingMode]);

  const canSubmit = query.trim().length > 0 && selectedAgents.length > 0;

  const handleModeChange = (nextMode: ScholarMode) => {
    setThinkingMode(nextMode);
  };

  const handleConfigChange = (nextConfig: RunConfig) => {
    setRunConfigDraft(cloneRunConfig(nextConfig));
    setThinkingMode(runConfigToMode(nextConfig));
    setIdeaTasteMode(getRunConfigIdeaTasteMode(nextConfig));
  };

  const handleResetConfig = () => {
    const base = defaultConfig ? cloneRunConfig(defaultConfig) : cloneRunConfig(FRONTEND_FALLBACK_CONFIG);
    const next = runConfigDraft ? cloneRunConfig(runConfigDraft) : cloneRunConfig(base);

    next.online = base.online;
    selectedModules.forEach((moduleId) => {
      next.modules[moduleId] = cloneRunConfig(base).modules[moduleId];
    });

    setRunConfigDraft(next);
    setIdeaTasteMode(getRunConfigIdeaTasteMode(next));
  };

  const toggleAgent = (agent: LauncherAgent) => {
    const agentOrder: LauncherAgent[] = ["review", "idea", "experiment"];

    setSelectedAgents((current) => {
      const next = current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent];
      return [...next].sort((left, right) => agentOrder.indexOf(left) - agentOrder.indexOf(right));
    });
    setError("");
  };

  const agentChips = [
    {
      key: "review" as const,
      label: "review",
      active: selectedAgents.includes("review"),
    },
    {
      key: "idea" as const,
      label: "idea",
      active: selectedAgents.includes("idea"),
    },
    {
      key: "experiment" as const,
      label: "experiment",
      active: selectedAgents.includes("experiment"),
    },
  ];

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Please enter a SciAgent task.");
      focusInput();
      return;
    }
    if (selectedAgents.length === 0) {
      setError("Select at least one agent.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const topic = await createTopic(toTopicName(trimmed), trimmed);
      const selectedAgentsPayload = [...selectedAgents];
      const submitConfig = sanitizeRunConfig(activeRunConfig);
      const run = await startRun(topic.topicId, { prompt: trimmed, config: submitConfig });
      rememberHistorySelection({ topicId: topic.topicId, runId: run.runId });

      const params = new URLSearchParams();
      params.set("runId", run.runId);
      params.set("mode", thinkingMode);
      params.set("view", "classic");
      params.set("agents", selectedAgentsPayload.join(","));

      navigate(`/app/${encodeURIComponent(topic.topicId)}?${params.toString()}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRuns = () => {
    const latest = historyItems[0];
    if (latest) {
      rememberHistorySelection(latest);
      navigate(buildRunHref(latest));
      return;
    }
    navigate("/app");
  };

  const handleSelectHistoryItem = (item: SidebarRunHistoryItem) => {
    rememberHistorySelection(item);
    navigate(buildRunHref(item));
  };

  useEffect(() => {
    if (!configExpanded) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfigExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [configExpanded]);

  return (
    <section className="scholar-home-page">
      <ScholarSidebar
        user={user}
        historyItems={historyItems}
        loadingHistory={loadingHistory}
        activeHistoryKey={activeHistoryKey}
        onOpenRuns={handleOpenRuns}
        onSelectHistoryItem={handleSelectHistoryItem}
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
          <h1>Start a SciAgent run for review, ideation, and experiment planning.</h1>
          <p className="scholar-hero-note">
            Draft the task once, choose the agents you want, and launch a new workflow from here.
          </p>
          <ScholarSearchBox
            query={query}
            mode={thinkingMode}
            ideaTasteMode={ideaTasteMode}
            ideaPreferenceEnabled={selectedAgents.includes("idea")}
            configExpanded={configExpanded}
            agentChips={agentChips}
            onQueryChange={setQuery}
            onModeChange={handleModeChange}
            onIdeaTasteModeChange={setIdeaTasteMode}
            onAgentSelect={toggleAgent}
            onToggleConfig={() => setConfigExpanded((current) => !current)}
            onSubmit={() => void handleSearch()}
            submitting={submitting}
            canSubmit={canSubmit}
            inputRef={inputRef}
          />
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </main>
      {configExpanded ? (
        <div className="scholar-config-flyout-shell" role="presentation">
          <button
            type="button"
            className="scholar-config-flyout-backdrop"
            aria-label="Close run config"
            onClick={() => setConfigExpanded(false)}
          />
          <aside className="scholar-config-flyout" aria-label="Run config panel">
            <div className="scholar-config-flyout-header">
              <div>
                <h2>Run Config</h2>
                <p>
                  {selectedAgents.length === 1
                    ? `Editing ${primarySelectedAgent === "idea" ? "idea" : primarySelectedAgent} settings for this run.`
                    : `Editing ${selectedAgents.length} selected agents. Only the selected agents will be enabled at launch.`}
                </p>
              </div>
              <button
                type="button"
                className="scholar-config-flyout-close"
                onClick={() => setConfigExpanded(false)}
              >
                Close
              </button>
            </div>
            <div className="scholar-config-flyout-body">
              {selectedModules.length === 0 ? (
                <section className="run-config-bar muted">Select at least one agent to edit its launch config.</section>
              ) : (
                <RunConfigBar
                  config={activeRunConfig}
                  loading={loadingConfig}
                  onChange={handleConfigChange}
                  onReset={handleResetConfig}
                  showIdeaPreference
                  ideaPreferenceEnabled={selectedAgents.includes("idea")}
                  ideaTasteMode={ideaTasteMode}
                  ideaPreferenceHint={selectedAgents.includes("idea") ? "作用于 Idea agent" : "仅对 Idea 生效"}
                  onIdeaTasteModeChange={setIdeaTasteMode}
                  lockModuleEnabled
                  currentAgent={launcherAgentToModule(primarySelectedAgent)}
                  currentAgentLabel={
                    primarySelectedAgent === "idea"
                      ? "Idea"
                      : primarySelectedAgent.charAt(0).toUpperCase() + primarySelectedAgent.slice(1)
                  }
                  singleAgentMode={selectedModules.length === 1}
                  visibleAgents={selectedModules}
                />
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
};
