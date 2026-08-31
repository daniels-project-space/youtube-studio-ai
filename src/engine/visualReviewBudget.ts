/**
 * Shared final-review limits. These values are a provider contract, not a
 * quality preference: a receipt may only name frames that reached the vision
 * provider in the same request.
 */
export const NON_GOOGLE_VISION_MAX_IMAGES_PER_REQUEST = 8;

/**
 * The final release reviewer is a slower, high-reasoning Qwen route. Two
 * frames keep its structured receipt inside the bounded response window in
 * production; eight remains the provider's hard transport maximum for other
 * non-Google vision uses. Cost admission must use this operational cap.
 */
export const FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST = 2;

export const QA_VISUAL_REVIEW_MIN_FRAMES = 8;
export const QA_VISUAL_REVIEW_DEFAULT_BROAD_FRAMES = 48;
export const QA_VISUAL_REVIEW_MAX_BROAD_FRAMES = 72;
export const QA_VISUAL_REVIEW_DEFAULT_FOCUS_FRAMES = 24;
export const QA_VISUAL_REVIEW_MAX_FOCUS_FRAMES = 36;

/**
 * Complete 2fps review is intentionally bounded before frame extraction. A
 * larger request must be admitted with a larger explicit envelope; it may not
 * turn into an unbounded local extraction/provider loop.
 */
export const COMPLETE_VISUAL_REVIEW_MAX_FRAMES = 1_000;

export interface QaVisualReviewFrameLimits {
  broadFrames: number;
  focusFrames: number;
}

export interface CompleteVisualReviewWindow {
  startSec: number;
  endSec: number;
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundedTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function configuredFrameLimit(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < QA_VISUAL_REVIEW_MIN_FRAMES || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${QA_VISUAL_REVIEW_MIN_FRAMES} and ${maximum}; ` +
        "refusing to silently change requested final-review coverage",
    );
  }
  return parsed;
}

/**
 * The exact accepted final-QA frame caps. Both pricing and qa_visual execution
 * use this parser so an invalid/high raw parameter fails before a provider can
 * run rather than receiving more review calls than were reserved.
 */
export function qaVisualReviewFrameLimits(
  params: Readonly<Record<string, unknown>>,
): QaVisualReviewFrameLimits {
  return {
    broadFrames: configuredFrameLimit(
      params["visualReviewFrames"],
      QA_VISUAL_REVIEW_DEFAULT_BROAD_FRAMES,
      QA_VISUAL_REVIEW_MAX_BROAD_FRAMES,
      "visualReviewFrames",
    ),
    focusFrames: configuredFrameLimit(
      params["visualReviewFocusFrames"],
      QA_VISUAL_REVIEW_DEFAULT_FOCUS_FRAMES,
      QA_VISUAL_REVIEW_MAX_FOCUS_FRAMES,
      "visualReviewFocusFrames",
    ),
  };
}

export function visualReviewProviderBatchCount(frameCount: unknown): number {
  const frames = Number(frameCount);
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error("visual-review provider frame count must be a non-negative integer");
  }
  return Math.ceil(frames / FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST);
}

/**
 * Broad frames are reviewed first; regular/reactive and sealed-complete focus
 * frames share the second pass. This is the largest possible provider-call
 * count for the supplied frame authority, without relying on overlap luck.
 */
export function qaVisualReviewProviderCallCount(args: {
  broadFrames: number;
  focusFrames: number;
  completeFocusFrames?: number;
}): number {
  const completeFocusFrames = args.completeFocusFrames ?? 0;
  return (
    visualReviewProviderBatchCount(args.broadFrames) +
    visualReviewProviderBatchCount(args.focusFrames + completeFocusFrames)
  );
}

/**
 * The authoritative 2fps schedule for a sealed focus plan. It mirrors the
 * reviewer's timestamp normalization/merge rules and rejects, rather than
 * truncating, a plan beyond the hard safety bound.
 */
export function completeVisualReviewFocusTimes(
  durationSec: unknown,
  windows: readonly CompleteVisualReviewWindow[],
  maxFrames = COMPLETE_VISUAL_REVIEW_MAX_FRAMES,
): number[] {
  const duration = Math.max(0, finite(durationSec, 0));
  if (!Number.isInteger(maxFrames) || maxFrames < 1) {
    throw new Error("complete visual-review frame cap must be a positive integer");
  }
  const normalized = windows
    .map((window) => {
      const startSec = clamp(finite(window.startSec, 0), 0, duration);
      const endSec = clamp(finite(window.endSec, startSec), startSec, duration);
      return { startSec, endSec };
    })
    .sort((left, right) => left.startSec - right.startSec);
  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const window of normalized) {
    const prior = merged.at(-1);
    if (prior && window.startSec <= prior.endSec + 0.35) {
      prior.endSec = Math.max(prior.endSec, window.endSec);
    } else {
      merged.push({ ...window });
    }
  }
  const candidates = new Map<string, number>();
  const add = (raw: number) => {
    const tSec = clamp(roundedTenth(raw), 0, duration);
    candidates.set(tSec.toFixed(1), tSec);
    if (candidates.size > maxFrames) {
      throw new Error(
        `complete visual-review focus plan exceeds its ${maxFrames}-frame safety limit; ` +
          "refusing to silently downsample or start an unbounded review loop",
      );
    }
  };
  for (const window of merged) {
    for (let tSec = window.startSec; tSec <= window.endSec + 0.001; tSec += 0.5) add(tSec);
    add(window.endSec);
  }
  return [...candidates.values()].sort((left, right) => left - right);
}
