import { optionText, roundFrames, sourceCitationLabel, type QuizYearRound } from "./QuizYear";

/**
 * A deliberately separate proof surface for a portrait quiz Short. The main
 * QuizYear composition remains a landscape long-form contract; this module
 * has no route, catalog, or admission side effect.
 */
export const QUIZ_YEAR_PORTRAIT_WIDTH = 1080;
export const QUIZ_YEAR_PORTRAIT_HEIGHT = 1920;
export const QUIZ_YEAR_PORTRAIT_FPS = 30;
export const QUIZ_YEAR_PORTRAIT_ASPECT = "9:16" as const;
export const QUIZ_YEAR_PORTRAIT_INTRO_FRAMES = QUIZ_YEAR_PORTRAIT_FPS * 2;
export const QUIZ_YEAR_PORTRAIT_OUTRO_FRAMES = QUIZ_YEAR_PORTRAIT_FPS * 3;

export interface PortraitRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * These margins are intentionally more conservative than the composition
 * boundary. They protect against player chrome and make every required word
 * reviewable in a screenshot rather than merely technically on-frame.
 */
export const QUIZ_YEAR_PORTRAIT_SAFE_AREA: PortraitRect = {
  id: "portrait-safe-area",
  x: 72,
  y: 108,
  width: 936,
  height: 1692,
};

export const QUIZ_YEAR_PORTRAIT_REGIONS = {
  header: { id: "header", x: 72, y: 136, width: 936, height: 96 },
  category: { id: "category", x: 72, y: 338, width: 936, height: 52 },
  question: { id: "question", x: 92, y: 414, width: 896, height: 274 },
  optionA: { id: "option-a", x: 72, y: 716, width: 450, height: 194 },
  optionB: { id: "option-b", x: 558, y: 716, width: 450, height: 194 },
  optionC: { id: "option-c", x: 72, y: 932, width: 450, height: 194 },
  optionD: { id: "option-d", x: 558, y: 932, width: 450, height: 194 },
  countdown: { id: "countdown", x: 390, y: 1190, width: 300, height: 190 },
  reveal: { id: "reveal", x: 102, y: 1406, width: 876, height: 218 },
  source: { id: "source", x: 120, y: 1696, width: 840, height: 58 },
} as const satisfies Record<string, PortraitRect>;

export const QUIZ_YEAR_PORTRAIT_OCR_SAFE_REGIONS = Object.values(QUIZ_YEAR_PORTRAIT_REGIONS);

export interface QuizYearPortraitProofProps {
  rounds?: QuizYearRound[];
  palette?: string[];
  title?: string;
  /**
   * Present only to make an accidental non-portrait invocation fail loudly.
   * The renderer always sets the fixed 1080 x 1920 proof dimensions.
   */
  width?: number;
  height?: number;
}

export interface QuizYearPortraitPreflightReport {
  aspect: typeof QUIZ_YEAR_PORTRAIT_ASPECT;
  width: number;
  height: number;
  durationFrames: number;
  durationSeconds: number;
  safeArea: PortraitRect;
  ocrSafeRegions: PortraitRect[];
}

export class QuizYearPortraitPreflightError extends Error {
  public readonly code = "quizyear_portrait_preflight_failed";

  public constructor(message: string) {
    super(message);
    this.name = "QuizYearPortraitPreflightError";
  }
}

function fail(message: string): never {
  throw new QuizYearPortraitPreflightError(message);
}

