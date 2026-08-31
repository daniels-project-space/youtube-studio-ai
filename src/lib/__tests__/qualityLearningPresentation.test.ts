import assert from "node:assert/strict";

import {
  describeQualityLearningOpening,
  qualityLearningInsightsFromUnknown,
} from "@/lib/qualityLearningPresentation";

const insights = qualityLearningInsightsFromUnknown([
  {
    _id: "older",
    kind: "retention_rule",
    channelId: "channel-1",
    status: "proposed",
    createdAt: 100,
    sourceVideoIds: ["video-1"],
    offlineEvaluation: { sampleSize: 120, passed: true },
    proposal: {
      diagnosis: "  A clear opening diagnosis.  ",
      openingRetention: {
        status: "measured",
        scope: "youtube_intro_30_sec",
        targetSec: 30,
        observedRetentionRatio: 0.62,
        observedRelativeRetention: 0.94,
      },
      nextValue: { mustNotLeak: true },
    },
  },
  {
    _id: "newer",
    kind: "retention_rule",
    channelId: "channel-2",
    status: "approved",
    createdAt: 200,
    sourceVideoIds: ["video-2", 7],
    offlineEvaluation: { sampleSize: 99, passed: false },
    proposal: { openingRetention: { status: "unavailable" } },
  },
  { _id: "show-bible", kind: "show_bible", channelId: "channel-3" },
  { _id: "broken", kind: "retention_rule", channelId: "channel-3", status: "proposed" },
]);

assert.equal(insights.length, 2);
assert.equal(insights[0]?.id, "newer", "newest retention evidence is shown first");
assert.equal(insights[0]?.sourceVideoCount, 1, "only durable video IDs are counted");
assert.equal(insights[0]?.opening.status, "unavailable");
assert.equal(insights[1]?.diagnosis, "A clear opening diagnosis.");
assert.equal(insights[1]?.opening.status, "measured");
if (insights[1]?.opening.status === "measured") {
  assert.equal(
    describeQualityLearningOpening(insights[1].opening),
    "30-second intro 62% at 30.0s · relative 94%",
  );
}

console.log("quality learning presentation tests passed");
