const SVG_OPEN_TAG_PATTERN = /<svg\b[^>]*>/i;
const SVG_VIEWBOX_PATTERN = /viewBox="([^"]+)"/i;
const SVG_BODY_PATTERN = /<svg\b[^>]*>([\s\S]*?)<\/svg>/i;

const cleanSvgSource = (source: string): string =>
  source
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();

export interface ParsedSvgSource {
  viewBox: string;
  body: string;
}

export const parseSvgSource = (source: string): ParsedSvgSource => {
  const cleaned = cleanSvgSource(source);
  const svgTag = cleaned.match(SVG_OPEN_TAG_PATTERN)?.[0] ?? "";
  const viewBox = svgTag.match(SVG_VIEWBOX_PATTERN)?.[1] ?? "0 0 100 100";
  const body = cleaned.match(SVG_BODY_PATTERN)?.[1]?.trim() ?? "";
  return { viewBox, body };
};

export const replaceBlackFill = (body: string, fillValue: string): string =>
  body.replace(/fill="#000000"/gi, `fill="${fillValue}"`);
