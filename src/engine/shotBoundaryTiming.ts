/**
 * Pure shot-boundary timing math shared by every per-shot duration
 * generator (Story Spine's default per-narration path and the
 * Casefile-only cinematic coverage draft). These functions only ever
 * consume and produce `t0`/`t1` timing on caller-supplied items; they
 * never read or assign citation, claim, or evidence-treatment
 * semantics. Any Casefile-specific field (onScreenCitation, claimIds,
 * coveragePurpose assignment, evidence-map treatment, etc.) is decided
 * separately by the caller after boundaries are chosen here.
 */

// The locked LTX profile renders 3-10 second source clips. A coverage
// beat therefore needs enough narrated runway for three purposeful
// shots; beats with twelve or more seconds earn a fourth
// consequence/reaction cut. Generating 1-2 second clips and trimming
// them in assembly is neither cinematic nor a truthful use of the
// approved cut plan.
export const MIN_LTX_SHOT_SEC = 3;
export const MIN_CINEMATIC_BEAT_SEC = MIN_LTX_SHOT_SEC * 3;
export const FOUR_SHOT_CINEMATIC_BEAT_SEC = MIN_LTX_SHOT_SEC * 4;
export const TARGET_CINEMATIC_BEAT_SEC = 12;

export interface TimedItem {
  readonly t0: number;
  readonly t1: number;
}

/**
 * Groups contiguous timed items (already-planned shots or raw sentence
 * intervals) into causal beat windows before assigning shot coverage.
 * Source timing can contain very short windows; the render target
 * cannot. Accumulate items until a window reaches
 * TARGET_CINEMATIC_BEAT_SEC, then merge a short tail back into its
 * predecessor. This preserves exact input boundaries without
 * manufacturing sub-MIN_LTX_SHOT_SEC clips.
 *
 * Throws if the total input duration is below MIN_CINEMATIC_BEAT_SEC
 * (there is nothing to merge a lone short window into). Callers whose
 * total input duration may be shorter than MIN_CINEMATIC_BEAT_SEC
 * should check that before calling, since this is otherwise the only
 * condition under which this function throws.
 */
export function causalBeatWindows<T extends TimedItem>(orderedItems: readonly T[]): T[][] {
  const windows: T[][] = [];
  let current: T[] = [];
  let currentDuration = 0;

  for (const item of orderedItems) {
    current.push(item);
    currentDuration += item.t1 - item.t0;
    if (currentDuration >= TARGET_CINEMATIC_BEAT_SEC) {
      windows.push(current);
      current = [];
      currentDuration = 0;
    }
  }
  if (current.length) windows.push(current);

  const durationOf = (items: readonly T[]) =>
    items.reduce((total, item) => total + (item.t1 - item.t0), 0);
  if (windows.length >= 2 && durationOf(windows.at(-1)!) < MIN_CINEMATIC_BEAT_SEC) {
    windows[windows.length - 2]!.push(...windows.pop()!);
  }
  if (windows.some((window) => durationOf(window) < MIN_CINEMATIC_BEAT_SEC)) {
    throw new Error(
      `cinematic draft: each causal beat needs at least ${MIN_CINEMATIC_BEAT_SEC}s of contiguous narration ` +
        `for three ${MIN_LTX_SHOT_SEC}s LTX coverage shots; merge or extend the source Story Spine before cinematic planning`,
    );
  }
  return windows;
}

/**
 * Divide a narration window into renderable takes without a blind equal
 * split. The evidence/action insert gets a controlled readable hold;
 * the final consequence cut receives the remaining visual breath. At
 * exactly the minimum supportable window size every take remains the
 * locked MIN_LTX_SHOT_SEC floor.
 *
 * Safe to call whenever `t1 - t0 >= MIN_LTX_SHOT_SEC * coverageCount`
 * (guaranteed by pickCoverageCount's threshold together with
 * MIN_CINEMATIC_BEAT_SEC-gated windows from causalBeatWindows).
 */
export function coverageBoundaries(t0: number, t1: number, coverageCount: 3 | 4): number[] {
  const duration = t1 - t0;
  const flexibleDuration = duration - MIN_LTX_SHOT_SEC * coverageCount;
  const weights = coverageCount === 4
    ? [0.22, 0.31, 0.21, 0.26]
    : [0.29, 0.38, 0.33];
  const boundaries = [t0];
  let cursor = t0;
  for (let slot = 0; slot < coverageCount - 1; slot++) {
    cursor += MIN_LTX_SHOT_SEC + flexibleDuration * weights[slot]!;
    boundaries.push(Number(cursor.toFixed(3)));
  }
  boundaries.push(t1);
  return boundaries;
}

/**
 * Picks the 3- or 4-shot coverage grammar for a window's duration: a
 * window long enough to also carry a fourth consequence/reaction cut
 * earns it, otherwise three shots share the window.
 */
export function pickCoverageCount(durationSec: number): 3 | 4 {
  return durationSec >= FOUR_SHOT_CINEMATIC_BEAT_SEC ? 4 : 3;
}
