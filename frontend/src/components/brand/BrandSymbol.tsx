import { useId, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { useReducedMotion } from "framer-motion";
import symbolSvgSource from "../../../logo.svg?raw";
import { parseSvgSource, replaceBlackFill } from "./sourceSvg";

export type BrandTheme = "light" | "dark";

export interface BrandSymbolProps extends Omit<ComponentPropsWithoutRef<"svg">, "width" | "height"> {
  size?: number | string;
  className?: string;
  theme?: BrandTheme;
  title?: string;
  animated?: boolean;
}

const parsedSymbol = parseSvgSource(symbolSvgSource);

export default function BrandSymbol({
  size = 40,
  className,
  theme = "light",
  title = "xcientist symbol",
  animated = true,
  ...props
}: BrandSymbolProps) {
  const prefersReducedMotion = useReducedMotion();
  const enableMotion = animated && !prefersReducedMotion;
  const id = useId().replace(/:/g, "");
  const baseGradientId = `xcientist-symbol-base-${id}`;
  const flowGradientId = `xcientist-symbol-flow-${id}`;

  const basePalette =
    theme === "dark"
      ? ["#d4edf8", "#72b3d9", "#3a6ea3"]
      : ["#c7e6f5", "#68a8cf", "#35689b"];
  const flowPalette =
    theme === "dark"
      ? ["rgba(255,255,255,0)", "rgba(244,251,255,0.12)", "rgba(149,214,244,0.22)", "rgba(255,255,255,0.07)", "rgba(255,255,255,0)"]
      : ["rgba(255,255,255,0)", "rgba(243,251,255,0.10)", "rgba(128,205,240,0.18)", "rgba(255,255,255,0.06)", "rgba(255,255,255,0)"];

  const defs = useMemo(() => {
    const animate = enableMotion
      ? `
        <animate attributeName="x1" values="492;640;780;492" dur="7.4s" repeatCount="indefinite" />
        <animate attributeName="x2" values="650;860;1030;650" dur="7.4s" repeatCount="indefinite" />
        <animate attributeName="y1" values="178;172;188;178" dur="7.4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="682;676;694;682" dur="7.4s" repeatCount="indefinite" />`
      : "";

    return `
      <defs>
        <linearGradient id="${baseGradientId}" x1="540" y1="188" x2="996" y2="686" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${basePalette[0]}" />
          <stop offset="0.48" stop-color="${basePalette[1]}" />
          <stop offset="1" stop-color="${basePalette[2]}" />
        </linearGradient>
        <linearGradient id="${flowGradientId}" x1="492" y1="178" x2="650" y2="682" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${flowPalette[0]}" />
          <stop offset="0.24" stop-color="${flowPalette[1]}" />
          <stop offset="0.5" stop-color="${flowPalette[2]}" />
          <stop offset="0.74" stop-color="${flowPalette[3]}" />
          <stop offset="1" stop-color="${flowPalette[4]}" />
          ${animate}
        </linearGradient>
      </defs>`;
  }, [baseGradientId, basePalette, enableMotion, flowGradientId, flowPalette]);

  const content = useMemo(() => {
    const baseBody = replaceBlackFill(parsedSymbol.body, `url(#${baseGradientId})`);
    const flowBody = replaceBlackFill(parsedSymbol.body, `url(#${flowGradientId})`);
    const titleMarkup = title ? `<title>${title}</title>` : "";
    return `${titleMarkup}${defs}<g stroke="none">${baseBody}</g><g stroke="none" opacity="0.44">${flowBody}</g>`;
  }, [baseGradientId, defs, flowGradientId, title]);

  return (
    <svg
      viewBox={parsedSymbol.viewBox}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      dangerouslySetInnerHTML={{ __html: content }}
      {...props}
    />
  );
}
