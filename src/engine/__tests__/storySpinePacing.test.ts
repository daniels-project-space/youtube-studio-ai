/**
 * story_spine honours the Director's pacing intent.
 *
 * `intentSec` was declared on PlanStorySpineInput and read by nothing. Structure
 * beats were mapped onto sentences by COUNT, so a beat the Director wanted on
 * screen for 15 seconds and one it wanted for 65 received the same share of the
 * narration. Measured on real briefDirector output by
 * scripts/story-spine-pacing-harness.ts: a mean 30.6% of the timeline carried
 * the wrong beat purpose, worst case 46.2%, and the error was LARGEST where the
 * Director's pacing opinion was strongest. After the fix: mean 3.4%, worst 8.1%,
 * with the remainder fully explained by sentences being atomic.
 *
 * The harness is the calibration; this is the regression lock. It pins the three
 * properties the assignment must keep, each of which protects something real:
 *
 *   time-driven  or the pacing intent is decorative again.
 *   monotonic    or beat purposes interleave and narrative beats stop being
 *                contiguous stretches of the video.
 *   surjective   or a beat can be skipped entirely — and a skipped
 *                narrativeRole:"introduction" beat takes its nameCardText with
 *                it, silently deleting a character introduction from the render.
 *   compatible   a Director that omits intentSec must land exactly where it did
 *                before, so this cannot regress the lanes that never set it.
 */
import assert from "node:assert/strict";

import { planStorySpine } from "@/engine/storySpine";

const evenTimings = (count: number, durationSec: number) =>
  Array.from({ length: count }, (_, i) => ({
    text: `Sentence ${i + 1}.`,
    start: (i * durationSec) / count,
    end: ((i + 1) * durationSec) / count,
  }));

/** Beat purposes in timeline order, one entry per narrative beat. */
const purposes = (spine: ReturnType<typeof planStorySpine>) => spine.narrativeBeats.map((b) => b.purpose);

/* ---------------------- 1. the intent actually moves the boundary --------- */

// A 10s hook in front of a 90s body. With 20 evenly-spaced sentences the hook
// owns the first 10% of the clock, so at most a couple of sentences — NOT half
// of them, which is what a count split gives.
const skewed = planStorySpine({
  topic: "pacing intent is honoured",
  narrationDurationSec: 100,
  targetShotSec: 6,
  sentenceTimings: evenTimings(20, 100),
  structure: { beats: [{ name: "hook", note: "HOOK", intentSec: 10 }, { name: "body", note: "BODY", intentSec: 90 }] },
});
const hookBeats = purposes(skewed).filter((p) => p === "HOOK").length;
assert.ok(
  hookBeats >= 1 && hookBeats <= 3,
  `a 10%-of-runtime hook must own about 10% of 20 sentences, got ${hookBeats}`,
);
assert.equal(purposes(skewed).filter((p) => p === "BODY").length, 20 - hookBeats);

// The count mapping would have given the hook exactly half. Pin that this is
// no longer what happens, so the fix cannot be silently reverted.
assert.notEqual(hookBeats, 10, "a count-proportional split would give the hook half the sentences");

/* ------------------------------ 2. monotonic ------------------------------ */

// Purposes must appear in contiguous runs: once the plan has left a beat it can
// never return to it, or a 'payoff' purpose could reappear inside the setup.
const many = planStorySpine({
  topic: "monotonic beat assignment",
  narrationDurationSec: 300,
  targetShotSec: 6,
  sentenceTimings: evenTimings(47, 300),
  structure: {
    beats: [
      { name: "a", note: "A", intentSec: 20 },
      { name: "b", note: "B", intentSec: 120 },
      { name: "c", note: "C", intentSec: 15 },
      { name: "d", note: "D", intentSec: 90 },
      { name: "e", note: "E", intentSec: 55 },
    ],
  },
});
const seen: string[] = [];
for (const p of purposes(many)) if (seen.at(-1) !== p) seen.push(p);
assert.deepEqual(
  seen,
  ["A", "B", "C", "D", "E"],
  "each beat purpose must occupy one contiguous run, in the Director's order",
);

/* ------------------------------ 3. surjective ----------------------------- */

