import { useId, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { useReducedMotion } from "framer-motion";
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

export default function BrandWordmark({
  size = 180,
  className,
  theme = "light",
  title = "xcientist wordmark",
  animated = true,
  ...props
}: BrandWordmarkProps) {
  const prefersReducedMotion = useReducedMotion();
  const enableMotion = animated && !prefersReducedMotion;
  const id = useId().replace(/:/g, "");
  const baseGradientId = `xcientist-wordmark-base-${id}`;
  const flowGradientId = `xcientist-wordmark-flow-${id}`;

  const basePalette =
    theme === "dark"
      ? ["#cfe4f2", "#7ea8c8", "#4d739a"]
      : ["#bfdced", "#6f9ec0", "#43688f"];
  const flowPalette =
    theme === "dark"
      ? ["rgba(255,255,255,0)", "rgba(237,248,255,0.14)", "rgba(141,208,244,0.28)", "rgba(255,255,255,0.09)", "rgba(255,255,255,0)"]
      : ["rgba(255,255,255,0)", "rgba(242,251,255,0.12)", "rgba(119,198,239,0.24)", "rgba(255,255,255,0.08)", "rgba(255,255,255,0)"];

  const defs = useMemo(() => {
    const animate = enableMotion
      ? `
        <animate attributeName="x1" values="-240;220;760;-240" dur="6.2s" repeatCount="indefinite" />
        <animate attributeName="x2" values="120;780;1380;120" dur="6.2s" repeatCount="indefinite" />
        <animate attributeName="y1" values="290;284;298;290" dur="6.2s" repeatCount="indefinite" />
        <animate attributeName="y2" values="626;618;632;626" dur="6.2s" repeatCount="indefinite" />`
      : "";

    return `
      <defs>
        <linearGradient id="${baseGradientId}" x1="176" y1="304" x2="1364" y2="624" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${basePalette[0]}" />
          <stop offset="0.46" stop-color="${basePalette[1]}" />
          <stop offset="1" stop-color="${basePalette[2]}" />
        </linearGradient>
        <linearGradient id="${flowGradientId}" x1="-240" y1="290" x2="120" y2="626" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${flowPalette[0]}" />
          <stop offset="0.22" stop-color="${flowPalette[1]}" />
          <stop offset="0.48" stop-color="${flowPalette[2]}" />
          <stop offset="0.72" stop-color="${flowPalette[3]}" />
          <stop offset="1" stop-color="${flowPalette[4]}" />
          ${animate}
        </linearGradient>
      </defs>`;
  }, [baseGradientId, basePalette, enableMotion, flowGradientId, flowPalette]);

  const content = useMemo(() => {
    const baseBody = replaceBlackFill(parsedWordmark.body, `url(#${baseGradientId})`);
    const flowBody = replaceBlackFill(parsedWordmark.body, `url(#${flowGradientId})`);
    const titleMarkup = title ? `<title>${title}</title>` : "";
    return `${titleMarkup}${defs}<g stroke="none">${baseBody}</g><g stroke="none" opacity="0.62">${flowBody}</g>`;
  }, [baseGradientId, defs, flowGradientId, title]);

  return (
    <svg
      viewBox={parsedWordmark.viewBox}
      width={size}
      height="auto"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      dangerouslySetInnerHTML={{ __html: content }}
      {...props}
    />
  );
}
