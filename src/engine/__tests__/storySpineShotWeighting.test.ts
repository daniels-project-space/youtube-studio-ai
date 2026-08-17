import assert from "node:assert/strict";

import { MIN_CINEMATIC_BEAT_SEC } from "../shotBoundaryTiming";
import { planStorySpine } from "../storySpine";

// A sample narration timeline mixing several very short sentences (each
// well under MIN_CINEMATIC_BEAT_SEC) with one long, uninterrupted 40s
// narrated passage. The short sentences must keep the original bounded
// equal split unchanged; the long one is long enough to earn the same
// weighted, purpose-appropriate coverage split the Casefile cinematic
// draft uses, producing genuinely varied (non-uniform) shot durations
// tied to the real narration timing rather than an equal division.
const spine = planStorySpine({
  topic: "a source-bound investigation",
  narrationDurationSec: 55,
  targetShotSec: 6,
  sentenceTimings: [
    { text: "It began quietly.", start: 0, end: 4 },
    { text: "Nobody noticed at first.", start: 4, end: 9 },
    {
      text:
        "Over the following weeks investigators pieced together a long chain of " +
        "documented events, cross-referencing timestamps, witness statements, and " +
        "physical evidence until a single uninterrupted account of the night finally " +
        "emerged from what had once been a scattered and contradictory record.",
      start: 9,
      end: 49,
    },
    { text: "The case closed soon after.", start: 49, end: 52 },
    { text: "Nothing else was ever found.", start: 52, end: 55 },
  ],
  structure: { beats: [{ name: "investigation", note: "advance the causal story" }] },
});

// --- Invariant: every shot respects the locked LTX floor -------------------
for (const shot of spine.shotList) {
  assert.ok(shot.t1 - shot.t0 >= 3 - 1e-9, `shot ${shot.id} must be at least 3s (got ${shot.t1 - shot.t0})`);
  assert.ok(Math.abs(shot.seconds - (shot.t1 - shot.t0)) < 1e-9, `shot ${shot.id} seconds field must match t1-t0`);
}

// --- Invariant: shots stay fully continuous across the whole narration ----
const ordered = [...spine.shotList].sort((a, b) => a.t0 - b.t0);
assert.equal(ordered[0]!.t0, 0);
assert.equal(ordered.at(-1)!.t1, 55);
for (let i = 1; i < ordered.length; i++) {
  assert.ok(Math.abs(ordered[i]!.t0 - ordered[i - 1]!.t1) < 1e-6, "shots must be gapless and non-overlapping");
}

// --- Very short beats (each < MIN_CINEMATIC_BEAT_SEC = 9s) keep the -------
// --- original bounded equal split: exactly one shot per short sentence. ---
const beatOne = spine.narrativeBeats[0]!;
const beatTwo = spine.narrativeBeats[1]!;
const beatFour = spine.narrativeBeats[3]!;
const beatFive = spine.narrativeBeats[4]!;
for (const shortBeat of [beatOne, beatTwo, beatFour, beatFive]) {
  assert.ok(shortBeat.t1 - shortBeat.t0 < MIN_CINEMATIC_BEAT_SEC, "fixture assumption: these beats are short");
  const shotsForBeat = spine.shotList.filter((shot) => shot.beatId === shortBeat.id);
  assert.equal(shotsForBeat.length, 1, `short beat ${shortBeat.id} must not be forced into a weighted multi-shot split`);
  assert.ok(Math.abs(shotsForBeat[0]!.seconds - (shortBeat.t1 - shortBeat.t0)) < 1e-6);
}

// --- The one long beat (40s, >= MIN_CINEMATIC_BEAT_SEC) earns the ---------
// --- weighted, non-uniform split instead of an equal division. ------------
const longBeat = spine.narrativeBeats[2]!;
assert.ok(longBeat.t1 - longBeat.t0 >= MIN_CINEMATIC_BEAT_SEC, "fixture assumption: this beat is long enough to window");
const longBeatShots = spine.shotList
  .filter((shot) => shot.beatId === longBeat.id)
  .sort((a, b) => a.t0 - b.t0);
assert.ok(longBeatShots.length > 1, "a 40s beat must produce more than a single coverage shot");

// Every shot in this beat stays confined to the beat's own window: no
// cross-beat shots, and the durations sum exactly to the beat's own
// narrated t1 - t0 (not the whole narration).
assert.equal(longBeatShots[0]!.t0, longBeat.t0);
assert.equal(longBeatShots.at(-1)!.t1, longBeat.t1);
const longBeatTotalSec = longBeatShots.reduce((total, shot) => total + shot.seconds, 0);
assert.ok(
  Math.abs(longBeatTotalSec - (longBeat.t1 - longBeat.t0)) < 1e-6,
  "the sum of a beat's shot durations must match that beat's actual t1 - t0",
);

// Genuine variety: the weighted split must not degenerate into an equal
// division the way the old Math.ceil chunking always did.
const roundedDurations = longBeatShots.map((shot) => Number(shot.seconds.toFixed(2)));
const distinctDurations = new Set(roundedDurations);
assert.ok(
  distinctDurations.size > 1,
  `weighted split must produce non-uniform shot durations, got ${JSON.stringify(roundedDurations)}`,
);

// Every shot in the long beat keeps a single, consistent beatId and stays
// bound only to that beat's own sentence -- no cross-beat leakage.
for (const shot of longBeatShots) {
  assert.equal(shot.beatId, longBeat.id);
  assert.deepEqual(shot.sourceSentenceIds, longBeat.sourceSentenceIds);
}

// --- No Casefile-specific fields anywhere on the produced shots. ----------
const forbiddenFieldNames = ["onScreenCitation", "claimIds", "coveragePurposeTreatment", "evidenceTreatment", "reconstructionDisclosure"];
for (const shot of spine.shotList) {
  for (const forbidden of forbiddenFieldNames) {
    assert.ok(!(forbidden in shot), `Story Spine shot ${shot.id} must never carry the Casefile-only field "${forbidden}"`);
  }
}

console.log("story spine shot weighting tests passed");
