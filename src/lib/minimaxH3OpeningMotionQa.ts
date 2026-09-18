import {
  MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
  type MiniMaxH3OpeningMotionQaEvidence,
} from "@/engine/cinematicClipReview";
import {
  measureOpeningFrameDelta,
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
  type TemporalDynamismInterval,
} from "@/lib/temporalDynamism";

/**
 * H3 shots are image-conditioned. They may look correct in a still while
 * holding the conditioning image for the first beat, so the cinematic gate
 * independently requires visible motion within one decoded 4fps interval.
 */
/**
 * At H3's native 24 fps this permits only the source frame plus one adjacent
 * decoded frame before visible displacement is required. It is deliberately
 * shorter than the general static-hold budget: an opening conditioning-image
 * pause is a transport/model defect, not a creative beat.
 */
export const MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC = 0.125;
export const MINIMAX_H3_MAX_STATIC_FRACTION = 0.1;
export const MINIMAX_H3_OPENING_MOTION_SAMPLE_FPS = 24;
export const MINIMAX_H3_MIN_OPENING_FRAME_DELTA = 0.002;
const MINIMAX_H3_SEED_MODULUS = 2_147_483_648;
const MINIMAX_H3_OPENING_MOTION_REPAIR_SEED_OFFSET = 104_729;

/**
 * H3 accepts the supplied image as its opening frame. Make the first moving
 * beat explicit and identical across every H3 caller so one legacy pathway
 * cannot quietly reintroduce a static conditioning-image hold.
 */
export const MINIMAX_H3_IMMEDIATE_MOTION_PROMPT =
  "MANDATORY MOTION TIMING: at 0.00 seconds, begin the authored subject action and camera displacement. " +
  "By 0.125 seconds the image must visibly advance beyond the conditioning frame. " +
  "Do not hold the input image, use a static establishing beat, freeze, or delay movement.";

/**
 * A static opening is a deterministic defect, not a reason to perturb an
 * approved conditioning image.  A bounded repair therefore keeps that exact
 * R2 frame and all creative locks, but must not reuse the rejected sample's
 * seed: an otherwise deterministic worker can simply emit the same hold.
 *
 * This offset is stable across replay and stays inside the 32-bit H3 seed
 * contract. It intentionally changes only retry entropy, never the original
 * request identity or the channel's continuity seed.
 */
export function miniMaxH3OpeningMotionRepairSeed(seed: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed >= MINIMAX_H3_SEED_MODULUS) {
    throw new Error("MiniMax H3 opening-motion repair requires a non-negative 32-bit seed");
  }
  return (seed + MINIMAX_H3_OPENING_MOTION_REPAIR_SEED_OFFSET) % MINIMAX_H3_SEED_MODULUS;
}

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
  const sampleFps = Math.min(args.fps, MINIMAX_H3_OPENING_MOTION_SAMPLE_FPS);
  const maxStaticHoldSec = args.durationSec * MINIMAX_H3_MAX_STATIC_FRACTION;
  const measured = measureTemporalDynamism({
    videoPath: args.videoPath,
    durationSec: args.durationSec,
    maxStaticHoldSec,
    sampleFps,
  });
  if (measured.verdict === "not_required") {
    throw new Error("MiniMax H3 opening-motion QA cannot disable motion evidence");
  }
  const maxOpeningFrozenHoldSec = Math.min(
    maxStaticHoldSec,
    MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC,
  );
  const frameDelta = measureOpeningFrameDelta({
    videoPath: args.videoPath,
    durationSec: args.durationSec,
    sampleFps,
    minDelta: MINIMAX_H3_MIN_OPENING_FRAME_DELTA,
  });
  const observedOpeningFrozenHoldSec = Math.max(
    openingFrozenHoldSec(measured, sampleFps),
    frameDelta.verdict === "fail" ? frameDelta.comparisonOffsetSec : 0,
  );
  const freezeViolations = withOpeningViolation({
    measured,
    openingFrozenHoldSec: observedOpeningFrozenHoldSec,
    maxOpeningFrozenHoldSec,
    fps: sampleFps,
  });
  const frameDeltaInterval = frameDelta.verdict === "fail"
    ? {
        startSec: 0,
        endSec: frameDelta.comparisonOffsetSec,
        durationSec: frameDelta.comparisonOffsetSec,
      }
    : undefined;
  const violatingIntervals = frameDeltaInterval && !freezeViolations.some((interval) => interval.startSec < 0.001)
    ? [...freezeViolations, frameDeltaInterval]
    : freezeViolations;
  const detail = [
    measured.detail,
    frameDelta.verdict === "unavailable"
      ? `opening-frame SSIM unavailable: ${frameDelta.detail ?? "unknown FFmpeg failure"}`
      : `opening-frame SSIM delta=${frameDelta.delta.toFixed(6)} (minimum ${frameDelta.minDelta.toFixed(6)}) at ${frameDelta.comparisonOffsetSec.toFixed(3)}s`,
  ].filter((part): part is string => Boolean(part)).join("; ");
  return {
    contract: MINIMAX_H3_OPENING_MOTION_QA_CONTRACT,
    source: "ffmpeg/freezedetect+ssim",
    verdict: measured.verdict === "unavailable" || frameDelta.verdict === "unavailable"
      ? "unavailable"
      : violatingIntervals.length ? "fail" : "pass",
    durationSec: args.durationSec,
    maxFreezeFraction: MINIMAX_H3_MAX_STATIC_FRACTION,
    maxStaticHoldSec,
    maxOpeningFrozenHoldSec,
    maxFrozenHoldSec: Math.max(measured.maxFrozenHoldSec, frameDeltaInterval?.durationSec ?? 0),
    openingFrozenHoldSec: observedOpeningFrozenHoldSec,
    frozenIntervals: measured.frozenIntervals,
    violatingIntervals,
    ...(detail ? { detail } : {}),
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
