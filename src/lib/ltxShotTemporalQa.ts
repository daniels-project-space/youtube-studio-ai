import type { GenerationProfile } from "@/engine/generationProfiles";
import {
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
  type TemporalDynamismInterval,
} from "@/lib/temporalDynamism";

export const LTX_SHOT_TEMPORAL_QA_CONTRACT = "ltx-shot-temporal-qa/v1" as const;

export interface LtxShotTemporalQaEvidence {
  contract: typeof LTX_SHOT_TEMPORAL_QA_CONTRACT;
  source: "ffmpeg/freezedetect";
  verdict: "pass" | "fail" | "unavailable";
  maxFreezeFraction: number;
  maxStaticHoldSec: number;
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
  return {
    contract: LTX_SHOT_TEMPORAL_QA_CONTRACT,
    source: measured.source,
    verdict: measured.verdict,
    maxFreezeFraction: args.maxFreezeFraction,
    maxStaticHoldSec,
    maxFrozenHoldSec: measured.maxFrozenHoldSec,
    openingFrozenHoldSec: openingFrozenHoldSec(measured, args.fps),
    frozenIntervals: measured.frozenIntervals,
    violatingIntervals: measured.violatingIntervals,
    ...(measured.detail ? { detail: measured.detail } : {}),
  };
}
