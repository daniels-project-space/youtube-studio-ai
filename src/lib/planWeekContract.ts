import { FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaProThumbnailContract";

/** Fresh admissions. Provider and creative-route migrations must bump this. */
export const PLAN_WEEK_CONTRACT_VERSION = "plan-week-v7-rendered-frame-lofi" as const;

/**
 * Read/recovery compatibility for frozen batches made before Lo-Fi plans
 * carried an explicit thumbnail source. Those rows are paid planner artwork
 * and must retain their full receipt requirement.
 */
export const LEGACY_FROZEN_INPUTS_PLAN_WEEK_CONTRACT_VERSION =
  "plan-week-v6-frozen-inputs" as const;

/** Read/recovery compatibility for batches made before frozen weekly inputs. */
export const LEGACY_FAL_NANO_BANANA_PRO_PLAN_WEEK_CONTRACT_VERSION =
  "plan-week-v5-golden-fal-nano-banana-pro" as const;

/** Read/recovery compatibility for the former direct-Google thumbnail route. */
export const LEGACY_GOLDEN_NANO_BANANA_PLAN_WEEK_CONTRACT_VERSION =
  "plan-week-v4-golden-nano-banana" as const;

/**
 * Read/recovery compatibility only. No fresh batch may ever be admitted under
 * this misleading historical identifier.
 */
export const LEGACY_PLAN_WEEK_CONTRACT_VERSION = "plan-week-v3-attested-novita" as const;

export type PlanWeekContractVersion =
  | typeof PLAN_WEEK_CONTRACT_VERSION
  | typeof LEGACY_FROZEN_INPUTS_PLAN_WEEK_CONTRACT_VERSION
  | typeof LEGACY_FAL_NANO_BANANA_PRO_PLAN_WEEK_CONTRACT_VERSION
  | typeof LEGACY_GOLDEN_NANO_BANANA_PLAN_WEEK_CONTRACT_VERSION
  | typeof LEGACY_PLAN_WEEK_CONTRACT_VERSION;

/** Admission only; actual Nano Banana receipt cost remains exact. */
export const PLAN_WEEK_IMAGE_UNIT_USD =
  FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.admissionCeilingUsd;
/** Admission ceilings for one Golden pattern instantiation and one mobile/reference judge. */
export const PLAN_WEEK_THUMBNAIL_CONCEPT_UNIT_USD = 0.01;
export const PLAN_WEEK_THUMBNAIL_QA_UNIT_USD = 0.003;

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Shared admission contract used by both Trigger and Convex. Pricing changes
 * must bump PLAN_WEEK_CONTRACT_VERSION instead of silently weakening the
 * server-side budget floor.
 */
export function planWeekContractReservation(count: number) {
  const accepted = Math.max(1, Math.min(12, Math.floor(count)));
  const topicraftWant = accepted + 8;
  const proMaxOutputTokens = 7_000 + 220 * topicraftWant;
  const proOutputUsd = 4 * proMaxOutputTokens * (12 / 1_000_000);
  const proInputUsd = 4 * 50_000 * (2 / 1_000_000);
  const judgeUsd = 2 * ((1_500 * 2.5 + 50_000 * 0.3) / 1_000_000);
  const thumbnailQaUsd = roundUsd(accepted * PLAN_WEEK_THUMBNAIL_QA_UNIT_USD);
  const thumbnailConceptUsd = roundUsd(accepted * PLAN_WEEK_THUMBNAIL_CONCEPT_UNIT_USD);
  // Keep the historical floor for normal batches while explicitly reserving
  // every Golden-instantiation + QA call in larger batches.
  const thumbnailModelUsd = roundUsd(Math.max(0.08, thumbnailQaUsd + thumbnailConceptUsd));
  const modelUsd = roundUsd(proOutputUsd + proInputUsd + judgeUsd + thumbnailModelUsd);
  const imageUsd = roundUsd(accepted * PLAN_WEEK_IMAGE_UNIT_USD);
  return {
    modelUsd,
    imageUsd,
    imageUnitUsd: PLAN_WEEK_IMAGE_UNIT_USD,
    thumbnailConceptUsd,
    thumbnailQaUsd,
    thumbnailModelUsd,
    totalUsd: roundUsd(modelUsd + imageUsd),
  };
}
