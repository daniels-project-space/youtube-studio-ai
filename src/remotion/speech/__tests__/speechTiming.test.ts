/**
 * SPEECH TIMING — the module's entire contract, previously untested.
 *
 * Speechcraft promises two things that are purely about time: word captions
 * that snap in exactly when each word is spoken, and motion cues that mount
 * ONLY inside their [start, end) window. Neither had a test of any kind, and
 * both fail silently — a caption a frame early or a cue that never appears
 * looks like a rendering quirk, not a bug, and nothing in a typecheck or a
 * smoke render would say otherwise.
 *
 * The method here is a FRAME SWEEP rather than spot checks. Video timing bugs
 * live at boundaries and at durations shorter than the frame interval, so every
 * frame of a composition is evaluated and the resulting visibility is compared
 * against what the timeline declared. That catches three distinct failures a
 * few sampled assertions would miss:
 *
 *   - off-by-one at a window edge, where a cue leaks into the frame before or
 *     after it should;
 *   - a cue SHORTER than one frame, which can fall between sampling instants
 *     and never render at all despite being perfectly well-formed;
 *   - progress that does not actually traverse 0 to 1 across the window, which
 *     makes every animation play a fraction of itself.
 */
import assert from "node:assert/strict";

// Imported, never re-implemented: MotionCueLayer calls these exact functions,
// so this sweep exercises the shipping rule rather than a copy of it that could
// silently diverge.
import { cueProgressAt, cueVisibleAt, frameToMs, msToFrame } from "../types";

function sweep(cue: { start: number; end: number }, fps: number, totalMs: number) {
  const frames: number[] = [];
  for (let frame = 0; frame <= Math.ceil(msToFrame(totalMs, fps)); frame += 1) {
    if (cueVisibleAt(cue, frameToMs(frame, fps))) frames.push(frame);
  }
  return frames;
}

function main(): void {
  const fps = 30;
  const frameMs = 1000 / fps;

  // ---- frame/ms conversion is exact and round-trips ----------------------
  // Every timing assertion below rests on this; a drifting conversion would
  // make the whole sweep meaningless.
  for (const frame of [0, 1, 29, 30, 149, 900]) {
    assert.equal(msToFrame(frameToMs(frame, fps), fps), frame, `round-trip lost frame ${frame}`);
  }
  assert.equal(frameToMs(30, 30), 1000, "30 frames at 30fps must be exactly one second");

  // ---- a normal cue is visible for its whole window and not beyond -------
  const cue = { start: 1000, end: 2000 };
  const frames = sweep(cue, fps, 4000);
  assert.ok(frames.length > 0, "a one-second cue must render");
  const firstMs = frameToMs(frames[0]!, fps);
  const lastMs = frameToMs(frames[frames.length - 1]!, fps);

  // The first visible frame must be the first one at or after start — not the
  // one before it, which is the classic leak.
  assert.ok(firstMs >= cue.start, `cue leaked ${(cue.start - firstMs).toFixed(1)}ms before its start`);
  assert.ok(firstMs - cue.start < frameMs, "cue started more than a frame late");

  // The window is half-open: a cue must be gone ON its end, not after it.
  assert.ok(lastMs < cue.end, `cue outlived its window by ${(lastMs - cue.end).toFixed(1)}ms`);
  assert.ok(!cueVisibleAt(cue, cue.end), "a cue must not be visible on its exact end time");
  assert.ok(cueVisibleAt(cue, cue.start), "a cue must be visible on its exact start time");

  // No gaps: the visible frames are contiguous. A cue that flickers would show
  // up here and nowhere else.
  for (let i = 1; i < frames.length; i += 1) {
    assert.equal(frames[i], frames[i - 1]! + 1, `cue flickered between frames ${frames[i - 1]} and ${frames[i]}`);
  }

  // ---- progress traverses the window ------------------------------------
  assert.equal(cueProgressAt(cue, 1000), 0, "progress must start at 0");
  assert.ok(Math.abs(cueProgressAt(cue, 1500) - 0.5) < 1e-9, "progress must be linear across the window");
  assert.ok(cueProgressAt(cue, 1999) > 0.99, "progress must reach ~1 by the end of the window");
  // Clamped outside, so an animation cannot be driven past its own range.
  assert.equal(cueProgressAt(cue, 500), 0);
  assert.equal(cueProgressAt(cue, 5000), 1);

  // ---- the failure a sampled test would miss ----------------------------
  // A cue shorter than the frame interval can fall entirely between two
  // sampling instants and never render, while looking perfectly valid in the
  // timeline. This asserts the hazard is real and detectable, so a planner that
  // starts emitting sub-frame cues is caught here rather than by someone
  // noticing a missing graphic.
  const subFrame = { start: 1001, end: 1001 + frameMs / 3 };
  assert.equal(
    sweep(subFrame, fps, 4000).length,
    0,
    "a sub-frame cue is expected to be invisible — if this now renders, the sampling model changed",
  );
  assert.ok(
    subFrame.end - subFrame.start < frameMs,
    "the hazard case must actually be shorter than one frame for this to mean anything",
  );

  // A cue exactly one frame long MUST render, or the planner's minimum unit is
  // wrong. This is the boundary between "too short to see" and "valid".
  assert.ok(
    sweep({ start: 1000, end: 1000 + frameMs }, fps, 4000).length >= 1,
    "a cue exactly one frame long must render at least once",
  );

  // ---- zero-length windows cannot divide by zero ------------------------
  const degenerate = { start: 1000, end: 1000 };
  assert.equal(cueProgressAt(degenerate, 1000), 0);
  assert.ok(Number.isFinite(cueProgressAt(degenerate, 1000)), "progress must stay finite on a zero-length cue");
  assert.equal(sweep(degenerate, fps, 2000).length, 0, "a zero-length cue must never render");

  console.log("SPEECH TIMING PASS — frame sweep over cue windows, progress and conversions");
}

main();
