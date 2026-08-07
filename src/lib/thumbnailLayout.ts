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
const SPACE_WIDTH_RATIO = 0.36;
const THIN_SPACE_WIDTH_RATIO = 0.18;

function cleanText(text: string, uppercase: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return uppercase ? clean.toUpperCase() : clean;
}

function estimatedTrackedEm(value: string, tracking: 0 | 1 | 2): number {
  const glyphs = Array.from(value);
  const base = glyphs.reduce(
    (sum, glyph) => sum + (glyph === " " ? SPACE_WIDTH_RATIO : GLYPH_WIDTH_RATIO),
    0,
  );
  return base + Math.max(0, glyphs.length - 1) * tracking * THIN_SPACE_WIDTH_RATIO;
}

function wrapLine(
  line: ThumbnailHeadlineLine,
  maxEm: number,
  uppercase: boolean,
  tracking: 0 | 1 | 2,
): ThumbnailHeadlineLine[] {
  const text = cleanText(line.text, uppercase);
  if (!text) return [];
  const splitOversizeWord = (word: string): string[] => {
    const chunks: string[] = [];
    let chunk = "";
    for (const glyph of Array.from(word)) {
      const next = chunk + glyph;
      if (chunk && estimatedTrackedEm(next, tracking) > maxEm) {
        chunks.push(chunk);
        chunk = glyph;
      } else {
        chunk = next;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };
  const words = text.split(" ").flatMap(splitOversizeWord);
  const out: ThumbnailHeadlineLine[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && estimatedTrackedEm(next, tracking) > maxEm) {
      out.push({ text: current, accent: line.accent, payoff: line.payoff });
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push({ text: current, accent: line.accent, payoff: line.payoff });
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
  /** Letter-spacing motif applied by the renderer (thin spaces per gap). */
  tracking?: 0 | 1 | 2;
  /** Renderer font-size multiplier for the selected motif/font. */
  fontScale?: number;
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
  const tracking = args.tracking ?? 0;
  const fontScale = Math.max(0.5, Math.min(1.5, args.fontScale ?? 1));
  const maxEm = (sideZone ? 16 : 24) * GLYPH_WIDTH_RATIO;
  const wrapped = args.lines.flatMap((line) => wrapLine(line, maxEm, uppercase, tracking));
  const lines = wrapped.length ? wrapped : [{ text: "WATCH", accent: false }];
  const maxBlockHeight = height - safeInset * 2 - 70;
  const scales = lines.map((line) => line.payoff ? 1.22 : 1);
  const byWidth = Math.min(...lines.map((line, index) => {
    const em = Math.max(GLYPH_WIDTH_RATIO, estimatedTrackedEm(line.text, tracking));
    return Math.floor(maxTextWidth / (em * scales[index] * fontScale));
  }));
  const byHeight = Math.floor(
    maxBlockHeight / (scales.reduce((sum, scale) => sum + scale, 0) * 1.18 * fontScale),
  );
  const baseFontSize = Math.max(20, Math.min(104, byWidth, byHeight));
  const fontSizes = scales.map((scale) => Math.floor(baseFontSize * scale));
  const lineHeights = fontSizes.map((fontSize) => Math.ceil(fontSize * fontScale * 1.18));
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
      Math.ceil(estimatedTrackedEm(line.text, tracking) * fontSize * fontScale),
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
