import assert from "node:assert/strict";
import { failureReason } from "../failureReason";

assert.deepEqual(
  failureReason("mystery_stage: failed at /tmp/private-run/video_finished.mp4"),
  { block: "mystery_stage", reason: "failed at [path]" },
);
assert.equal(
  failureReason("mystery_stage: authorization=Bearer-super-secret").reason,
  "authorization [redacted]",
);
assert.equal(
  failureReason("mystery_stage: failed without a provider detail").reason,
  "failed without a provider detail",
);
assert.deepEqual(
  failureReason("thumbnail_gen: YouTube upload rejected because refresh token expired"),
  {
    block: "thumbnail_gen",
    reason: "YouTube upload rejected",
    hint: "Re-check tags or the YouTube OAuth token.",
    recovery: "youtube_connection",
  },
);

console.log("Failure reason fallback redaction tests passed");