// A beat far shorter than one sentence must still receive a sentence. This is
// the property that keeps an introduction beat's name card alive.
const tinyBeat = planStorySpine({
  topic: "a beat shorter than a single sentence",
  narrationDurationSec: 120,
  targetShotSec: 6,
  sentenceTimings: evenTimings(6, 120), // 20s per sentence
  structure: {
    beats: [
      { name: "intro", note: "INTRO", intentSec: 2 }, // one tenth of a sentence
      { name: "middle", note: "MIDDLE", intentSec: 100 },
      { name: "end", note: "END", intentSec: 18 },
    ],
  },
});
for (const expected of ["INTRO", "MIDDLE", "END"]) {
  assert.ok(
    purposes(tinyBeat).includes(expected),
    `every declared beat must receive at least one sentence; "${expected}" was skipped`,
  );
}

// SEVERAL tiny beats in a row, which is the case the forward guard exists for
// and the single-tiny-beat case above does not reach: one sentence can stride
// past three intended boundaries at once, and without the guard the cursor
// jumps straight to the last beat and abandons everything in between.
// (Verified by mutation: removing the guard leaves the case above passing and
// fails only this one.)
const stackedTinyBeats = planStorySpine({
  topic: "three tiny beats before a long one",
  narrationDurationSec: 100,
  targetShotSec: 6,
  sentenceTimings: evenTimings(4, 100), // 25s per sentence
  structure: {
    beats: [
      { name: "a", note: "A", intentSec: 1 },
      { name: "b", note: "B", intentSec: 1 },
      { name: "c", note: "C", intentSec: 1 },
      { name: "d", note: "D", intentSec: 97 },
    ],
  },
});
assert.deepEqual(
  purposes(stackedTinyBeats),
  ["A", "B", "C", "D"],
  "a run of sub-sentence beats must each keep a sentence rather than being strided over",
);

// The same guarantee at the hard boundary: exactly as many sentences as beats.
const exact = planStorySpine({
  topic: "one sentence per beat",
  narrationDurationSec: 90,
  targetShotSec: 6,
  sentenceTimings: evenTimings(3, 90),
  structure: {
    beats: [
      { name: "x", note: "X", intentSec: 80 },
      { name: "y", note: "Y", intentSec: 5 },
      { name: "z", note: "Z", intentSec: 5 },
    ],
  },
});
assert.deepEqual(purposes(exact), ["X", "Y", "Z"], "with one sentence per beat each beat must take exactly one");

/* ---------------------------- 4. backward compatible ---------------------- */

// No intentSec anywhere: the historical count-proportional mapping, unchanged.
// 8 sentences over 4 beats is 2 sentences each under that mapping.
const noIntent = planStorySpine({
  topic: "no pacing intent supplied",
  narrationDurationSec: 80,
  targetShotSec: 6,
  sentenceTimings: evenTimings(8, 80),
  structure: {
    beats: [{ name: "p", note: "P" }, { name: "q", note: "Q" }, { name: "r", note: "R" }, { name: "s", note: "S" }],
  },
});
assert.deepEqual(
  purposes(noIntent),
  ["P", "P", "Q", "Q", "R", "R", "S", "S"],
  "with no intentSec the mapping must be exactly the historical count split",
);

// A zero/negative/non-finite intentSec is not usable pacing and must fall back
// the same way rather than skewing everything onto one beat.
const junkIntent = planStorySpine({
  topic: "unusable pacing intent",
  narrationDurationSec: 80,
  targetShotSec: 6,
  sentenceTimings: evenTimings(8, 80),
  structure: {
    beats: [
      { name: "p", note: "P", intentSec: 0 },
      { name: "q", note: "Q", intentSec: -5 },
      { name: "r", note: "R", intentSec: Number.NaN },
      { name: "s", note: "S" },
    ],
  },
});
assert.deepEqual(
  purposes(junkIntent),
  ["P", "P", "Q", "Q", "R", "R", "S", "S"],
  "zero, negative and NaN intentSec are not pacing — fall back, do not skew",
);

// A single usable value among junk IS pacing, and must be honoured: beat "q"
// declared the only real seconds, so it takes the bulk of the timeline.
const partialIntent = planStorySpine({
  topic: "partially declared pacing",
  narrationDurationSec: 80,
  targetShotSec: 6,
  sentenceTimings: evenTimings(8, 80),
  structure: {
    beats: [{ name: "p", note: "P" }, { name: "q", note: "Q", intentSec: 60 }, { name: "r", note: "R" }],
  },
});
assert.ok(
  purposes(partialIntent).filter((p) => p === "Q").length >= 5,
  "one declared intentSec among undeclared beats is still pacing and must be honoured",
);

console.log("STORY SPINE PACING PASS — intentSec drives beat placement; monotonic, surjective, compatible");
