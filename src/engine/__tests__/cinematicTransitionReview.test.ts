import assert from "node:assert/strict";

import {
  assertCinematicTransitionReview,
  CINEMATIC_TRANSITION_REVIEW_VERSION,
} from "@/engine/cinematicTransitionReview";

const accepted = {
  version: CINEMATIC_TRANSITION_REVIEW_VERSION,
  reviewer: "non_google_vision" as const,
  fromSceneId: "cinematic-shot-transition-a",
  toSceneId: "cinematic-shot-transition-b",
  cutReason: "reveal",
  tensionState: "reversal",
  semanticContinuity: 0.9,
  visualProgression: 0.91,
  cutMotivation: 0.9,
  artifactFree: 0.92,
  textWatermarkFree: true as const,
  pass: true as const,
  notes: ["The evidence insert resolves into a visibly distinct but motivated reveal."],
};

assert.equal(
  assertCinematicTransitionReview(accepted, {
    fromSceneId: accepted.fromSceneId,
    toSceneId: accepted.toSceneId,
    cutReason: accepted.cutReason,
    tensionState: accepted.tensionState,
  }).pass,
  true,
);

const mismatchedCut = { ...accepted, cutReason: "new_fact" };
assert.throws(
  () => assertCinematicTransitionReview(mismatchedCut, {
    fromSceneId: accepted.fromSceneId,
    toSceneId: accepted.toSceneId,
    cutReason: accepted.cutReason,
    tensionState: accepted.tensionState,
  }),
  /approved cut rationale/,
);

const lowProgression = { ...accepted, visualProgression: 0.4 };
assert.throws(
  () => assertCinematicTransitionReview(lowProgression, {
    fromSceneId: accepted.fromSceneId,
    toSceneId: accepted.toSceneId,
    cutReason: accepted.cutReason,
    tensionState: accepted.tensionState,
  }),
  /visual progression/,
);

console.log("Cinematic transition review tests passed");
