import assert from "node:assert/strict";

import {
  deriveAudienceOpeningRetention,
  describeAudienceOpeningRetention,
} from "@/lib/audienceRetentionOpening";

const longForm = deriveAudienceOpeningRetention({
  durationSec: 300,
  curve: [
    { ratio: 0, watch: 1, relative: 1 },
    { ratio: 0.05, watch: 0.76, relative: 0.95 },
    { ratio: 0.15, watch: 0.58, relative: 0.82 },
    { ratio: 1, watch: 0.22, relative: 0.64 },
  ],
});
assert.equal(longForm.status, "measured");
if (longForm.status === "measured") {
  assert.equal(longForm.scope, "youtube_intro_30_sec");
  assert.equal(longForm.targetSec, 30);
  assert.equal(longForm.targetRatio, 0.1);
  assert.equal(longForm.interpolation, "linear_curve_segment");
  assert.ok(Math.abs(longForm.observedRetentionRatio - 0.67) < 0.000001);
  assert.match(describeAudienceOpeningRetention(longForm), /30-second intro 67%/);
}

const short = deriveAudienceOpeningRetention({
  durationSec: 40,
  curve: [
    { ratio: 0, watch: 1 },
    { ratio: 0.075, watch: 0.81 },
    { ratio: 1, watch: 0.37 },
  ],
});
assert.equal(short.status, "measured");
if (short.status === "measured") {
  assert.equal(short.scope, "short_opening_10pct");
  assert.equal(short.targetSec, 3);
  assert.equal(short.interpolation, "exact_curve_point");
  assert.equal(short.observedRetentionRatio, 0.81);
  assert.doesNotMatch(describeAudienceOpeningRetention(short), /30-second/i);
}

const insufficient = deriveAudienceOpeningRetention({
  durationSec: 300,
  curve: [{ ratio: 0.2, watch: 0.7 }],
});
assert.deepEqual(insufficient, {
  version: "youtube-audience-opening-retention/v1",
  status: "unavailable",
  scope: "youtube_intro_30_sec",
  targetSec: 30,
  targetRatio: 0.1,
  reason: "insufficient_curve_coverage",
});

const invalidDuration = deriveAudienceOpeningRetention({ durationSec: 0, curve: [] });
assert.equal(invalidDuration.status, "unavailable");
if (invalidDuration.status === "unavailable") assert.equal(invalidDuration.reason, "invalid_duration");

console.log("audience opening retention tests passed");
