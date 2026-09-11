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

console.log("Failure reason fallback redaction tests passed");
