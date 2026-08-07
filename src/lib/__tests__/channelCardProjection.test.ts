import assert from "node:assert/strict";
import {
  isAcceptedChannelArtworkRun,
  summarizeChannelCardRuns,
} from "../channelCardProjection";

assert.equal(isAcceptedChannelArtworkRun({ status: "failed" }), false);
assert.equal(isAcceptedChannelArtworkRun({ status: "running" }), false);
assert.equal(isAcceptedChannelArtworkRun({ status: "ok" }), true);
assert.equal(
  isAcceptedChannelArtworkRun({ status: "failed", youtubeVideoId: "published-id" }),
  true,
  "an uploaded/published run remains valid artwork provenance even if later cleanup failed",
);

assert.deepEqual(
  summarizeChannelCardRuns([
    { status: "ok", youtubeVideoId: "video-1", costTotal: 1.25 },
    { status: "failed", costTotal: 0.5 },
  ]),
  {
    recentRunCount: 2,
    recentPublishedCount: 1,
    recentSpend: 1.75,
    lastRunStatus: "ok",
  },
);

console.log("channel card projection tests passed");
