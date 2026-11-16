import { PRICE } from "./pricing";
import {
  NARRATION_COLD_OPEN_MAX_CHARS,
  narrationChapterHeadingCharacterCeiling,
} from "../lib/narrationBounds";

export const NARRATION_TTS_MODULE_COST_CEILING_USD = 10;

export type NarrationTtsCostProvider = "qwen3" | "elevenlabs" | "fish" | string;

export function narrationTtsCostCeilingUsd(args: {
  durationSeconds: number;
  provider?: NarrationTtsCostProvider;
  chapterCards?: boolean;
}): number {
  const seconds = Number.isFinite(args.durationSeconds)
    ? Math.min(36_000, Math.max(30, args.durationSeconds))
    : 300;
  const maxCharacters =
    Math.ceil(seconds * 20) +
    2 * NARRATION_COLD_OPEN_MAX_CHARS +
    (args.chapterCards ? narrationChapterHeadingCharacterCeiling() : 0);
  const provider = String(args.provider ?? "fish").toLowerCase();
  const rate = provider === "elevenlabs"
    ? PRICE.ttsElevenPerKCharUsd
    : provider === "qwen3"
      ? PRICE.ttsQwenMaxPerKCharUsd
      : PRICE.ttsPerKCharUsd;
  return (maxCharacters * rate) / 1_000 + 2 * PRICE.visionGraderUsd;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read every request location that can enable spoken chapter cards. */
export function narrationChapterCardsRequested(value: unknown): boolean {
  const root = asRecord(value);
  const moduleConfig = asRecord(root?.moduleConfig);
  const overrides = asRecord(root?.paramOverrides);
  const directNarration = asRecord(root?.narration_tts);
  const configuredNarration = asRecord(moduleConfig?.narration_tts);
  const overriddenNarration = asRecord(overrides?.narration_tts);
  const pipeline = Array.isArray(root?.pipeline) ? root.pipeline : [];
  return configuredNarration?.chapterCards === true ||
    overriddenNarration?.chapterCards === true ||
    directNarration?.chapterCards === true ||
    pipeline.some((entry) => {
      const candidate = asRecord(entry);
      return candidate?.block === "narration_tts" &&
        asRecord(candidate.params)?.chapterCards === true;
    });
}

export interface QwenNarrationBudgetAdmission {
  estimatedCostUsd: number;
  moduleCeilingUsd: number;
  availableBudgetUsd: number;
  allowed: boolean;
  reason?: "module-ceiling" | "per-video-budget";
}

export function qwenNarrationBudgetAdmission(args: {
  durationSeconds: number;
  chapterCards?: boolean;
  perVideoBudgetUsd: number;
}): QwenNarrationBudgetAdmission {
  const estimatedCostUsd = narrationTtsCostCeilingUsd({
    durationSeconds: args.durationSeconds,
    provider: "qwen3",
    chapterCards: args.chapterCards,
  });
  const perVideoBudgetUsd = Number.isFinite(args.perVideoBudgetUsd)
    ? Math.max(0, args.perVideoBudgetUsd)
    : 0;
  const availableBudgetUsd = Math.min(NARRATION_TTS_MODULE_COST_CEILING_USD, perVideoBudgetUsd);
  const reason = estimatedCostUsd > NARRATION_TTS_MODULE_COST_CEILING_USD + Number.EPSILON
    ? "module-ceiling"
    : estimatedCostUsd > perVideoBudgetUsd + Number.EPSILON
      ? "per-video-budget"
      : undefined;
  return {
    estimatedCostUsd,
    moduleCeilingUsd: NARRATION_TTS_MODULE_COST_CEILING_USD,
    availableBudgetUsd,
    allowed: reason === undefined,
    ...(reason ? { reason } : {}),
  };
}

/** Largest family-step duration admitted by the current Qwen and per-video caps. */
export function maxQwenNarrationDurationSeconds(args: {
  minimumSeconds: number;
  maximumSeconds: number;
  stepSeconds: number;
  chapterCards?: boolean;
  perVideoBudgetUsd: number;
}): number | null {
  const { minimumSeconds, maximumSeconds, stepSeconds } = args;
  if (
    !Number.isFinite(minimumSeconds) ||
    !Number.isFinite(maximumSeconds) ||
    !Number.isFinite(stepSeconds) ||
    minimumSeconds < 30 ||
    maximumSeconds < minimumSeconds ||
    stepSeconds <= 0
  ) return null;

  const highestFamilyStep = minimumSeconds +
    Math.floor((maximumSeconds - minimumSeconds) / stepSeconds) * stepSeconds;
  for (let durationSeconds = highestFamilyStep; durationSeconds >= minimumSeconds; durationSeconds -= stepSeconds) {
    if (qwenNarrationBudgetAdmission({
      durationSeconds,
      chapterCards: args.chapterCards,
      perVideoBudgetUsd: args.perVideoBudgetUsd,
    }).allowed) return durationSeconds;
  }
  return null;
}
