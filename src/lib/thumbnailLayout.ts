/**
 * Pure thumbnail typography planning. FFmpeg's drawtext filter does not wrap
 * or protect safe areas, so every renderer uses this plan before drawing.
 */
export type ThumbnailTextZone =
  | "left"
  | "right"
  | "upperLeft"
  | "upperRight"
  | "center"
  | "upperCenter";

export interface ThumbnailHeadlineLine {
  text: string;
  accent?: boolean;
  payoff?: boolean;
}

export interface PlannedThumbnailLine extends ThumbnailHeadlineLine {
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThumbnailTextPlan {
  width: number;
  height: number;
  safeInset: number;
  zone: ThumbnailTextZone;
  align: "left" | "right" | "center";
  lines: PlannedThumbnailLine[];
}

const GLYPH_WIDTH_RATIO = 0.62;

function cleanText(text: string, uppercase: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return uppercase ? clean.toUpperCase() : clean;
}

function wrapLine(
  line: ThumbnailHeadlineLine,
  maxChars: number,
  uppercase: boolean,
): ThumbnailHeadlineLine[] {
  const text = cleanText(line.text, uppercase);
  if (!text) return [];
  const words = text.split(" ");
  const out: ThumbnailHeadlineLine[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      out.push({ text: current, accent: line.accent });
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push({ text: current, accent: line.accent });
  return out;
}

/**
 * Plan conservative text boxes for a 16:9 thumbnail. The returned boxes include
 * the drawtext plate padding, and therefore can be asserted directly against
 * the safe inset in tests.
 */
export function planThumbnailText(args: {
  lines: ThumbnailHeadlineLine[];
  zone?: ThumbnailTextZone;
  uppercase?: boolean;
  width?: number;
  height?: number;
  safeInset?: number;
}): ThumbnailTextPlan {
  const width = args.width ?? 1_280;
  const height = args.height ?? 720;
  const safeInset = args.safeInset ?? 52;
  const zone = args.zone ?? "center";
  const uppercase = args.uppercase !== false;
  const sideZone = /left|right/i.test(zone);
  const zoneWidth = sideZone
    ? Math.min(570, Math.floor(width * 0.45))
    : width - safeInset * 2;
  const platePadding = 16;
  const maxTextWidth = zoneWidth - platePadding * 2;
  const maxChars = sideZone ? 16 : 24;
  const wrapped = args.lines.flatMap((line) => wrapLine(line, maxChars, uppercase));
  const lines = wrapped.length ? wrapped : [{ text: "WATCH", accent: false }];
  const maxBlockHeight = height - safeInset * 2 - 70;
  const scales = lines.map((line) => line.payoff ? 1.22 : 1);
  const byWidth = Math.min(...lines.map((line, index) => {
    const glyphs = Math.max(1, Array.from(line.text).length);
    return Math.floor(maxTextWidth / (glyphs * GLYPH_WIDTH_RATIO * scales[index]));
  }));
  const byHeight = Math.floor(maxBlockHeight / (scales.reduce((sum, scale) => sum + scale, 0) * 1.18));
  const baseFontSize = Math.max(34, Math.min(104, byWidth, byHeight));
  const fontSizes = scales.map((scale) => Math.floor(baseFontSize * scale));
  const lineHeights = fontSizes.map((fontSize) => Math.ceil(fontSize * 1.18));
  const blockHeight = lineHeights.reduce((sum, lineHeight) => sum + lineHeight, 0);
  const upper = zone.startsWith("upper");
  const firstY = upper
    ? safeInset + platePadding
    : Math.max(safeInset + platePadding, Math.floor((height - blockHeight) / 2));
  const align = /right/i.test(zone) ? "right" : /center/i.test(zone) ? "center" : "left";

  let yOffset = 0;
  const planned = lines.map((line, index) => {
    const fontSize = fontSizes[index];
    const lineHeight = lineHeights[index];
    const textWidth = Math.min(
      maxTextWidth,
      Math.ceil(Array.from(line.text).length * fontSize * GLYPH_WIDTH_RATIO),
    );
    const plateWidth = textWidth + platePadding * 2;
    const x = align === "left"
      ? safeInset
      : align === "right"
        ? width - safeInset - plateWidth
        : Math.floor((width - plateWidth) / 2);
    const plannedLine = {
      ...line,
      fontSize,
      x,
      y: firstY + yOffset - platePadding,
      width: plateWidth,
      height: lineHeight,
    };
    yOffset += lineHeight;
    return plannedLine;
  });

  return { width, height, safeInset, zone, align, lines: planned };
}
