import assert from "node:assert/strict";
import {
  CinematicClipRejectedError,
  assertCinematicClipReviewerVerdictAccepted,
} from "@/lib/cinematicClipGate";
import {
  CINEMATIC_CLIP_MIN_SCORE,
  CINEMATIC_CLIP_REVIEW_VERSION,
} from "@/engine/cinematicClipReview";
import { isProvenVisualArtifactReviewRejection } from "@/engine/visualArtifactReviewOutcome";

const acceptedVerdict = {
  semanticAlignment: 0.92,
  motionIntegrity: 0.92,
  continuity: 0.92,
  endBeat: 0.92,
  artifactFree: 0.92,
  textWatermarkFree: true,
  onlyExpectedCastVisible: true,
  pass: true,
  notes: ["The continuous action and endpoint are both visible."],
};

function assertTypedVisualRejection(
  verdict: unknown,
  terminalFrameRequired = false,
): void {
  assert.throws(
    () => assertCinematicClipReviewerVerdictAccepted({
      sceneId: "cinematic-shot-gate-outcome",
      verdict,
      terminalFrameRequired,
    }),
    (error: unknown) =>
      error instanceof CinematicClipRejectedError &&
      isProvenVisualArtifactReviewRejection(error, {
        gateId: "cinematic-clip",
        artifactKind: "video",
        subjectId: "cinematic-shot-gate-outcome",
        reviewVersion: CINEMATIC_CLIP_REVIEW_VERSION,
      }),
    "a complete reviewer verdict that proves a visual failure must be typed",
  );
}

assert.deepEqual(
  assertCinematicClipReviewerVerdictAccepted({
    sceneId: "cinematic-shot-gate-outcome",
    verdict: acceptedVerdict,
    terminalFrameRequired: false,
  }),
  acceptedVerdict,
);

assertTypedVisualRejection({
  ...acceptedVerdict,
  motionIntegrity: CINEMATIC_CLIP_MIN_SCORE - 0.01,
});
assertTypedVisualRejection({
  ...acceptedVerdict,
  terminalFrameAlignment: CINEMATIC_CLIP_MIN_SCORE - 0.01,
}, true);
assertTypedVisualRejection({ ...acceptedVerdict, pass: false });
assertTypedVisualRejection({ ...acceptedVerdict, textWatermarkFree: false });
assertTypedVisualRejection({ ...acceptedVerdict, onlyExpectedCastVisible: false });

assert.throws(
  () => assertCinematicClipReviewerVerdictAccepted({
    sceneId: "cinematic-shot-gate-outcome",
    verdict: { ...acceptedVerdict, motionIntegrity: "not-a-score" },
    terminalFrameRequired: false,
  }),
  (error: unknown) =>
    !(error instanceof CinematicClipRejectedError) &&
    error instanceof Error &&
    /malformed reviewer verdict/.test(error.message),
  "malformed reviewer evidence remains an ordinary fail-closed error",
);

console.log("cinematic clip gate outcome tests passed");
