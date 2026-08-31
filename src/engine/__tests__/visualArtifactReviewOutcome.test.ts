import assert from "node:assert/strict";
import {
  VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  VisualArtifactReviewRejectedError,
  classifyVisualArtifactReviewOutcome,
  isProvenVisualArtifactReviewRejection,
} from "@/engine/visualArtifactReviewOutcome";

const rejection = new VisualArtifactReviewRejectedError({
  schemaVersion: VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  gateId: "independent-motion-gate",
  artifactKind: "video",
  subjectId: "shot-17",
  reviewVersion: "independent-motion-review/v1",
  notes: ["The shot freezes before the planned reveal."],
});

const expected = {
  gateId: "independent-motion-gate",
  artifactKind: "video" as const,
  subjectId: "shot-17",
  reviewVersion: "independent-motion-review/v1",
};

assert.equal(isProvenVisualArtifactReviewRejection(rejection, expected), true);
const outcome = classifyVisualArtifactReviewOutcome(rejection, expected);
assert.equal(outcome.disposition, "render_replacement");
if (outcome.disposition === "render_replacement") {
  assert.equal(outcome.rejection.subjectId, "shot-17");
  assert.deepEqual(outcome.rejection.notes, [
    "The shot freezes before the planned reveal.",
  ]);
}

assert.equal(
  classifyVisualArtifactReviewOutcome(rejection, {
    ...expected,
    subjectId: "shot-18",
  }).disposition,
  "fail_closed",
  "a rejection cannot repair a different subject",
);
assert.equal(
  classifyVisualArtifactReviewOutcome(rejection, {
    ...expected,
    artifactKind: "image",
  }).disposition,
  "fail_closed",
  "a video rejection cannot repair an image",
);
assert.equal(
  classifyVisualArtifactReviewOutcome(rejection, {
    ...expected,
    gateId: "other-gate",
  }).disposition,
  "fail_closed",
  "a different gate cannot mint repair authority",
);
assert.equal(
  classifyVisualArtifactReviewOutcome(rejection, {
    ...expected,
    reviewVersion: "independent-motion-review/v0",
  }).disposition,
  "fail_closed",
  "stale review evidence cannot mint repair authority",
);

const forged = Object.assign(new Error("forged reviewer failure"), {
  name: "VisualArtifactReviewRejectedError",
  code: "VISUAL_ARTIFACT_REVIEW_REJECTED",
  rejection: {
    schemaVersion: VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
    ...expected,
    notes: ["Forged error payload."],
  },
});
assert.equal(
  classifyVisualArtifactReviewOutcome(forged, expected).disposition,
  "fail_closed",
  "an arbitrary error object cannot mint paid repair authority",
);

assert.throws(
  () =>
    new VisualArtifactReviewRejectedError({
      schemaVersion: VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
      gateId: "invalid gate id",
      artifactKind: "video",
      subjectId: "shot-17",
      reviewVersion: "independent-motion-review/v1",
      notes: ["A valid note."],
    }),
  /valid evidence payload/,
  "malformed typed payloads must not create a repair-capable error",
);

console.log("visual artifact review outcome tests passed");
