import { motion } from "framer-motion";
import { useId, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";
import wordmarkSvgSource from "../../../xcientist.svg?raw";
import type { BrandTheme } from "./BrandSymbol";
import { parseSvgSource, replaceBlackFill } from "./sourceSvg";

export interface BrandWordmarkProps extends Omit<ComponentPropsWithoutRef<"svg">, "width" | "height"> {
  size?: number | string;
  className?: string;
  theme?: BrandTheme;
  title?: string;
  animated?: boolean;
}

const parsedWordmark = parseSvgSource(wordmarkSvgSource);
const [wordmarkMinX, wordmarkMinY, wordmarkWidth, wordmarkHeight] = parsedWordmark.viewBox
  .split(/\s+/)
  .map((value) => Number(value));
const wordmarkBandWidth = wordmarkWidth * 0.34;
const wordmarkBandHeight = wordmarkHeight * 1.28;
const wordmarkBandStartX = wordmarkMinX - wordmarkBandWidth * 1.15;
const wordmarkBandEndX = wordmarkMinX + wordmarkWidth + wordmarkBandWidth * 0.2;
const wordmarkBandY = wordmarkMinY - wordmarkHeight * 0.14;

export default function BrandWordmark({
  size = 180,
  className,
  theme = "light",
  title = "xcientist wordmark",
  animated = true,
  ...props
}: BrandWordmarkProps) {
  const enableMotion = animated;
  const id = useId().replace(/:/g, "");
  const baseGradientId = `xcientist-wordmark-base-${id}`;
  const flowGradientId = `xcientist-wordmark-flow-${id}`;
  const flowMaskId = `xcientist-wordmark-mask-${id}`;

  const defs = useMemo(() => {
    const basePalette =
      theme === "dark"
        ? ["#9fdbff", "#4c9bf2", "#1f67c6", "#0d356d"]
        : ["#7fcfff", "#3f91ea", "#1d5fbc", "#0a3470"];

    return `
      <defs>
        <linearGradient id="${baseGradientId}" x1="176" y1="460" x2="1374" y2="492" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${basePalette[0]}" />
          <stop offset="0.28" stop-color="${basePalette[1]}" />
          <stop offset="0.62" stop-color="${basePalette[2]}" />
          <stop offset="1" stop-color="${basePalette[3]}" />
        </linearGradient>
        <linearGradient id="${flowGradientId}" x1="0%" y1="18%" x2="100%" y2="82%">
          <stop offset="0" stop-color="#08264f" stop-opacity="0" />
          <stop offset="0.18" stop-color="#0f4f9d" stop-opacity="0.18" />
          <stop offset="0.36" stop-color="#57acff" stop-opacity="0.54" />
          <stop offset="0.48" stop-color="#d4eeff" stop-opacity="0.94" />
          <stop offset="0.52" stop-color="#ffffff" stop-opacity="0.98" />
          <stop offset="0.6" stop-color="#d7efff" stop-opacity="0.84" />
          <stop offset="0.74" stop-color="#67b6ff" stop-opacity="0.42" />
          <stop offset="0.88" stop-color="#13539d" stop-opacity="0.16" />
          <stop offset="1" stop-color="#08264f" stop-opacity="0" />
        </linearGradient>
      </defs>`;
  }, [baseGradientId, flowGradientId, theme]);

  const baseBody = useMemo(() => replaceBlackFill(parsedWordmark.body, `url(#${baseGradientId})`), [baseGradientId]);
  const maskBody = useMemo(() => replaceBlackFill(parsedWordmark.body, "#ffffff"), []);

  return (
    <svg
      viewBox={parsedWordmark.viewBox}
      width={size}
      height="auto"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <defs dangerouslySetInnerHTML={{ __html: defs.replace(/^<defs>|<\/defs>$/g, "") }} />
      <g stroke="none" dangerouslySetInnerHTML={{ __html: baseBody }} />
      <mask id={flowMaskId} maskUnits="userSpaceOnUse" x={wordmarkMinX} y={wordmarkMinY} width={wordmarkWidth} height={wordmarkHeight}>
        <g stroke="none" dangerouslySetInnerHTML={{ __html: maskBody }} />
      </mask>
      <motion.rect
        x={wordmarkBandStartX}
        y={wordmarkBandY}
        width={wordmarkBandWidth}
        height={wordmarkBandHeight}
        fill={`url(#${flowGradientId})`}
        mask={`url(#${flowMaskId})`}
        opacity={0.96}
        initial={{ attrX: wordmarkBandStartX }}
        animate={enableMotion ? { attrX: wordmarkBandEndX } : { attrX: wordmarkBandStartX }}
        transition={
          enableMotion
            ? { duration: 2.2, ease: "linear", repeat: Number.POSITIVE_INFINITY, repeatType: "loop" }
            : undefined
        }
      />
    </svg>
  );
}
