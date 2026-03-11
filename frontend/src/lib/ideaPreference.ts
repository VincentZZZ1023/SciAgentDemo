export const IDEA_TASTE_MODES = [
  "moonshot_inventor",
  "bridge_builder",
  "steady_engineer",
  "ambitious_realist",
  "evidence_first",
] as const;

export type IdeaTasteMode = (typeof IDEA_TASTE_MODES)[number];

export interface IdeaTasteOption {
  value: IdeaTasteMode;
  label: string;
  englishLabel: string;
  summary: string;
}

export const DEFAULT_IDEA_TASTE_MODE: IdeaTasteMode = "evidence_first";

export const IDEA_TASTE_OPTIONS: IdeaTasteOption[] = [
  {
    value: "moonshot_inventor",
    label: "登月型创新",
    englishLabel: "moonshot_inventor",
    summary: "优先寻找高跃迁、突破式的新方向。",
  },
  {
    value: "bridge_builder",
    label: "跨域桥接",
    englishLabel: "bridge_builder",
    summary: "优先连接不同领域的方法、数据和问题。",
  },
  {
    value: "steady_engineer",
    label: "稳健工程",
    englishLabel: "steady_engineer",
    summary: "偏好可落地、低风险、工程化推进的方案。",
  },
  {
    value: "ambitious_realist",
    label: "进取务实",
    englishLabel: "ambitious_realist",
    summary: "目标更高，但保持约束清晰和实施节奏。",
  },
  {
    value: "evidence_first",
    label: "证据优先",
    englishLabel: "evidence_first",
    summary: "先收拢证据与可验证线索，再扩展创意。",
  },
];

export const isIdeaTasteMode = (value: unknown): value is IdeaTasteMode => {
  return typeof value === "string" && IDEA_TASTE_MODES.includes(value as IdeaTasteMode);
};

export const getIdeaTasteMode = (value: unknown): IdeaTasteMode => {
  return isIdeaTasteMode(value) ? value : DEFAULT_IDEA_TASTE_MODE;
};
