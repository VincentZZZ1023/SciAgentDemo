import { motion } from "framer-motion";
import { useId, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";
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
const [symbolMinX, symbolMinY, symbolWidth, symbolHeight] = parsedSymbol.viewBox.split(/\s+/).map((value) => Number(value));
const symbolBandWidth = symbolWidth * 0.34;
const symbolBandHeight = symbolHeight * 1.32;
const symbolBandStartX = symbolMinX - symbolBandWidth * 1.1;
const symbolBandEndX = symbolMinX + symbolWidth + symbolBandWidth * 0.22;
const symbolBandY = symbolMinY - symbolHeight * 0.16;

export default function BrandSymbol({
  size = 40,
  className,
  theme = "light",
  title = "xcientist symbol",
  animated = true,
  ...props
}: BrandSymbolProps) {
  const enableMotion = animated;
  const id = useId().replace(/:/g, "");
  const baseGradientId = `xcientist-symbol-base-${id}`;
  const flowGradientId = `xcientist-symbol-flow-${id}`;
  const flowMaskId = `xcientist-symbol-mask-${id}`;

  const defs = useMemo(() => {
    const basePalette =
      theme === "dark"
        ? ["#98d6ff", "#4f9ff1", "#236bc7", "#0d3971"]
        : ["#73c6ff", "#3f8fe8", "#1f63bf", "#0c386f"];

    return `
      <defs>
        <linearGradient id="${baseGradientId}" x1="532" y1="208" x2="1006" y2="652" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${basePalette[0]}" />
          <stop offset="0.3" stop-color="${basePalette[1]}" />
          <stop offset="0.66" stop-color="${basePalette[2]}" />
          <stop offset="1" stop-color="${basePalette[3]}" />
        </linearGradient>
        <linearGradient id="${flowGradientId}" x1="0%" y1="14%" x2="100%" y2="86%">
          <stop offset="0" stop-color="#0c356a" stop-opacity="0" />
          <stop offset="0.22" stop-color="#1f67bd" stop-opacity="0.14" />
          <stop offset="0.4" stop-color="#74c8fb" stop-opacity="0.32" />
          <stop offset="0.5" stop-color="#e2f4ff" stop-opacity="0.58" />
          <stop offset="0.56" stop-color="#ffffff" stop-opacity="0.64" />
          <stop offset="0.66" stop-color="#a5dcff" stop-opacity="0.44" />
          <stop offset="0.82" stop-color="#2f85db" stop-opacity="0.16" />
          <stop offset="1" stop-color="#0c356a" stop-opacity="0" />
        </linearGradient>
      </defs>`;
  }, [baseGradientId, flowGradientId, theme]);

  const baseBody = useMemo(() => replaceBlackFill(parsedSymbol.body, `url(#${baseGradientId})`), [baseGradientId]);
  const maskBody = useMemo(() => replaceBlackFill(parsedSymbol.body, "#ffffff"), []);

  return (
    <svg
      viewBox={parsedSymbol.viewBox}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <defs dangerouslySetInnerHTML={{ __html: defs.replace(/^<defs>|<\/defs>$/g, "") }} />
      <g stroke="none" dangerouslySetInnerHTML={{ __html: baseBody }} />
      <mask id={flowMaskId} maskUnits="userSpaceOnUse" x={symbolMinX} y={symbolMinY} width={symbolWidth} height={symbolHeight}>
        <g stroke="none" dangerouslySetInnerHTML={{ __html: maskBody }} />
      </mask>
      <motion.rect
        x={symbolBandStartX}
        y={symbolBandY}
        width={symbolBandWidth}
        height={symbolBandHeight}
        fill={`url(#${flowGradientId})`}
        mask={`url(#${flowMaskId})`}
        opacity={0.7}
        initial={{ attrX: symbolBandStartX }}
        animate={enableMotion ? { attrX: symbolBandEndX } : { attrX: symbolBandStartX }}
        transition={
          enableMotion
            ? { duration: 3.3, ease: "linear", repeat: Number.POSITIVE_INFINITY, repeatType: "loop" }
            : undefined
        }
      />
    </svg>
  );
}
