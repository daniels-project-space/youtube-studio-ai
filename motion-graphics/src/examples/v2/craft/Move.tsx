/**
 * Move.tsx — REAL 180° motion blur for fast moves.
 *
 * The robotic look of code-animation comes partly from ZERO motion blur: a fast
 * slide renders as a series of perfectly sharp positions, which the eye reads as
 * stuttering teleportation. Real cameras integrate light over the shutter (~180°
 * = half the frame interval), smearing fast motion. We reproduce that with
 * @remotion/motion-blur:
 *
 *   <CameraMotionBlur shutterAngle={180} samples={12}>  ...children...  </CameraMotionBlur>
 *
 * CameraMotionBlur re-renders its children at SUB-FRAME time offsets across the
 * shutter window and averages them, so any transform driven by useCurrentFrame
 * (our snapIn / overshoot moves) gets a true integrated smear. samples≈12 is the
 * quality/cost knee — it multiplies render cost ~12x for whatever it wraps, so we
 * wrap ONLY the moving words, never the static background.
 *
 * <BlurMove> is the per-element wrapper. <BlurTrail> is a cheaper ghosting
 * alternative (Trail) for cases where full sub-frame integration is overkill.
 *
 * Deterministic: CameraMotionBlur samples at fixed sub-frame offsets — identical
 * pixels every render.
 */
import React from "react";
import { CameraMotionBlur, Trail } from "@remotion/motion-blur";

export interface BlurMoveProps {
  /** Shutter angle in degrees. 180 = cinematic standard. */
  shutterAngle?: number;
  /** Sub-frame samples. ~12 = quality knee; higher = smoother but slower. */
  samples?: number;
  children: React.ReactNode;
}

/**
 * BlurMove — wraps fast-moving children in true 180° sub-frame motion blur.
 * Keep the wrapped subtree SMALL (one word) — cost scales with samples × subtree.
 */
export const BlurMove: React.FC<BlurMoveProps> = ({
  shutterAngle = 180,
  samples = 12,
  children,
}) => (
  <CameraMotionBlur shutterAngle={shutterAngle} samples={samples}>
    {children}
  </CameraMotionBlur>
);

export interface BlurTrailProps {
  layers?: number;
  lagInFrames?: number;
  trailOpacity?: number;
  children: React.ReactNode;
}

/**
 * BlurTrail — ITER 2: this is now the PRIMARY smear wrapper for moving words.
 *
 * Iter1 used CameraMotionBlur but the smear was invisible because the per-word
 * moves were only ~20px — sub-frame integration of a 20px slide produces a smear
 * narrower than one glyph stroke, so it read as sharp. Iter2 fixes the ROOT
 * cause two ways: (1) the hero entrance travel is now ~200–260px over ~6–8
 * frames (high velocity), and (2) we render a directional GHOST TRAIL — N decaying
 * copies of the word at its PAST positions — which is both cheaper than
 * CameraMotionBlur and far more visible because the ghosts are spread across the
 * full travel distance, not just the half-frame shutter window.
 *
 * Defaults: layers 6, lagInFrames 1, trailOpacity 0.5 → a 6-frame decaying tail.
 * Over a ~40px/frame hero entrance that's a ~240px streak — clearly readable in
 * a dense-frame check. Deterministic (Trail samples fixed past frames).
 */
export const BlurTrail: React.FC<BlurTrailProps> = ({
  layers = 6,
  lagInFrames = 1,
  trailOpacity = 0.5,
  children,
}) => (
  <Trail layers={layers} lagInFrames={lagInFrames} trailOpacity={trailOpacity}>
    {children}
  </Trail>
);
