import assert from "node:assert/strict";

import {
  assertPlanWeekThumbnailSource,
  isDeferredRenderedFrameSource,
  planWeekThumbnailSourceForChannel,
} from "@/lib/planWeekThumbnailSource";

assert.equal(planWeekThumbnailSourceForChannel({ family: "music_loop" }), "rendered_video_frame");
assert.equal(
  planWeekThumbnailSourceForChannel({ contentLane: { key: "lofi_music_loop" } }),
  "rendered_video_frame",
);
assert.equal(
  planWeekThumbnailSourceForChannel({ family: "narrated_stock", contentLane: { key: "narrated_stock" } }),
  "planner_artwork",
);
assert.equal(isDeferredRenderedFrameSource("rendered_video_frame"), true);
assert.equal(isDeferredRenderedFrameSource("planner_artwork"), false);
assert.throws(() => assertPlanWeekThumbnailSource("generic_lofi_art"));

console.log("plan-week thumbnail-source policy tests passed");
