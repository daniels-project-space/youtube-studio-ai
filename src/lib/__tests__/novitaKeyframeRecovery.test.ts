import assert from "node:assert/strict";
import {
  reviewKeyframesBeforeVideo,
  type NovitaGeneratedScene,
} from "@/lib/novitaMedia";
import { CinematicKeyframeRejectedError } from "@/lib/cinematicKeyframeGate";
import { CinematicClipRejectedError } from "@/lib/cinematicClipGate";
import type { CinematicKeyframeReview } from "@/engine/cinematicKeyframeReview";
import type { NovitaBillingReceipt } from "@/lib/novitaRenderFarm";

const scene: NovitaGeneratedScene = {
  id: "cinematic-shot-retry",
  imagePrompt: "Faceless mannequin in a charcoal wool overcoat holds the same brass key in a rain-soaked station.",
  motionPrompt: "Slow dolly toward the key while the mannequin stays faceless.",
  durationSec: 4,
  continuityIds: ["mannequin-investigator"],
};

const review: CinematicKeyframeReview = {
  version: "cinematic-keyframe-review/v2",
  reviewer: "non_google_vision",
  sceneId: scene.id,
  reviewedAgainstSceneIds: [],
  expectedCastIds: ["mannequin-investigator"],
  forbidAdditionalPeople: true,
  onlyExpectedCastVisible: true,
  semanticAlignment: 0.9,
  composition: 0.9,
  continuity: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true,
  pass: true,
  notes: ["Corrected still preserves the declared mannequin and key."],
};
const receipt = {} as NovitaBillingReceipt;

async function main(): Promise<void> {
let reviews = 0;
let replacementInput: { repairId: string; attempt: number; prompt: string; remainingCostUsd: number } | undefined;
const recovered = await reviewKeyframesBeforeVideo({
  scenes: [scene],
  stillByShot: new Map([[scene.id, "initial.png"]]),
  maxImageAttempts: 2,
  imageCostUsd: 0.1,
  imageMaxCostUsd: 0.7,
  imageReceipts: [receipt],
  review: async ({ stillKey }) => {
    reviews += 1;
    if (reviews === 1) throw new CinematicKeyframeRejectedError(scene.id, ["candidate has a visible face and no brass key"]);
    assert.equal(stillKey, "replacement.png");
    return review;
  },
  renderReplacement: async (input) => {
    replacementInput = input;
    return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
  },
});

assert.equal(reviews, 2, "the repaired still must be independently re-reviewed");
assert.equal(recovered.stillByShot.get(scene.id), "replacement.png");
assert.equal(recovered.imageCostUsd, 0.2);
assert.equal(recovered.imageReceipts.length, 2);
assert.equal(replacementInput?.repairId, "cinematic-shot-retry-keyframe-retry-2");
assert.equal(replacementInput?.attempt, 2);
assert.match(replacementInput?.prompt ?? "", /keyframe correction 2\/2/);
assert.ok((replacementInput?.remainingCostUsd ?? 0) > 0);

let checkpointOrderingReviews = 0;
let checkpointOrderingReplacementCalls = 0;
const checkpointOrder: string[] = [];
await reviewKeyframesBeforeVideo({
  scenes: [scene],
  stillByShot: new Map([[scene.id, "initial.png"]]),
  maxImageAttempts: 2,
  imageCostUsd: 0.1,
  imageMaxCostUsd: 0.7,
  imageReceipts: [receipt],
  review: async () => {
    checkpointOrderingReviews += 1;
    if (checkpointOrderingReviews === 1) {
      throw new CinematicKeyframeRejectedError(scene.id, ["candidate needs a durable repair record first"]);
    }
    return review;
  },
  checkpointReview: async (event) => {
    checkpointOrder.push(`${event.verdict}:${event.stillKey}`);
  },
  renderReplacement: async () => {
    checkpointOrderingReplacementCalls += 1;
    checkpointOrder.push("replacement-render");
    return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
  },
});
assert.deepEqual(
  checkpointOrder,
  ["rejected:initial.png", "replacement-render", "accepted:replacement.png"],
  "the rejected keyframe checkpoint completes before the one permitted replacement render",
);
assert.equal(checkpointOrderingReplacementCalls, 1);

let checkpointFailureReplacementCalls = 0;
await assert.rejects(
  reviewKeyframesBeforeVideo({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "initial.png"]]),
    maxImageAttempts: 2,
    imageCostUsd: 0.1,
    imageMaxCostUsd: 0.7,
    imageReceipts: [receipt],
    review: async () => {
      throw new CinematicKeyframeRejectedError(scene.id, ["durable audit must succeed before replacement"]);
    },
    checkpointReview: async () => {
      throw new Error("visual attempt ledger write failed");
    },
    renderReplacement: async () => {
      checkpointFailureReplacementCalls += 1;
      return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
    },
  }),
  /visual attempt ledger write failed/,
  "a failed keyframe checkpoint aborts before buying a replacement still",
);
assert.equal(checkpointFailureReplacementCalls, 0, "a failed keyframe checkpoint permits no paid replacement");

let failedReviews = 0;
let persistentReplacementCalls = 0;
await assert.rejects(
  reviewKeyframesBeforeVideo({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "initial.png"]]),
    maxImageAttempts: 2,
    imageCostUsd: 0.1,
    imageMaxCostUsd: 0.7,
    imageReceipts: [receipt],
    review: async () => {
      failedReviews += 1;
      throw new CinematicKeyframeRejectedError(scene.id, ["persistent broken anatomy"]);
    },
    renderReplacement: async () => {
      persistentReplacementCalls += 1;
      return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
    },
  }),
  /persistent broken anatomy/,
);
assert.equal(failedReviews, 2, "the recovery budget may not buy an unbounded third still");
assert.equal(persistentReplacementCalls, 1, "the second visual rejection must not buy a second still replacement");

let replacementCalls = 0;
let unavailableReviews = 0;
await assert.rejects(
  reviewKeyframesBeforeVideo({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "initial.png"]]),
    maxImageAttempts: 2,
    imageCostUsd: 0.1,
    imageMaxCostUsd: 0.7,
    imageReceipts: [receipt],
    review: async () => {
      unavailableReviews += 1;
      throw new Error("cinematic keyframe gate: malformed reviewer verdict");
    },
    renderReplacement: async () => {
      replacementCalls += 1;
      return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
    },
  }),
  /malformed reviewer verdict/,
  "a reviewer outage or malformed receipt must fail before buying another Z-Image still",
);
assert.equal(unavailableReviews, 1, "unavailable review evidence must not be retried as a visual repair");
assert.equal(replacementCalls, 0, "only a typed pixel-review rejection may buy the bounded repair still");

let wrongArtifactReplacementCalls = 0;
await assert.rejects(
  reviewKeyframesBeforeVideo({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "initial.png"]]),
    maxImageAttempts: 2,
    imageCostUsd: 0.1,
    imageMaxCostUsd: 0.7,
    imageReceipts: [receipt],
    review: async () => {
      throw new CinematicClipRejectedError(scene.id, ["a moving take failed elsewhere"]);
    },
    renderReplacement: async () => {
      wrongArtifactReplacementCalls += 1;
      return { stillKey: "replacement.png", costUsd: 0.1, billingReceipt: receipt };
    },
  }),
  /moving take failed elsewhere/,
  "a typed video rejection cannot authorize an image replacement",
);
assert.equal(wrongArtifactReplacementCalls, 0, "wrong-artifact evidence must fail closed");
}

void main();