function rectInside(outer: PortraitRect, inner: PortraitRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function glyphUnits(character: string): number {
  if (/\s/.test(character)) return 0.34;
  if (/[ilIjtfr]/.test(character)) return 0.43;
  if (/[mwMW@#%]/.test(character)) return 1.02;
  if (/[A-Z0-9]/.test(character)) return 0.72;
  return 0.61;
}

/**
 * A conservative deterministic line estimator. It is not a browser text
 * metric: it deliberately consumes only 88% of the available width, so a
 * preflight pass leaves breathing room for the actual Inter fallback stack.
 */
export function estimatedWrappedLineCount(text: string, fontSize: number, width: number): number {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return 0;
  const maxUnits = (width * 0.88) / fontSize;
  let lines = 1;
  let current = 0;

  for (const word of normalized.split(" ")) {
    const units = [...word].reduce((sum, character) => sum + glyphUnits(character), 0);
    const separator = current === 0 ? 0 : glyphUnits(" ");
    if (current > 0 && current + separator + units > maxUnits) {
      lines += 1;
      current = 0;
    }
    if (units > maxUnits) {
      lines += Math.ceil(units / maxUnits) - 1;
      current = units % maxUnits;
    } else {
      current += (current === 0 ? 0 : glyphUnits(" ")) + units;
    }
  }
  return lines;
}

export function portraitQuestionFontSize(text: string): number {
  if (text.length <= 70) return 62;
  if (text.length <= 100) return 54;
  if (text.length <= 160) return 46;
  return 42;
}

export function portraitOptionFontSize(text: string): number {
  if (text.length <= 12) return 42;
  if (text.length <= 24) return 34;
  if (text.length <= 40) return 29;
  return 26;
}

function assertTextBox(params: {
  label: string;
  text: string;
  region: PortraitRect;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  horizontalPadding?: number;
  verticalPadding?: number;
}): void {
  const value = params.text.trim();
  if (!value) fail(`${params.label} must not be blank`);
  const usableWidth = params.region.width - (params.horizontalPadding ?? 0) * 2;
  const usableHeight = params.region.height - (params.verticalPadding ?? 0) * 2;
  const lines = estimatedWrappedLineCount(value, params.fontSize, usableWidth);
  const textHeight = lines * params.fontSize * params.lineHeight;
  if (lines > params.maxLines || textHeight > usableHeight) {
    fail(
      `${params.label} exceeds its ${params.region.id} OCR-safe region ` +
        `(${lines} lines / ${Math.ceil(textHeight)}px)`
    );
  }
}

function assertRound(round: QuizYearRound, index: number): void {
  const prefix = `round ${index + 1}`;
  if (!Number.isFinite(round.countdownSeconds) || round.countdownSeconds < 5 || round.countdownSeconds > 9) {
    fail(`${prefix} countdown must be between 5 and 9 seconds`);
  }
  if (!Number.isFinite(round.revealSeconds) || round.revealSeconds < 4 || round.revealSeconds > 7) {
    fail(`${prefix} reveal must be between 4 and 7 seconds`);
  }
  if ((round.options ?? []).length !== 4) fail(`${prefix} must have exactly four options`);
  if (round.options.filter((option) => option.isCorrect).length !== 1) {
    fail(`${prefix} must have exactly one correct option`);
  }

  const optionLabels = round.options.map(optionText);
  if (new Set(optionLabels.map((label) => label.trim().toLocaleLowerCase())).size !== optionLabels.length) {
    fail(`${prefix} option labels must be distinct`);
  }
  assertTextBox({
    label: `${prefix} category prompt`,
    text: round.categoryPrompt ?? "WHAT YEAR?",
    region: QUIZ_YEAR_PORTRAIT_REGIONS.category,
    fontSize: 30,
    lineHeight: 1,
    maxLines: 1,
  });
  assertTextBox({
    label: `${prefix} question`,
    text: round.questionText,
    region: QUIZ_YEAR_PORTRAIT_REGIONS.question,
    fontSize: portraitQuestionFontSize(round.questionText),
    lineHeight: 1.12,
    maxLines: 5,
    horizontalPadding: 12,
  });

  const optionRegions = [
    QUIZ_YEAR_PORTRAIT_REGIONS.optionA,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionB,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionC,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionD,
  ];
  for (const [optionIndex, option] of round.options.entries()) {
    const label = optionText(option);
    assertTextBox({
      label: `${prefix} option ${optionIndex + 1}`,
      text: label,
      region: optionRegions[optionIndex],
      fontSize: portraitOptionFontSize(label),
      lineHeight: 1.08,
      maxLines: 3,
      horizontalPadding: 102,
      verticalPadding: 24,
    });
  }

  assertTextBox({
    label: `${prefix} reveal subject`,
    text: round.subject,
    region: QUIZ_YEAR_PORTRAIT_REGIONS.reveal,
    fontSize: 38,
    lineHeight: 1.08,
    maxLines: 1,
  });
  assertTextBox({
    label: `${prefix} reveal explanation`,
    text: round.revealExplanation ?? round.subtext ?? "",
    region: QUIZ_YEAR_PORTRAIT_REGIONS.reveal,
    fontSize: 28,
    lineHeight: 1.16,
    maxLines: 3,
    verticalPadding: 56,
  });
  assertTextBox({
    label: `${prefix} source label`,
    text: `SOURCE · ${sourceCitationLabel(round.sourceUrl)}`,
    region: QUIZ_YEAR_PORTRAIT_REGIONS.source,
    fontSize: 25,
    lineHeight: 1,
    maxLines: 1,
  });
}

export function portraitQuizYearTotalFrames(rounds: QuizYearRound[]): number {
  return (
    QUIZ_YEAR_PORTRAIT_INTRO_FRAMES +
    rounds.reduce((sum, round) => sum + roundFrames(round), 0) +
    QUIZ_YEAR_PORTRAIT_OUTRO_FRAMES
  );
}

/**
 * Run before any renderer/browser work. A pass means the exact text-bearing
 * boxes are inside the portrait safe area and the proof stays a 35–60 second
 * vertical Short; it is intentionally not a release/admission decision.
 */
export function preflightQuizYearPortraitProof(
  props: QuizYearPortraitProofProps
): QuizYearPortraitPreflightReport {
  const width = props.width ?? QUIZ_YEAR_PORTRAIT_WIDTH;
  const height = props.height ?? QUIZ_YEAR_PORTRAIT_HEIGHT;
  if (width !== QUIZ_YEAR_PORTRAIT_WIDTH || height !== QUIZ_YEAR_PORTRAIT_HEIGHT) {
    fail(`portrait proof requires ${QUIZ_YEAR_PORTRAIT_WIDTH}x${QUIZ_YEAR_PORTRAIT_HEIGHT}, received ${width}x${height}`);
  }
  if (Math.abs(width / height - 9 / 16) > 0.0001) fail("portrait proof must remain exactly 9:16");
  for (const region of QUIZ_YEAR_PORTRAIT_OCR_SAFE_REGIONS) {
    if (!rectInside(QUIZ_YEAR_PORTRAIT_SAFE_AREA, region)) {
      fail(`${region.id} sits outside the portrait safe area`);
    }
  }

  const title = (props.title ?? "QUICK QUIZ").trim();
  assertTextBox({
    label: "portrait title",
    text: title,
    region: QUIZ_YEAR_PORTRAIT_REGIONS.header,
    fontSize: 28,
    lineHeight: 1,
    maxLines: 1,
  });

  const rounds = props.rounds ?? [];
  if (rounds.length < 3 || rounds.length > 4) fail("portrait proof requires three or four rounds");
  rounds.forEach(assertRound);
  const durationFrames = portraitQuizYearTotalFrames(rounds);
  const durationSeconds = durationFrames / QUIZ_YEAR_PORTRAIT_FPS;
  if (durationSeconds < 35 || durationSeconds > 60) {
    fail(`portrait proof must run 35–60 seconds, received ${durationSeconds.toFixed(2)} seconds`);
  }

  return {
    aspect: QUIZ_YEAR_PORTRAIT_ASPECT,
    width,
    height,
    durationFrames,
    durationSeconds,
    safeArea: QUIZ_YEAR_PORTRAIT_SAFE_AREA,
    ocrSafeRegions: QUIZ_YEAR_PORTRAIT_OCR_SAFE_REGIONS.map((region) => ({ ...region })),
  };
}
