import assert from "node:assert/strict";

import {
  NarrativeRoleSchema,
  NarrativeBeatSchema,
  ShotPlanSchema,
  planStorySpine,
  validateStorySpine,
} from "../storySpine";

/* ------------------------- NarrativeRoleSchema ---------------------------- */

assert.equal(NarrativeRoleSchema.safeParse("introduction").success, true);
assert.equal(NarrativeRoleSchema.safeParse("cold_open").success, false, "Story Spine's narrow enum must not accept the Casefile route's other role values");
assert.equal(NarrativeRoleSchema.safeParse("").success, false);

/* ------------------- NarrativeBeatSchema.narrativeRole --------------------- */

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
  "a beat without narrativeRole must still validate (backward compatible)",
);
assert.equal(
  NarrativeBeatSchema.safeParse({ ...baseBeat, narrativeRole: "introduction" }).success,
  true,
  "a beat with a valid narrativeRole must validate",
);
assert.equal(
  NarrativeBeatSchema.safeParse({ ...baseBeat, narrativeRole: "reveal" }).success,
  false,
  "a beat with an unrecognized/Casefile-only narrativeRole must be rejected",
);

/* ------------- ShotPlanSchema.nameCardText / narrativeRole ---------------- */

const baseShot = {
  id: "shot-0001",
  beatId: "beat-0001",
  sourceSentenceIds: ["sentence-0001"],
  t0: 0,
  t1: 5,
  coveragePurpose: "establish the scene",
  literalContent: "a literal story moment",
  entities: ["entity-primary"] as string[],
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
  "a shot without nameCardText/narrativeRole must still validate (backward compatible)",
);
assert.equal(
  ShotPlanSchema.safeParse({ ...baseShot, narrativeRole: "introduction", nameCardText: "DR. AYANA OKAFOR" }).success,
  true,
  "a shot with a valid narrativeRole + nameCardText must validate",
);
assert.equal(
  ShotPlanSchema.safeParse({ ...baseShot, nameCardText: "x".repeat(121) }).success,
  false,
  "nameCardText over 120 chars must be rejected by the schema",
);
assert.equal(
  ShotPlanSchema.safeParse({ ...baseShot, nameCardText: "" }).success,
  false,
  "an empty nameCardText string must be rejected by the schema (use undefined instead)",
);

/* ----------- validateStorySpine: lightweight nameCardText gate ------------ */

// A shot with nameCardText but no entities must be rejected — the automatic
// path's lightweight substitute for the Casefile route's strict
// evidence-citation/locked-cast checks (evaluateCinematicCaseSequence).
const minimalSpineBase = {
  version: "1.0.0" as const,
  timedScript: {
    version: "1.0.0" as const,
    narrationDurationSec: 5,
    sentences: [
      { id: "sentence-0001", text: "One sentence.", t0: 0, t1: 5, sectionId: "section-001", evidenceRefs: ["script:sentence:1"] },
    ],
  },
  narrativeBeats: [{ ...baseBeat, narrativeRole: "introduction" as const }],
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [],
    locations: [],
    era: "unspecified",
    wardrobe: [],
    props: [],
    palette: [],
    cameraGrammar: [],
    negativeConstraints: [],
  },
  dpVisualSpecs: [
    {
      shotId: "shot-0001",
      keyframePrompt: "kf",
      motionPrompt: "mp",
      negativePrompt: "",
      styleLock: "",
      firstFrameConstraint: "ffc",
      lastFrameConstraint: "lfc",
      continuityState: baseShot.continuityState,
    },
  ],
  editorEdl: {
    version: "1.0.0" as const,
    durationSec: 5,
    shots: [{ shotId: "shot-0001", sourceSentenceIds: ["sentence-0001"], t0: 0, t1: 5 }],
  },
  coverage: { mappedSec: 5, totalSec: 5, ratio: 1, gaps: [] as { t0: number; t1: number }[] },
};

assert.throws(
  () =>
    validateStorySpine({
      ...minimalSpineBase,
      shotList: [{ ...baseShot, entities: [], nameCardText: "NO ENTITY HERE" }],
    }),
  /nameCardText but has no entities/,
  "a shot with nameCardText and an empty entities list must be rejected",
);

