import assert from "node:assert/strict";
import {
  assertCinematicKeyframeReview,
  CINEMATIC_KEYFRAME_REVIEW_VERSION,
} from "@/engine/cinematicKeyframeReview";

const valid = {
  version: CINEMATIC_KEYFRAME_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  sceneId: "cinematic-shot-01",
  reviewedAgainstSceneIds: ["cinematic-shot-00"],
  expectedCastIds: ["mannequin-investigator"],
  forbidAdditionalPeople: true as const,
  onlyExpectedCastVisible: true as const,
  semanticAlignment: 0.91,
  composition: 0.9,
  continuity: 0.89,
  artifactFree: 0.92,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["Faceless mannequin wardrobe and key prop match the accepted reference."],
};

assert.doesNotThrow(() => assertCinematicKeyframeReview(valid, {
  sceneId: "cinematic-shot-01",
  reviewedAgainstSceneIds: ["cinematic-shot-00"],
  expectedCastIds: ["mannequin-investigator"],
  forbidAdditionalPeople: true,
}));
assert.throws(
  () => assertCinematicKeyframeReview({ ...valid, continuity: 0.7 }, {
    sceneId: "cinematic-shot-01",
    reviewedAgainstSceneIds: ["cinematic-shot-00"],
    expectedCastIds: ["mannequin-investigator"],
    forbidAdditionalPeople: true,
  }),
  /continuity 0.70 < 0.84/,
);
assert.throws(
  () => assertCinematicKeyframeReview({ ...valid, reviewedAgainstSceneIds: [] }, {
    sceneId: "cinematic-shot-01",
    reviewedAgainstSceneIds: ["cinematic-shot-00"],
    expectedCastIds: ["mannequin-investigator"],
    forbidAdditionalPeople: true,
  }),
  /reference lineage/,
);
assert.throws(
  () => assertCinematicKeyframeReview({ ...valid, expectedCastIds: ["mannequin-unapproved"] }, {
    sceneId: "cinematic-shot-01",
    reviewedAgainstSceneIds: ["cinematic-shot-00"],
    expectedCastIds: ["mannequin-investigator"],
    forbidAdditionalPeople: true,
  }),
  /cast contract/,
  "an undeclared extra mannequin cannot receive a pre-LTX keyframe receipt",
);
assert.doesNotThrow(() => assertCinematicKeyframeReview({
  ...valid,
  expectedCastIds: [],
  reviewedAgainstSceneIds: [],
  notes: ["No people or mannequins appear in the declared empty-cast frame."],
}, {
  sceneId: "cinematic-shot-01",
  reviewedAgainstSceneIds: [],
  expectedCastIds: [],
  forbidAdditionalPeople: true,
}), "an empty expected cast is a valid no-people contract when independently affirmed");
