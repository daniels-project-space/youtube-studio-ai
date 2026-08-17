import assert from "node:assert/strict";

import {
  BeatMoodSchema,
  NarrativeBeatSchema,
  ShotPlanSchema,
  planStorySpine,
} from "../storySpine";

/* --------------------------- BeatMoodSchema ----------------------------- */

assert.equal(BeatMoodSchema.safeParse("tense").success, true);
assert.equal(BeatMoodSchema.safeParse("somber").success, true);
assert.equal(BeatMoodSchema.safeParse("triumphant").success, true);
assert.equal(BeatMoodSchema.safeParse("mysterious").success, true);
assert.equal(BeatMoodSchema.safeParse("neutral").success, true);
assert.equal(BeatMoodSchema.safeParse("furious").success, false, "unbounded/unknown mood strings must be rejected");
assert.equal(BeatMoodSchema.safeParse("").success, false);

/* ---------------------- NarrativeBeatSchema.mood ------------------------- */

const baseBeat = {
  id: "beat-0001",
  sourceSentenceIds: ["sentence-0001"],
  t0: 0,
  t1: 5,
  purpose: "advance the narrated argument",
  evidenceRefs: [] as string[],
};

assert.equal(
  NarrativeBeatSchema.safeParse(baseBeat).success,
  true,
  "a beat without mood must still validate (backward compatible)",
);
assert.equal(
  NarrativeBeatSchema.safeParse({ ...baseBeat, mood: "tense" }).success,
  true,
  "a beat with a valid mood must validate",
);
assert.equal(
  NarrativeBeatSchema.safeParse({ ...baseBeat, mood: "angry" }).success,
  false,
  "a beat with an unrecognized mood must be rejected",
);

/* ------------------------ ShotPlanSchema.mood ---------------------------- */

const baseShot = {
  id: "shot-0001",
  beatId: "beat-0001",
  sourceSentenceIds: ["sentence-0001"],
  t0: 0,
  t1: 5,
  coveragePurpose: "establish the scene",
  literalContent: "a literal story moment",
  entities: [] as string[],
  era: "unspecified",
  wardrobe: [] as string[],
  props: [] as string[],
  continuityState: "entity-primary/location-primary/beat-0001",
  cameraMove: "static" as const,
  shotScale: "wide" as const,
  lens: "35mm",
  lighting: "consistent motivated natural lighting",
  motion: "a restrained motion",
  negative: "",
  generationProfile: "production" as const,
  candidateCount: 1,
  imageMinScore: 0.8,
  shotMinScore: 0.8,
  prompt: "a rendered prompt",
  seconds: 5,
  storyFunction: "advance the argument",
  section: "section-001",
  seed: 100_001,
};

assert.equal(
  ShotPlanSchema.safeParse(baseShot).success,
  true,
  "a shot without mood must still validate (backward compatible)",
);
assert.equal(
  ShotPlanSchema.safeParse({ ...baseShot, mood: "mysterious" }).success,
  true,
  "a shot with a valid mood must validate",
);
assert.equal(
  ShotPlanSchema.safeParse({ ...baseShot, mood: "spooky" }).success,
  false,
  "a shot with an unrecognized mood must be rejected",
);

/* ------------------- planStorySpine: mood threading ----------------------- */

// structure.beats[].mood flows onto narrativeBeats[].mood AND every shot cut
// from that beat carries the identical mood value.
const spineWithMood = planStorySpine({
  topic: "mood threading",
  narrationDurationSec: 12,
  targetShotSec: 4,
  sentenceTimings: [
    { text: "Something tense begins in the dark hallway.", start: 0, end: 6 },
    { text: "It resolves warmly by the story's end.", start: 6, end: 12 },
  ],
  structure: {
    beats: [
      { name: "open", note: "open on unresolved tension", mood: "tense" },
      { name: "close", note: "resolve into warmth", mood: "triumphant" },
    ],
  },
});
assert.equal(spineWithMood.narrativeBeats.length, 2);
assert.equal(spineWithMood.narrativeBeats[0]?.mood, "tense");
assert.equal(spineWithMood.narrativeBeats[1]?.mood, "triumphant");
assert.ok(spineWithMood.shotList.length > 0, "spine must still produce shots");
for (const shot of spineWithMood.shotList) {
  const parentBeat = spineWithMood.narrativeBeats.find((beat) => beat.id === shot.beatId);
  assert.equal(
    shot.mood,
    parentBeat?.mood,
    `shot ${shot.id} mood must match its parent beat ${shot.beatId}'s mood`,
  );
}

// An unrecognized mood value on a structure beat is dropped, not thrown: this
// is optional, non-critical metadata and must never fail an otherwise-valid
// spine plan.
const spineWithBadMood = planStorySpine({
  topic: "bad mood value",
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "One sentence only, spanning the whole clip.", start: 0, end: 6 }],
  structure: { beats: [{ name: "x", mood: "not-a-real-mood" }] },
});
assert.equal(
  spineWithBadMood.narrativeBeats[0]?.mood,
  undefined,
  "an unrecognized structure-beat mood must be dropped rather than thrown",
);
assert.equal(spineWithBadMood.shotList[0]?.mood, undefined);

// No structure at all — the default pipeline path — leaves mood undefined
// everywhere, proving full backward compatibility with every caller that
// predates this field.
const spineNoMood = planStorySpine({
  topic: "no mood supplied",
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "One sentence only, spanning the whole clip.", start: 0, end: 6 }],
});
assert.equal(spineNoMood.narrativeBeats[0]?.mood, undefined);
assert.equal(spineNoMood.shotList[0]?.mood, undefined);

console.log("beat mood schema + threading test passed");
