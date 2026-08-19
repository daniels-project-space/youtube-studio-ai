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
}));
assert.throws(
  () => assertCinematicKeyframeReview({ ...valid, continuity: 0.7 }, {
    sceneId: "cinematic-shot-01",
    reviewedAgainstSceneIds: ["cinematic-shot-00"],
  }),
  /continuity 0.70 < 0.84/,
);
assert.throws(
  () => assertCinematicKeyframeReview({ ...valid, reviewedAgainstSceneIds: [] }, {
    sceneId: "cinematic-shot-01",
    reviewedAgainstSceneIds: ["cinematic-shot-00"],
  }),
  /reference lineage/,
);
