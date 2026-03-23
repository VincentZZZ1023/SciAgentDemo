import { motion } from "framer-motion";
import { FormEvent, KeyboardEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { type IdeaTasteMode } from "../../lib/ideaPreference";

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
  placeholder?: string;
  embedded?: boolean;
  prominent?: boolean;
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

const MODE_OPTIONS: Array<{ key: ScholarMode; label: string; icon: string }> = [
  { key: "quick", label: "Quick", icon: "bolt" },
  { key: "deep", label: "Deep", icon: "neurology" },
  { key: "pro", label: "Pro", icon: "auto_awesome" },
];

const COMPOSER_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function ScholarSearchBox({
  query,
  mode,
  ideaPreferenceEnabled,
  placeholder = "给 xcientist 发送消息",
  prominent = false,
  configExpanded,
  agentChips,
  onQueryChange,
  onModeChange,
  onAgentSelect,
  onToggleConfig,
  onSubmit,
  submitting = false,
  disabled = false,
  canSubmit = true,
  inputRef,
}: ScholarSearchBoxProps) {
  const internalInputRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalInputRef;
  const hasValue = query.trim().length > 0;

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.style.height = "0px";
    const minHeight = prominent ? 52 : 48;
    const nextHeight = Math.min(Math.max(minHeight, node.scrollHeight), prominent ? 160 : 136);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > nextHeight ? "auto" : "hidden";
  }, [prominent, query, textareaRef]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasValue || !canSubmit || disabled || submitting) {
      return;
    }
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!hasValue || !canSubmit || disabled || submitting) {
        return;
      }
      onSubmit();
    }
  };

  return (
    <form className="mx-auto flex w-full max-w-[820px] flex-col items-center gap-3" onSubmit={handleSubmit}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, delay: 0.16, ease: COMPOSER_EASE }}
        className="flex flex-wrap items-center justify-center gap-3"
      >
        {MODE_OPTIONS.map((option) => {
          const active = option.key === mode;
          return (
            <motion.button
              key={option.key}
              type="button"
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.16, ease: COMPOSER_EASE }}
              onClick={() => onModeChange(option.key)}
              className={[
                "inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium transition-all duration-150",
                active
                  ? "bg-[#cfd5ff] text-[#1f39a7] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  : "bg-[#e8edf3] text-[#243447] hover:bg-[#dfe6ee]",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[18px]">{option.icon}</span>
              {option.label}
            </motion.button>
          );
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.24, ease: COMPOSER_EASE }}
        className="w-full rounded-[30px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all duration-150 focus-within:border-[#d8dee8] focus-within:shadow-[0_10px_28px_rgba(15,23,42,0.08)]"
      >
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || submitting}
          rows={1}
          className="w-full resize-none border-0 bg-transparent px-2 py-1 text-[16px] leading-7 text-[#111827] placeholder:text-[#9ca3af] focus:outline-none focus:ring-0"
        />

        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 px-1">
              {agentChips.map((chip) => (
                <motion.button
                  key={chip.key}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.16, ease: COMPOSER_EASE }}
                  onClick={() => onAgentSelect(chip.key)}
                  className={[
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-all duration-150",
                    chip.active
                      ? "border-[#d7e3f5] bg-[#f7faff] text-[#2859b8]"
                      : "border-transparent bg-[#f3f4f6] text-[#6b7280] hover:bg-[#eceff3]",
                  ].join(" ")}
                >
                  <span className={[
                    "inline-block h-1.5 w-1.5 rounded-full",
                    chip.active ? "bg-[#2859b8]" : "bg-[#9ca3af]",
                  ].join(" ")} />
                  {chip.label}
                </motion.button>
              ))}

              {ideaPreferenceEnabled ? (
                <span className="text-[12px] text-[#9aa4b2]">idea 已启用</span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.16, ease: COMPOSER_EASE }}
              onClick={onToggleConfig}
              className={[
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all duration-150",
                configExpanded
                  ? "bg-[#eef2f7] text-[#374151]"
                  : "bg-[#f7f7f8] text-[#6b7280] hover:bg-[#f0f2f5]",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              设置
            </motion.button>

            <motion.button
              type="submit"
              disabled={!hasValue || disabled || submitting || !canSubmit}
              animate={hasValue && !disabled && !submitting && canSubmit ? { opacity: 1, scale: 1 } : { opacity: 0.82, scale: 0.96 }}
              transition={{ duration: 0.18, ease: COMPOSER_EASE }}
              className={[
                "inline-flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150",
                hasValue && !disabled && !submitting && canSubmit
                  ? "bg-[#111827] text-white shadow-[0_4px_10px_rgba(15,23,42,0.16)] hover:bg-black"
                  : "bg-[#eceef1] text-[#b0b7c3] cursor-not-allowed shadow-none",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                arrow_upward
              </span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </form>
  );
}

export default ScholarSearchBox;
