import assert from "node:assert/strict";

import {
  CINEMATIC_CASE_SEQUENCE_VERSION,
  CinematicCaseSequenceInputSchema,
  CinematicNarrativeRoleSchema,
} from "../cinematicCaseSequence";

/**
 * Schema-shape tests only for the new `introduction` narrativeRole value and
 * the `nameCardText` field, following the same pattern as
 * cinematicSequenceBeatMood.test.ts: no evaluateCinematicCaseSequence/
 * assertCinematicCaseSequence admission here (that needs a full source
 * packet/evidence-map/scene-manifest fixture — the actual
 * name-card-exception BEHAVIOR, positive and negative, is exercised
 * end-to-end in cinematicIntroductionNameCard.test.ts).
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

function buildCoverageShot(id: string, t0: number, t1: number, extra: Record<string, unknown> = {}) {
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
    ...extra,
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

// Sanity: the fixture itself is schema-valid before introduction is used.
const baseline = CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat()));
assert.equal(baseline.success, true, `fixture must be schema-valid: ${baseline.success ? "" : JSON.stringify(baseline.error.issues.slice(0, 3))}`);

// Every previously existing narrativeRole value must still validate.
for (const role of [
  "cold_open",
  "orientation",
  "investigation",
  "contradiction",
  "reveal",
  "aftermath",
  "closing_residue",
] as const) {
  const result = CinematicNarrativeRoleSchema.safeParse(role);
  assert.equal(result.success, true, `pre-existing narrativeRole "${role}" must still validate`);
}

// The new "introduction" value must validate at the enum level.
assert.equal(CinematicNarrativeRoleSchema.safeParse("introduction").success, true, `narrativeRole "introduction" must validate`);

// An unrecognized narrativeRole value must still be rejected.
assert.equal(CinematicNarrativeRoleSchema.safeParse("prologue").success, false, "an unrecognized narrativeRole must be rejected");

// A beat using the new introduction role, with a shot carrying nameCardText,
// must validate at the schema level (semantic enforcement of WHERE
// nameCardText is legal happens in evaluateCinematicCaseSequence, tested
// separately).
const introBeat = buildBeat({
  narrativeRole: "introduction" as const,
  shots: [
    buildCoverageShot("cinematic-shot-intro-name", 0, 5, {
      castIds: ["mannequin-x1"],
      nameCardText: "DETECTIVE A. REYES",
    }),
    buildCoverageShot("cinematic-shot-intro-action", 5, 10, { castIds: ["mannequin-x1"] }),
  ],
});
const introResult = CinematicCaseSequenceInputSchema.safeParse(buildInput(introBeat));
assert.equal(
  introResult.success,
  true,
  `introduction beat with nameCardText must be schema-valid: ${introResult.success ? "" : JSON.stringify(introResult.error.issues.slice(0, 3))}`,
);

// A shot without nameCardText must still validate — optional field,
// backward compatible with every sequence input authored before it existed.
assert.equal(
  CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat())).success,
  true,
  "a shot without nameCardText must still validate (backward compatible)",
);

// nameCardText is bounded, not free text without limit.
const overlongName = "X".repeat(200);
const overlongResult = CinematicCaseSequenceInputSchema.safeParse(
  buildInput(
    buildBeat({
      narrativeRole: "introduction" as const,
      shots: [
        buildCoverageShot("cinematic-shot-intro-long", 0, 5, { castIds: ["mannequin-x1"], nameCardText: overlongName }),
        buildCoverageShot("cinematic-shot-intro-long2", 5, 10, { castIds: ["mannequin-x1"] }),
      ],
    }),
  ),
);
assert.equal(overlongResult.success, false, "nameCardText must stay bounded (reject an overlong string)");

// The coverage-shot schema stays strict: nameCardText does not open the
// door to arbitrary extra keys the schema was not asked to accept.
assert.equal(
  CinematicCaseSequenceInputSchema.safeParse(buildInput(buildBeat({ notARealField: "x" }))).success,
  false,
  "the beat schema must remain strict about genuinely unknown keys",
);

console.log("cinematic introduction role + nameCardText schema test passed");
