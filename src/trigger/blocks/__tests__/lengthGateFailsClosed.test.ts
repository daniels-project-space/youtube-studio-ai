/**
 * The length gate must never pass because it could not evaluate itself.
 *
 * `Number(x)` returning NaN disabled this hard Stage-4 gate three independent
 * ways, because NaN loses every comparison it takes part in:
 *
 *   NaN <  min   false   an unparseable videoDurationSec passed
 *   dur <  NaN   false   a malformed minSeconds removed the floor
 *   dur >  NaN   false   a malformed maxSeconds removed the ceiling
 *
 * Each one logged "length_check ok" and produced lengthOk: true, which is why
 * nothing ever noticed: the failure mode and success look identical from
 * outside. Params are Record<string, unknown>, so `maxSeconds: "900s"` in a
 * channel's configuration is enough — this does not need a bug to happen.
 *
 * Every case below is one way the gate could previously be disabled, plus the
 * ordinary accept/reject behaviour that must survive the hardening.
 */
import assert from "node:assert/strict";

import { resolveLengthBounds } from "@/trigger/blocks/narratedBlocks";

/* ------------------------- the three NaN doorways ------------------------- */

// A 5-hour video with an unreadable duration used to sail through.
for (const unreadable of ["unknown", {}, [1, 2], "12s", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
  const result = resolveLengthBounds(unreadable, 10, 900);
  assert.equal(
    result.ok,
    false,
    `an unusable videoDurationSec (${JSON.stringify(unreadable)}) must refuse, not pass`,
  );
  assert.match(result.ok ? "" : result.reason, /videoDurationSec/, "the refusal must name the unusable input");
}

for (const unreadable of ["abc", {}, "10s", Number.NaN]) {
  const badMin = resolveLengthBounds(300, unreadable, 900);
  assert.equal(badMin.ok, false, `a malformed minSeconds (${JSON.stringify(unreadable)}) must refuse`);
  assert.match(badMin.ok ? "" : badMin.reason, /minSeconds/, "the refusal must name minSeconds");

  const badMax = resolveLengthBounds(300, 10, unreadable);
  assert.equal(badMax.ok, false, `a malformed maxSeconds (${JSON.stringify(unreadable)}) must refuse`);
  assert.match(badMax.ok ? "" : badMax.reason, /maxSeconds/, "the refusal must name maxSeconds");
}

// The case that mattered most: a huge runtime with a broken ceiling. This used
// to return lengthOk: true.
const runaway = resolveLengthBounds(99_999, 10, "no limit");
assert.equal(runaway.ok, false, "a 99999s video with an unparseable ceiling must not be admitted");

/* --------------------------- inverted bounds ------------------------------ */

// A window that can admit nothing is a configuration error, and must say so
// rather than reporting every video as the wrong length.
const inverted = resolveLengthBounds(300, 900, 60);
assert.equal(inverted.ok, false);
assert.match(inverted.ok ? "" : inverted.reason, /inverted/, "an impossible window must be named as such");

/* ---------------------------- ordinary behaviour -------------------------- */

// Absent inputs still take their documented defaults: 0s duration, floor 10,
// ceiling 36000. 0 < 10, so a missing duration still fails the gate — closed,
// as it always did.
const defaults = resolveLengthBounds(undefined, undefined, undefined);
assert.equal(defaults.ok, true, "absent inputs are defaults, not errors");
if (defaults.ok) {
  assert.equal(defaults.dur, 0);
  assert.equal(defaults.min, 10);
  assert.equal(defaults.max, 36000);
  assert.ok(defaults.dur < defaults.min, "a missing duration must still be rejected by the caller");
}

// Numeric strings are legitimate: params arrive as unknown and JSON round-trips.
const stringy = resolveLengthBounds("300", "60", "900");
assert.equal(stringy.ok, true, "numeric strings must still be accepted");
if (stringy.ok) assert.deepEqual([stringy.dur, stringy.min, stringy.max], [300, 60, 900]);

// In-window and out-of-window both resolve; the caller compares.
const inWindow = resolveLengthBounds(300, 60, 900);
assert.equal(inWindow.ok, true);
if (inWindow.ok) assert.ok(inWindow.dur >= inWindow.min && inWindow.dur <= inWindow.max);

const tooLong = resolveLengthBounds(1200, 60, 900);
assert.equal(tooLong.ok, true, "an over-long video resolves — it is REJECTED by the comparison, not by parsing");
if (tooLong.ok) assert.ok(tooLong.dur > tooLong.max, "and the comparison must catch it");

// Exact boundaries are inside the window, not outside it.
const atFloor = resolveLengthBounds(60, 60, 900);
const atCeiling = resolveLengthBounds(900, 60, 900);
assert.ok(atFloor.ok && !(atFloor.dur < atFloor.min), "a video exactly at the floor is admissible");
assert.ok(atCeiling.ok && !(atCeiling.dur > atCeiling.max), "a video exactly at the ceiling is admissible");

console.log("LENGTH GATE PASS — an unevaluable gate refuses instead of reporting ok");
