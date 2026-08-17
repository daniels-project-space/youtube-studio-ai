import assert from "node:assert/strict";

import {
  causalBeatWindows,
  coverageBoundaries,
  pickCoverageCount,
  FOUR_SHOT_CINEMATIC_BEAT_SEC,
  MIN_CINEMATIC_BEAT_SEC,
  MIN_LTX_SHOT_SEC,
  TARGET_CINEMATIC_BEAT_SEC,
} from "../shotBoundaryTiming";

// Constants stay in the documented relationship other modules rely on.
assert.equal(TARGET_CINEMATIC_BEAT_SEC, 12);
assert.equal(MIN_CINEMATIC_BEAT_SEC, MIN_LTX_SHOT_SEC * 3);
assert.equal(FOUR_SHOT_CINEMATIC_BEAT_SEC, MIN_LTX_SHOT_SEC * 4);

// Scenario: a short beat window (below MIN_CINEMATIC_BEAT_SEC) has nothing
// to merge a lone short window into and must fail closed rather than
// silently producing sub-floor clips.
assert.throws(
  () => causalBeatWindows([{ t0: 0, t1: 5 }]),
  /at least 9s of contiguous narration/,
  "a single window shorter than MIN_CINEMATIC_BEAT_SEC must throw",
);
assert.throws(
  () => causalBeatWindows([{ t0: 0, t1: 2 }, { t0: 2, t1: 5 }]),
  /at least 9s of contiguous narration/,
  "a run of short items that never reaches MIN_CINEMATIC_BEAT_SEC must throw even split across several items",
);

// Scenario: a beat exactly at the 3-shot floor (MIN_CINEMATIC_BEAT_SEC)
// degenerates to three exactly-equal MIN_LTX_SHOT_SEC shots -- the
// zero-slack edge of the weighted formula.
{
  const windows = causalBeatWindows([{ t0: 0, t1: MIN_CINEMATIC_BEAT_SEC }]);
  assert.equal(windows.length, 1);
  const coverageCount = pickCoverageCount(MIN_CINEMATIC_BEAT_SEC);
  assert.equal(coverageCount, 3);
  const boundaries = coverageBoundaries(0, MIN_CINEMATIC_BEAT_SEC, coverageCount);
  assert.deepEqual(boundaries, [0, 3, 6, 9]);
  for (let i = 1; i < boundaries.length; i++) {
    assert.ok(boundaries[i]! - boundaries[i - 1]! >= MIN_LTX_SHOT_SEC - 1e-9, "every shot must respect the LTX floor");
  }
}

// Scenario: a beat long enough on its own for a weighted 4-shot split
// produces genuinely non-uniform durations, not an equal division, while
// still spanning exactly the source window and respecting the floor.
{
  const t0 = 100;
  const t1 = 115;
  const windows = causalBeatWindows([{ t0, t1 }]);
  assert.equal(windows.length, 1, "a single item at least TARGET_CINEMATIC_BEAT_SEC long is already its own window");
  const coverageCount = pickCoverageCount(t1 - t0);
  assert.equal(coverageCount, 4);
  const boundaries = coverageBoundaries(t0, t1, coverageCount);
  assert.equal(boundaries.length, 5);
  assert.equal(boundaries[0], t0);
  assert.equal(boundaries[4], t1);
  const durations = boundaries.slice(1).map((b, i) => Number((b - boundaries[i]!).toFixed(3)));
  assert.equal(durations.length, 4);
  const uniqueDurations = new Set(durations);
  assert.ok(uniqueDurations.size > 1, "a weighted split with slack must not degrade to an equal division");
  for (const duration of durations) {
    assert.ok(duration >= MIN_LTX_SHOT_SEC - 1e-9, "every shot must respect the LTX floor");
  }
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  assert.ok(Math.abs(total - (t1 - t0)) < 1e-2, "boundaries must exactly span the source window");
}

// Scenario: a long run of small items needing multiple windows, including
// the short-trailing-window-merges-into-its-predecessor behaviour.
{
  const items = [
    { t0: 0, t1: 12 },
    { t0: 12, t1: 24 },
    { t0: 24, t1: 27 },
  ];
  const windows = causalBeatWindows(items);
  assert.equal(windows.length, 2, "a short trailing window must merge into its predecessor rather than stand alone");
  assert.equal(windows[0]!.length, 1);
  assert.equal(windows[1]!.length, 2, "the short 3s tail merges into the second window");
  const windowDurations = windows.map((window) => window.at(-1)!.t1 - window[0]!.t0);
  assert.deepEqual(windowDurations, [12, 15]);

  for (const window of windows) {
    const wt0 = window[0]!.t0;
    const wt1 = window.at(-1)!.t1;
    const coverageCount = pickCoverageCount(wt1 - wt0);
    const boundaries = coverageBoundaries(wt0, wt1, coverageCount);
    assert.equal(boundaries[0], wt0);
    assert.equal(boundaries.at(-1), wt1);
    for (let i = 1; i < boundaries.length; i++) {
      assert.ok(boundaries[i]! - boundaries[i - 1]! >= MIN_LTX_SHOT_SEC - 1e-9, "every shot must respect the LTX floor");
    }
  }
}

// pickCoverageCount threshold behaviour: strictly below the four-shot
// threshold stays at three; at or above it earns the fourth cut.
assert.equal(pickCoverageCount(FOUR_SHOT_CINEMATIC_BEAT_SEC - 0.001), 3);
assert.equal(pickCoverageCount(FOUR_SHOT_CINEMATIC_BEAT_SEC), 4);
assert.equal(pickCoverageCount(MIN_CINEMATIC_BEAT_SEC), 3);

console.log("shot boundary timing tests passed");
