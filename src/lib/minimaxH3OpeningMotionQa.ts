import {
  MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
  type MiniMaxH3OpeningMotionQaEvidence,
} from "@/engine/cinematicClipReview";
import {
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
  type TemporalDynamismInterval,
} from "@/lib/temporalDynamism";

/**
 * H3 shots are image-conditioned. They may look correct in a still while
 * holding the conditioning image for the first beat, so the cinematic gate
 * independently requires visible motion within one decoded 4fps interval.
 */
export const MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC = 0.25;
export const MINIMAX_H3_MAX_STATIC_FRACTION = 0.1;

export type MiniMaxH3OpeningMotionQaResult =
  | MiniMaxH3OpeningMotionQaEvidence
  | Omit<MiniMaxH3OpeningMotionQaEvidence, "verdict"> & {
      verdict: "fail" | "unavailable";
    };

/** A deterministic H3 defect: a repair caller may retry only this verdict. */
export class MiniMaxH3OpeningMotionRejectedError extends Error {
  constructor(
    readonly evidence: Exclude<MiniMaxH3OpeningMotionQaResult, MiniMaxH3OpeningMotionQaEvidence>,
    label: string,
  ) {
    super(
      `${label} opening froze for ${evidence.openingFrozenHoldSec.toFixed(2)}s ` +
      `(limit ${evidence.maxOpeningFrozenHoldSec.toFixed(2)}s)`,
    );
    this.name = "MiniMaxH3OpeningMotionRejectedError";
  }
}

function openingFrozenHoldSec(evidence: TemporalDynamismEvidence, fps: number): number {
  const firstFrameToleranceSec = 1 / fps + 0.05;
  return evidence.evaluatedIntervals
    .filter((interval) => interval.startSec <= firstFrameToleranceSec)
    .reduce((longest, interval) => Math.max(longest, interval.durationSec), 0);
}

function withOpeningViolation(args: {
  measured: TemporalDynamismEvidence;
  openingFrozenHoldSec: number;
  maxOpeningFrozenHoldSec: number;
  fps: number;
}): TemporalDynamismInterval[] {
  const openingInterval = args.measured.evaluatedIntervals.find(
    (interval) => interval.startSec <= 1 / args.fps + 0.05,
  );
  const openingViolation = args.openingFrozenHoldSec > args.maxOpeningFrozenHoldSec + 0.05;
  if (!openingViolation || !openingInterval) return args.measured.violatingIntervals;
  const alreadyListed = args.measured.violatingIntervals.some((interval) =>
    Math.abs(interval.startSec - openingInterval.startSec) < 0.001 &&
    Math.abs(interval.endSec - openingInterval.endSec) < 0.001,
  );
  return alreadyListed ? args.measured.violatingIntervals : [...args.measured.violatingIntervals, openingInterval];
}

/**
 * Deterministic precondition for the H3 cinematic reviewer. It is deliberately
 * separate from subjective frame grading: three attractive samples cannot
 * conceal a 1–2 second static opening between them.
 */
export function measureMiniMaxH3OpeningMotionQa(args: {
  videoPath: string;
  durationSec: number;
  fps: number;
}): MiniMaxH3OpeningMotionQaResult {
  if (!Number.isFinite(args.durationSec) || args.durationSec <= 0) {
    throw new Error("MiniMax H3 opening-motion QA requires a positive measured duration");
  }
  if (!Number.isInteger(args.fps) || args.fps <= 0) {
    throw new Error("MiniMax H3 opening-motion QA requires a positive integer frame rate");
  }
  const maxStaticHoldSec = args.durationSec * MINIMAX_H3_MAX_STATIC_FRACTION;
  const measured = measureTemporalDynamism({
    videoPath: args.videoPath,
    durationSec: args.durationSec,
    maxStaticHoldSec,
  });
  if (measured.verdict === "not_required") {
    throw new Error("MiniMax H3 opening-motion QA cannot disable motion evidence");
  }
  const maxOpeningFrozenHoldSec = Math.min(
    maxStaticHoldSec,
    MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC,
  );
  const observedOpeningFrozenHoldSec = openingFrozenHoldSec(measured, args.fps);
  const violatingIntervals = withOpeningViolation({
    measured,
    openingFrozenHoldSec: observedOpeningFrozenHoldSec,
    maxOpeningFrozenHoldSec,
    fps: args.fps,
  });
  return {
    contract: MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
    source: measured.source,
    verdict: measured.verdict === "unavailable"
      ? "unavailable"
      : violatingIntervals.length ? "fail" : "pass",
    durationSec: args.durationSec,
    maxFreezeFraction: MINIMAX_H3_MAX_STATIC_FRACTION,
    maxStaticHoldSec,
    maxOpeningFrozenHoldSec,
    maxFrozenHoldSec: measured.maxFrozenHoldSec,
    openingFrozenHoldSec: observedOpeningFrozenHoldSec,
    frozenIntervals: measured.frozenIntervals,
    violatingIntervals,
    ...(measured.detail ? { detail: measured.detail } : {}),
  };
}

/**
 * Make the policy boundary reusable without letting callers accidentally treat
 * an unavailable detector or a failing measurement as a passing receipt.
 */
export function assertMiniMaxH3OpeningMotionQa(args: {
  videoPath: string;
  durationSec: number;
  fps: number;
  label: string;
}): MiniMaxH3OpeningMotionQaEvidence {
  const result = measureMiniMaxH3OpeningMotionQa(args);
  if (result.verdict === "pass") return result;
  if (result.verdict === "unavailable") {
    throw new Error(
      `${args.label} cannot verify opening motion with ffmpeg/freezedetect` +
      (result.detail ? ` (${result.detail})` : ""),
    );
  }
  throw new MiniMaxH3OpeningMotionRejectedError(result, args.label);
}
