import { AGENT_IDS, type AgentId, type ModuleConfig, type RunConfig } from "../types/events";

export type RunMode = "quick" | "deep";

const DEFAULT_MODEL = "deepseek-chat";

const cloneModuleConfig = (module: ModuleConfig | undefined): ModuleConfig => {
  return {
    enabled: module?.enabled ?? true,
    model: (module?.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    requireHuman: module?.requireHuman ?? false,
  };
};

export const cloneRunConfig = (config: RunConfig): RunConfig => {
  return JSON.parse(JSON.stringify(config)) as RunConfig;
};

export const runConfigToMode = (config: RunConfig): RunMode => {
  return config.thinkingMode === "deep" ? "deep" : "quick";
};

export const applyModePreset = (input: RunConfig, mode: RunMode): RunConfig => {
  const next = sanitizeRunConfig(input);
  next.thinkingMode = mode === "deep" ? "deep" : "normal";

  if (mode === "quick") {
    next.modules.experiment.enabled = false;
    next.modules.experiment.requireHuman = false;
    return next;
  }

  for (const agentId of AGENT_IDS) {
    next.modules[agentId].enabled = true;
  }
  return next;
};

export const sanitizeRunConfig = (input: RunConfig): RunConfig => {
  const nextModules = {} as Record<AgentId, ModuleConfig>;
  for (const agentId of AGENT_IDS) {
    nextModules[agentId] = cloneModuleConfig(input.modules?.[agentId]);
  }

  return {
    thinkingMode: input.thinkingMode === "deep" ? "deep" : "normal",
    online: Boolean(input.online),
    presetName: (input.presetName || "default").trim() || "default",
    modules: nextModules,
  };
};