// The same shot WITH a non-empty entities list must pass.
const validSpine = validateStorySpine({
  ...minimalSpineBase,
  shotList: [{ ...baseShot, entities: ["entity-primary"], nameCardText: "DR. AYANA OKAFOR" }],
});
assert.equal(validSpine.shotList[0]?.nameCardText, "DR. AYANA OKAFOR");

/* --------------- planStorySpine: narrativeRole/nameCardText threading ----- */

// structure.beats[].narrativeRole + nameCardText flow onto narrativeBeats[]
// and onto the FIRST shot cut from that beat only.
const spineWithIntro = planStorySpine({
  topic: "character introduction threading",
  narrationDurationSec: 24,
  targetShotSec: 4,
  sentenceTimings: [
    { text: "Detective Ayana Okafor steps into the rain-soaked alley.", start: 0, end: 12 },
    { text: "The case would define the rest of her career.", start: 12, end: 24 },
  ],
  visualBrief: { recurringSubject: "Ayana Okafor" },
  styleDNA: { recurringSubject: "Ayana Okafor" },
  structure: {
    beats: [
      { name: "intro", note: "introduce the detective", narrativeRole: "introduction", nameCardText: "DETECTIVE AYANA OKAFOR" },
      { name: "stakes", note: "raise the stakes" },
    ],
  },
});
assert.equal(spineWithIntro.narrativeBeats[0]?.narrativeRole, "introduction");
assert.equal(spineWithIntro.narrativeBeats[1]?.narrativeRole, undefined);

const introBeatId = spineWithIntro.narrativeBeats[0]!.id;
const introBeatShots = spineWithIntro.shotList.filter((shot) => shot.beatId === introBeatId);
assert.ok(introBeatShots.length > 0, "the introduction beat must still produce shots");
assert.equal(introBeatShots[0]?.nameCardText, "DETECTIVE AYANA OKAFOR", "the FIRST shot of the introduction beat must carry the name card");
for (const shot of introBeatShots.slice(1)) {
  assert.equal(shot.nameCardText, undefined, "only the beat's first cut shot may carry the name card, not every shot in a multi-shot beat");
}
for (const shot of spineWithIntro.shotList) {
  assert.equal(shot.narrativeRole, shot.beatId === introBeatId ? "introduction" : undefined);
}
// Every shot referencing entity-primary satisfies the lightweight gate above
// (planStorySpine already threads recurringSubject onto shot.entities).
assert.ok(introBeatShots[0]!.entities.length > 0, "the name-card shot must have a non-empty entities list (recurringSubject was supplied)");

/* --------- planStorySpine: invalid/dropped narrativeRole + nameCardText --- */

// An unrecognized narrativeRole and an oversized nameCardText are both
// dropped, not thrown — same additive, never-fail-an-otherwise-valid-spine
// doctrine as BeatMoodSchema.
const spineWithBadIntro = planStorySpine({
  topic: "bad intro values",
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "One sentence only, spanning the whole clip.", start: 0, end: 6 }],
  structure: {
    beats: [{ name: "x", narrativeRole: "not-a-real-role", nameCardText: "y".repeat(200) }],
  },
});
assert.equal(spineWithBadIntro.narrativeBeats[0]?.narrativeRole, undefined, "an unrecognized narrativeRole must be dropped rather than thrown");
assert.equal(spineWithBadIntro.shotList[0]?.nameCardText, undefined, "an oversized nameCardText must be dropped rather than thrown");

// No structure at all — full backward compatibility.
const spineNoIntro = planStorySpine({
  topic: "no intro supplied",
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "One sentence only, spanning the whole clip.", start: 0, end: 6 }],
});
assert.equal(spineNoIntro.narrativeBeats[0]?.narrativeRole, undefined);
assert.equal(spineNoIntro.shotList[0]?.nameCardText, undefined);

// narrativeRole "introduction" WITHOUT nameCardText must not synthesize any
// on-screen text (nameCardText stays fully opt-in even on an intro beat).
const spineIntroNoCard = planStorySpine({
  topic: "introduction role without a name card",
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "One sentence only, spanning the whole clip.", start: 0, end: 6 }],
  structure: { beats: [{ name: "x", narrativeRole: "introduction" }] },
});
assert.equal(spineIntroNoCard.narrativeBeats[0]?.narrativeRole, "introduction");
assert.equal(spineIntroNoCard.shotList[0]?.nameCardText, undefined);

console.log("character-intro name-card schema + threading + lightweight validation test passed");
