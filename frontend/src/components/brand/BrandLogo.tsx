import type { CSSProperties, HTMLAttributes } from "react";
import BrandSymbol, { type BrandTheme } from "./BrandSymbol";
import BrandWordmark from "./BrandWordmark";

export type BrandLogoVariant = "symbol" | "wordmark" | "full";
export type BrandLogoLayout = "horizontal" | "stacked";

export interface BrandLogoProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  variant?: BrandLogoVariant;
  size?: number;
  theme?: BrandTheme;
  layout?: BrandLogoLayout;
  symbolTitle?: string;
  wordmarkTitle?: string;
  animated?: boolean;
}

const getSymbolSize = (size: number, variant: BrandLogoVariant, layout: BrandLogoLayout): number => {
  if (variant === "symbol") {
    return size;
  }
  return layout === "stacked" ? Math.round(size * 0.78) : Math.round(size * 0.88);
};

const getWordmarkSize = (size: number, layout: BrandLogoLayout): number => {
  return layout === "stacked" ? Math.round(size * 2.6) : Math.round(size * 3.2);
};

export default function BrandLogo({
  variant = "full",
  size = 40,
  theme = "light",
  layout = "horizontal",
  className,
  style,
  symbolTitle,
  wordmarkTitle,
  animated = true,
  ...props
}: BrandLogoProps) {
  const isHorizontal = layout === "horizontal";
  const wrapperStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: variant === "full" ? (isHorizontal ? "row" : "column") : "row",
    gap: variant === "full" ? (isHorizontal ? Math.max(8, Math.round(size * 0.18)) : Math.max(6, Math.round(size * 0.12))) : 0,
    lineHeight: 0,
    ...style,
  };

  return (
    <div className={className} style={wrapperStyle} {...props}>
      {variant !== "wordmark" ? (
        <BrandSymbol
          size={getSymbolSize(size, variant, layout)}
          theme={theme}
          title={symbolTitle}
          animated={animated}
          aria-hidden={variant === "full" ? "true" : undefined}
        />
      ) : null}
      {variant !== "symbol" ? (
        <BrandWordmark
          size={variant === "wordmark" ? size : getWordmarkSize(size, layout)}
          theme={theme}
          title={wordmarkTitle}
          animated={animated}
          aria-hidden={variant === "full" ? "true" : undefined}
        />
      ) : null}
    </div>
  );
}
