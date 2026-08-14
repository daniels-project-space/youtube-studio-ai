import assert from "node:assert/strict";
import {
  reviewClipsBeforeAssembly,
  type NovitaGeneratedScene,
} from "@/lib/novitaMedia";
import type { CinematicClipReview } from "@/engine/cinematicClipReview";
import type { NovitaBillingReceipt } from "@/lib/novitaRenderFarm";

const scene: NovitaGeneratedScene = {
  id: "cinematic-shot-motion-retry",
  imagePrompt: "A faceless mannequin in a charcoal wool overcoat folds a brass-key timetable in a rain-soaked station.",
  motionPrompt: "Slow dolly toward the brass key as the mannequin folds the timetable and looks toward the departure board.",
  durationSec: 4,
  continuityIds: ["mannequin-investigator"],
};
const review: CinematicClipReview = {
  version: "cinematic-clip-review/v1",
  reviewer: "non_google_vision",
  sceneId: scene.id,
  sampleOffsetsSec: [0.2, 2, 3.8],
  semanticAlignment: 0.9,
  motionIntegrity: 0.9,
  continuity: 0.9,
  endBeat: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true,
  pass: true,
  notes: ["The exact coat, key, station, dolly, and readable end reaction remain intact."],
};
const receipt = {} as NovitaBillingReceipt;

async function main(): Promise<void> {
  let reviews = 0;
  let replacementInput: { repairId: string; attempt: number; motionPrompt: string; remainingCostUsd: number } | undefined;
  const recovered = await reviewClipsBeforeAssembly({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "accepted.png"]]),
    clipByShot: new Map([[scene.id, "initial.mp4"]]),
    maxVideoAttempts: 2,
    videoCostUsd: 0.4,
    videoMaxCostUsd: 1.2,
    videoReceipts: [receipt],
    review: async ({ clipKey }) => {
      reviews += 1;
      if (reviews === 1) throw new Error("candidate freezes after the first frame and loses the key");
      assert.equal(clipKey, "replacement.mp4");
      return review;
    },
    renderReplacement: async (input) => {
      replacementInput = input;
      return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
    },
  });

  assert.equal(reviews, 2, "the repaired take must be independently re-reviewed");
  assert.equal(recovered.clipByShot.get(scene.id), "replacement.mp4");
  assert.equal(recovered.videoCostUsd, 0.8);
  assert.equal(recovered.videoReceipts.length, 2);
  assert.equal(replacementInput?.repairId, "cinematic-shot-motion-retry-motion-retry-2");
  assert.equal(replacementInput?.attempt, 2);
  assert.match(replacementInput?.motionPrompt ?? "", /motion correction 2\/2/);
  assert.ok((replacementInput?.remainingCostUsd ?? 0) > 0);

  let failedReviews = 0;
  await assert.rejects(
    reviewClipsBeforeAssembly({
      scenes: [scene],
      stillByShot: new Map([[scene.id, "accepted.png"]]),
      clipByShot: new Map([[scene.id, "initial.mp4"]]),
      maxVideoAttempts: 2,
      videoCostUsd: 0.4,
      videoMaxCostUsd: 1.2,
      videoReceipts: [receipt],
      review: async () => {
        failedReviews += 1;
        throw new Error("persistent motion morph");
      },
      renderReplacement: async () => ({ clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt }),
    }),
    /persistent motion morph/,
  );
  assert.equal(failedReviews, 2, "the recovery budget may not buy an unbounded third LTX take");
}

void main();
