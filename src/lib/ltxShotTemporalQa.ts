import type { GenerationProfile } from "@/engine/generationProfiles";
import {
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
  type TemporalDynamismInterval,
} from "@/lib/temporalDynamism";

export const LTX_SHOT_TEMPORAL_QA_CONTRACT = "ltx-shot-temporal-qa/v1" as const;
/**
 * LTX's image-conditioned first frames can otherwise look plausible while
 * remaining motionless for the first decoded beat.  This is deliberately
 * independent from the allowance for a later, authored static hold.
 *
 * The detector samples at 4fps, so one decoded 250ms interval is the smallest
 * reliable opening-motion allowance. The additional 50ms boundary grace
 * rejects a measurable half-second hold without confusing decoder cadence
 * with an actual frozen opening.
 */
export const LTX_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC = 0.25;

export interface LtxShotTemporalQaEvidence {
  contract: typeof LTX_SHOT_TEMPORAL_QA_CONTRACT;
  source: "ffmpeg/freezedetect";
  verdict: "pass" | "fail" | "unavailable";
  maxFreezeFraction: number;
  maxStaticHoldSec: number;
  maxOpeningFrozenHoldSec: number;
  maxFrozenHoldSec: number;
  /** A freeze beginning on the first decoded frame, with one-frame tolerance. */
  openingFrozenHoldSec: number;
  frozenIntervals: TemporalDynamismInterval[];
  violatingIntervals: TemporalDynamismInterval[];
  detail?: string;
}

function openingFrozenHoldSec(
  evidence: TemporalDynamismEvidence,
  fps: number,
): number {
  const firstFrameToleranceSec = 1 / fps + 0.05;
  return evidence.evaluatedIntervals
    .filter((interval) => interval.startSec <= firstFrameToleranceSec)
    .reduce((longest, interval) => Math.max(longest, interval.durationSec), 0);
}

/**
 * Measure one generated LTX take before subjective vision grading. The profile's
 * maxFreezeFraction was previously declarative only; this makes it an enforced,
 * durable shot-level quality boundary and catches the known 1–2 second frozen
 * opening even when start/middle/end stills look individually plausible.
 */
export function measureLtxShotTemporalQa(args: {
  videoPath: string;
  durationSec: number;
  fps: number;
  maxFreezeFraction: GenerationProfile["qa"]["maxFreezeFraction"];
}): LtxShotTemporalQaEvidence {
  if (!Number.isFinite(args.durationSec) || args.durationSec <= 0) {
    throw new Error("LTX shot temporal QA requires a positive measured duration");
  }
  if (!Number.isInteger(args.fps) || args.fps <= 0) {
    throw new Error("LTX shot temporal QA requires a positive integer frame rate");
  }
  if (
    !Number.isFinite(args.maxFreezeFraction) ||
    args.maxFreezeFraction <= 0 ||
    args.maxFreezeFraction > 0.2
  ) {
    throw new Error("LTX shot temporal QA requires a maxFreezeFraction in (0, 0.2]");
  }

  const maxStaticHoldSec = args.durationSec * args.maxFreezeFraction;
  const measured = measureTemporalDynamism({
    videoPath: args.videoPath,
    durationSec: args.durationSec,
    maxStaticHoldSec,
  });
  if (measured.verdict === "not_required") {
    throw new Error("LTX shot temporal QA cannot disable motion evidence");
  }
  const maxOpeningFrozenHoldSec = Math.min(
    maxStaticHoldSec,
    LTX_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC,
  );
  const actualOpeningFrozenHoldSec = openingFrozenHoldSec(measured, args.fps);
  const openingFreezeInterval = measured.evaluatedIntervals.find(
    (interval) => interval.startSec <= 1 / args.fps + 0.05,
  );
  const openingViolation = actualOpeningFrozenHoldSec > maxOpeningFrozenHoldSec + 0.05;
  const violatingIntervals = openingViolation && openingFreezeInterval
    && !measured.violatingIntervals.some((interval) =>
      Math.abs(interval.startSec - openingFreezeInterval.startSec) < 0.001
      && Math.abs(interval.endSec - openingFreezeInterval.endSec) < 0.001,
    )
    ? [...measured.violatingIntervals, openingFreezeInterval]
    : measured.violatingIntervals;
  return {
    contract: LTX_SHOT_TEMPORAL_QA_CONTRACT,
    source: measured.source,
    verdict: measured.verdict === "unavailable"
      ? "unavailable"
      : violatingIntervals.length ? "fail" : "pass",
    maxFreezeFraction: args.maxFreezeFraction,
    maxStaticHoldSec,
    maxOpeningFrozenHoldSec,
    maxFrozenHoldSec: measured.maxFrozenHoldSec,
    openingFrozenHoldSec: actualOpeningFrozenHoldSec,
    frozenIntervals: measured.frozenIntervals,
    violatingIntervals,
    ...(measured.detail ? { detail: measured.detail } : {}),
  };
}
