import {
  getIdeaTasteMode,
  isIdeaTasteMode,
  type IdeaTasteMode,
} from "./ideaPreference";
import { AGENT_IDS, type AgentId, type ModuleConfig, type RunConfig } from "../types/events";

export type RunMode = "quick" | "deep" | "pro";

const DEFAULT_MODEL = "deepseek-chat";

const cloneModuleConfig = (module: ModuleConfig | undefined): ModuleConfig => {
  return {
    enabled: module?.enabled ?? true,
    model: (module?.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    requireHuman: module?.requireHuman ?? false,
    ...(isIdeaTasteMode(module?.idea_taste_mode) ? { idea_taste_mode: module.idea_taste_mode } : {}),
  };
};

const normalizeThinkingMode = (mode: RunConfig["thinkingMode"] | undefined): RunMode => {
  if (mode === "deep" || mode === "pro") {
    return mode;
  }
  return "quick";
};

const deriveSelectedAgents = (input: RunConfig): AgentId[] => {
  if (Array.isArray(input.selectedAgents) && input.selectedAgents.length > 0) {
    const uniqueAgents = new Set<AgentId>();
    return input.selectedAgents.filter((agentId): agentId is AgentId => {
      if (!AGENT_IDS.includes(agentId) || uniqueAgents.has(agentId)) {
        return false;
      }
      uniqueAgents.add(agentId);
      return true;
    });
  }

  return AGENT_IDS.filter((agentId) => input.modules?.[agentId]?.enabled);
};

export const cloneRunConfig = (config: RunConfig): RunConfig => {
  return JSON.parse(JSON.stringify(config)) as RunConfig;
};

export const runConfigToMode = (config: RunConfig): RunMode => {
  return normalizeThinkingMode(config.thinkingMode);
};

export const getRunConfigIdeaTasteMode = (config: RunConfig | null | undefined): IdeaTasteMode => {
  return getIdeaTasteMode(config?.modules?.ideation?.idea_taste_mode);
};

export const applyModePreset = (input: RunConfig, mode: RunMode): RunConfig => {
  const next = sanitizeRunConfig(input);
  next.thinkingMode = mode;

  if (mode === "quick") {
    next.modules.experiment.enabled = false;
    next.modules.experiment.requireHuman = false;
    next.selectedAgents = AGENT_IDS.filter((agentId) => next.modules[agentId].enabled);
    return next;
  }

  for (const agentId of AGENT_IDS) {
    next.modules[agentId].enabled = true;
  }
  next.selectedAgents = [...AGENT_IDS];
  return next;
};

export const sanitizeRunConfig = (input: RunConfig): RunConfig => {
  const nextModules = {} as Record<AgentId, ModuleConfig>;
  for (const agentId of AGENT_IDS) {
    nextModules[agentId] = cloneModuleConfig(input.modules?.[agentId]);
  }

  delete nextModules.review.idea_taste_mode;
  delete nextModules.experiment.idea_taste_mode;

  const nextThinkingMode = normalizeThinkingMode(input.thinkingMode);
  const nextSelectedAgents = deriveSelectedAgents({
    ...input,
    thinkingMode: nextThinkingMode,
    modules: nextModules,
  });
  const ideaEnabled = nextSelectedAgents.includes("ideation");

  if (ideaEnabled) {
    nextModules.ideation.idea_taste_mode = getIdeaTasteMode(nextModules.ideation.idea_taste_mode);
  } else {
    delete nextModules.ideation.idea_taste_mode;
  }

  return {
    thinkingMode: nextThinkingMode,
    online: Boolean(input.online),
    presetName: (input.presetName || "default").trim() || "default",
    selectedAgents: nextSelectedAgents,
    modules: nextModules,
  };
};
