import { NARRATION_BASE_WORDS_PER_SEC, NARRATION_RATE_TOLERANCE, assertNarrationSpeed } from "./narrationPerformance";

const LEGACY_WORDS_PER_SEC = 3.1;
const AVERAGE_WORDS_PER_SENTENCE = 14;

/** Select a speech rate compatible with the production delivery gate. */
export function scriptSpeechRate(input: { qualityProfile?: "production" | "draft"; override?: string }): number {
  const production = input.qualityProfile !== "draft";
  if (input.override === undefined || input.override === "") return production ? NARRATION_BASE_WORDS_PER_SEC : LEGACY_WORDS_PER_SEC;
  const rate = Number(input.override);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("NARRATION_WPS must be a finite positive speech rate");
  if (production && (rate < NARRATION_BASE_WORDS_PER_SEC * (1 - NARRATION_RATE_TOLERANCE) || rate > NARRATION_BASE_WORDS_PER_SEC * (1 + NARRATION_RATE_TOLERANCE))) {
    throw new Error("NARRATION_WPS is outside the production narration delivery-rate contract; remove it or select a compatible rate");
  }
  return rate;
}

export function effectiveScriptWordsPerSecond(input: { qualityProfile?: "production" | "draft"; override?: string; gapSec?: number; speed?: number }): number {
  const rate = scriptSpeechRate(input);
  const gap = Math.max(0, input.gapSec ?? 0);
  const speed = input.qualityProfile === "draft" ? Math.min(1.3, Math.max(0.7, input.speed || 1)) : assertNarrationSpeed(input.speed ?? 1, "script narration speed");
  if (!Number.isFinite(gap)) throw new Error("script narration gap must be finite");
  return 1 / (1 / (rate * speed) + gap / AVERAGE_WORDS_PER_SENTENCE);
}
