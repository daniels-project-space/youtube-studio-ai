export const PLAN_WEEK_CONTRACT_VERSION = "plan-week-v2" as const;
export const PLAN_WEEK_IMAGE_UNIT_USD = 0.04;

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
  const modelUsd = roundUsd(proOutputUsd + proInputUsd + judgeUsd + 0.08);
  const imageUsd = roundUsd(accepted * PLAN_WEEK_IMAGE_UNIT_USD);
  return {
    modelUsd,
    imageUsd,
    imageUnitUsd: PLAN_WEEK_IMAGE_UNIT_USD,
    totalUsd: roundUsd(modelUsd + imageUsd),
  };
}
