/**
 * eases.ts — motion-craft easing presets (ITERATION 1).
 *
 * The whole point: kill the near-linear, robotic feel of hand-coded motion.
 * Every preset here is ASYMMETRIC (fast attack, slow settle) and most include
 * a real spring overshoot so elements punch past their target and settle back —
 * the thing After-Effects animators do by hand and code animation usually skips.
 *
 * All functions are PURE and FRAME-DETERMINISTIC: output depends only on
 * (frame, start, dur[, fps]). No Math.random / Date / wall-clock.
 *
 * Each easing returns a normalized 0..1 progress. The `*WithVelocity` helpers
 * additionally return a per-frame finite-difference velocity so callers can
 * scale motion-blur / stretch by instantaneous speed.
 */
import { Easing, spring } from "remotion";

/* ------------------------------------------------------------------ */
/* Raw bezier curves (the "feel" library)                              */
/* ------------------------------------------------------------------ */

/** Fast in, hard settle — the classic "snap into place". */
export const SNAP_IN_BEZIER = Easing.bezier(0.16, 1, 0.3, 1);
/** Expo-out — extremely front-loaded, glides to a near-stop. */
export const EXPO_OUT_BEZIER = Easing.bezier(0.19, 1, 0.22, 1);
/** Anticipation curve — dips slightly negative before launching. */
export const ANTICIPATE_BEZIER = Easing.bezier(0.36, 0, 0.66, -0.4);

/* ------------------------------------------------------------------ */
/* Progress helpers: (frame, start, dur) -> 0..1                        */
/* ------------------------------------------------------------------ */

/** Clamp a raw 0..1 (or beyond) into [0,1]. */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear local time within a window, clamped to [0,1]. */
export const localT = (frame: number, start: number, dur: number): number =>
  clamp01((frame - start) / Math.max(1, dur));

/** snapIn progress — fast in, hard settle. */
export const snapIn = (frame: number, start: number, dur: number): number =>
  SNAP_IN_BEZIER(localT(frame, start, dur));

/** expoOut progress — front-loaded glide. */
export const expoOut = (frame: number, start: number, dur: number): number =>
  EXPO_OUT_BEZIER(localT(frame, start, dur));

/**
 * anticipate — small back-up (returns a SIGNED value that can dip below 0)
 * before launching to 1. Multiply a launch distance by (1 - this) to get the
 * little wind-up before the move.
 */
export const anticipate = (frame: number, start: number, dur: number): number =>
  ANTICIPATE_BEZIER(localT(frame, start, dur));

/* ------------------------------------------------------------------ */
/* Spring overshoot (peaks ~1.08, settles to 1)                         */
/* ------------------------------------------------------------------ */

/**
 * ITER 2: lower damping (10) → the spring peaks HIGHER and the overshoot is
 * visible across several frames before settling. With damping 10 / stiffness
 * 150 / mass 0.8 the raw spring peaks ≈1.18 (vs ~1.08 at damping 12), so when
 * we lerp from 0.8→1 the scale punches to ~1.0 + 0.2*0.18 ≈ 1.036... — too weak.
 * Instead we scale the spring's OVERSHOOT band directly (see overshootScale).
 */
export const OVERSHOOT_CONFIG = { damping: 10, stiffness: 150, mass: 0.8 } as const;

/**
 * overshoot — spring()-based value that rises from 0, peaks ~1.18 (damping 10),
 * and settles to 1.
 */
export const overshoot = (
  frame: number,
  start: number,
  fps: number,
): number =>
  spring({
    frame: frame - start,
    fps,
    config: OVERSHOOT_CONFIG,
  });

/**
 * overshootScale — ITER 2: explicit 3-keyframe scale so the punch is REALLY
 * visible: starts at `from` (0.8), drives to `peak` (1.12) at the spring's crest,
 * then settles to 1.0. We use the raw spring value `s` (0→~1.18→1) as the driver
 * but remap it onto from→peak→1 so the perceptible overshoot is a fixed 12%
 * regardless of the spring's exact crest. `s` rising 0→1 maps from→peak; the
 * subsequent settle 1.18→1 of the spring maps peak→1.
 */
export const overshootScale = (
  frame: number,
  start: number,
  fps: number,
  from = 0.8,
  peak = 1.12,
): number => {
  const s = overshoot(frame, start, fps); // 0 → ~1.18 → 1
  if (s <= 1) {
    // launch phase: from → peak
    return from + (peak - from) * s;
  }
  // overshoot/settle phase: spring is in (1, ~1.18]; map that band peak → 1.
  // crest≈1.18 → scale=peak ; spring=1 → scale=1.
  const crest = 1.18;
  const k = (s - 1) / Math.max(0.0001, crest - 1); // 0..1 over the overshoot band
  return 1 + (peak - 1) * k;
};

/* ------------------------------------------------------------------ */
/* Velocity-aware helpers (finite difference)                           */
/* ------------------------------------------------------------------ */

export interface Motion {
  /** 0..1 (or beyond, for overshoot) progress at this frame. */
  value: number;
  /** dValue/dframe estimated by central finite difference. */
  velocity: number;
}

/**
 * motionWithVelocity — sample any progress fn at frame-1 / frame / frame+1 and
 * return both the value and a central-difference velocity. Callers scale
 * motion-blur samples or a stretch factor by |velocity|.
 */
export const motionWithVelocity = (
  fn: (f: number) => number,
  frame: number,
): Motion => {
  const prev = fn(frame - 1);
  const cur = fn(frame);
  const next = fn(frame + 1);
  return { value: cur, velocity: (next - prev) / 2 };
};

/** snapIn value+velocity at a frame. */
export const snapInWithVelocity = (
  frame: number,
  start: number,
  dur: number,
): Motion => motionWithVelocity((f) => snapIn(f, start, dur), frame);

/** expoOut value+velocity at a frame. */
export const expoOutWithVelocity = (
  frame: number,
  start: number,
  dur: number,
): Motion => motionWithVelocity((f) => expoOut(f, start, dur), frame);

/** overshootScale value+velocity at a frame. */
export const overshootScaleWithVelocity = (
  frame: number,
  start: number,
  fps: number,
  from = 0.8,
  peak = 1.12,
): Motion =>
  motionWithVelocity((f) => overshootScale(f, start, fps, from, peak), frame);

/**
 * speedToShutter — map an instantaneous |velocity| (in normalized-units/frame
 * or px/frame) to a useful shutter-ish 0..1 intensity for blur scaling.
 * Saturates so very fast frames don't blow out.
 */
export const speedToIntensity = (velocity: number, scale = 8): number =>
  clamp01(Math.abs(velocity) * scale);
