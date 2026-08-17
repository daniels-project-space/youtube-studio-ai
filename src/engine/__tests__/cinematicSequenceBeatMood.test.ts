import assert from "node:assert/strict";

import {
  CINEMATIC_CASE_SEQUENCE_VERSION,
  CinematicCaseSequenceInputSchema,
} from "../cinematicCaseSequence";

/**
 * Schema-shape tests only (no evaluateCinematicCaseSequence/
 * assertCinematicCaseSequence admission — that needs a full source
 * packet/evidence-map/scene-manifest fixture, exercised elsewhere in
 * cinematicCaseSequence.test.ts). These fixtures satisfy
 * CinematicCaseSequenceInputSchema's own field formats (regex identifiers,
 * 64-hex fingerprints) without needing cross-document fingerprint matches,
 * which only the semantic admission checks (not the schema) enforce.
 */

const FP = "a".repeat(64);
const NOW_ISO = new Date().toISOString();

function buildMannequin() {
  return {
    id: "mannequin-x1",
    role: "investigator" as const,
    silhouette: "a tall faceless silhouette",
    wardrobeSignature: "charcoal coat",
    palette: ["charcoal"],
    keyProp: "folio",
    movementProfile: "measured gait",
    faceless: true as const,
    noLikeness: true as const,
  };
}

function buildCoverageShot(id: string, t0: number, t1: number) {
  return {
    id,
    t0,
    t1,
    coveragePurpose: "spatial_anchor" as const,
    visualMode: "atmosphere" as const,
    castIds: [] as string[],
    cameraMove: "static" as const,
    shotScale: "wide" as const,
    lens: "35mm",
    cutReason: "breath" as const,
    tensionState: "question" as const,
    cameraRationale: "a motivated static shot establishes the space.",
    narrationPurpose: "make the setting concrete.",
    still: "a controlled, faceless documentary frame; no likeness, no gore, no baked text.",
    motion: "a restrained ambient motion only.",
    negative: "identifiable face, real-person likeness, gore, text, logo, watermark",
    firstFrameConstraint: "start from the exact cited story state.",
    lastFrameConstraint: "end with only motivated action advanced.",
    onScreenCitation: true as const,
  };
}

function buildBeat(extra: Record<string, unknown> = {}) {
  return {
    id: "cinematic-beat-x1",
    narrativeRole: "cold_open" as const,
    t0: 0,
    t1: 10,
    parentShotIds: ["shot-x1"],
    claimIds: ["claim-x1"],
    sourceIds: ["source-x1"],
    causalQuestion: "why did this happen?",
    shots: [buildCoverageShot("cinematic-shot-x1", 0, 5), buildCoverageShot("cinematic-shot-x2", 5, 10)],
    ...extra,
  };
}

function buildInput(beat: ReturnType<typeof buildBeat>) {
  return {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: "cinematic-sequence-x1",
    caseId: "case-x1",
    sourcePacketFingerprint: FP,
    evidenceShotMapFingerprint: FP,
    sceneManifestFingerprint: FP,
    shotPlanFingerprint: FP,
    cast: [buildMannequin()],
    beats: [beat],
    editorialReview: {
      id: "cinematic-sequence-review-x1",
      decision: "approved" as const,
      reviewerId: "reviewer-x1",
      reviewedAt: NOW_ISO,
      reviewedSourcePacketFingerprint: FP,
      reviewedEvidenceShotMapFingerprint: FP,
      reviewedSequenceFingerprint: FP,
    },
  };
}

// Sanity: the fixture itself is schema-valid before mood is introduced.
const baseline = CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat()));
assert.equal(baseline.success, true, `fixture must be schema-valid: ${baseline.success ? "" : JSON.stringify(baseline.error.issues.slice(0, 3))}`);

// A beat without mood must still validate — backward compatible with every
// sequence input authored before this field existed.
assert.equal(
  CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat())).success,
  true,
  "a beat without mood must still validate (backward compatible)",
);

// Every declared mood value must validate.
for (const mood of ["tense", "somber", "triumphant", "mysterious", "neutral"] as const) {
  const result = CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat({ mood })));
  assert.equal(result.success, true, `mood "${mood}" must validate`);
}

// An unrecognized mood value must be rejected.
assert.equal(
  CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat({ mood: "furious" }))).success,
  false,
  "an unrecognized mood value must be rejected",
);

// The beat schema stays strict: mood does not open the door to arbitrary
// extra keys the schema was not asked to accept.
assert.equal(
  CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat({ notARealField: "x" }))).success,
  false,
  "the beat schema must remain strict about genuinely unknown keys",
);

console.log("cinematic sequence beat mood schema test passed");
