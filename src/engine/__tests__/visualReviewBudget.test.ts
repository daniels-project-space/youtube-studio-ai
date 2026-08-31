import assert from "node:assert/strict";
import {
  COMPLETE_VISUAL_REVIEW_MAX_FRAMES,
  FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST,
  NON_GOOGLE_VISION_MAX_IMAGES_PER_REQUEST,
  completeVisualReviewFocusTimes,
  qaVisualReviewFrameLimits,
  qaVisualReviewProviderCallCount,
  visualReviewProviderBatchCount,
} from "@/engine/visualReviewBudget";

assert.equal(NON_GOOGLE_VISION_MAX_IMAGES_PER_REQUEST, 8);
assert.equal(FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST, 2);
assert.equal(visualReviewProviderBatchCount(2), 1);
assert.equal(visualReviewProviderBatchCount(3), 2);
assert.deepEqual(qaVisualReviewFrameLimits({}), { broadFrames: 48, focusFrames: 24 });
assert.equal(
  qaVisualReviewProviderCallCount({ broadFrames: 48, focusFrames: 24 }),
  36,
  "the configured final-QA envelope must price the same two-image batches the final reviewer executes",
);
assert.deepEqual(
  completeVisualReviewFocusTimes(18, [{ startSec: 7, endSec: 8 }]),
  [7, 7.5, 8],
  "sealed focus timestamps are deterministic and complete at 2fps",
);
assert.throws(
  () => completeVisualReviewFocusTimes(1_000, [{ startSec: 0, endSec: 1_000 }]),
  new RegExp(`${COMPLETE_VISUAL_REVIEW_MAX_FRAMES}-frame safety limit`),
  "an oversized complete-focus request must fail before extraction/provider work",
);

console.log("visual review budget tests passed");
