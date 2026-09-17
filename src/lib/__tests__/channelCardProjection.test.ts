import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const channelsSource = readFileSync(resolve(process.cwd(), "convex/channels.ts"), "utf8");
assert.match(
  channelsSource,
  /import \{ currentLibraryThumbnail \} from "\.\/videos"/,
  "channel-card projection must share the Library thumbnail resolver",
);
assert.match(
  channelsSource,
  /const latestAcceptedRun = recentRuns\.find\(\(run\) => acceptedRunIds\.has\(String\(run\._id\)\)\)/,
  "channel-card projection must anchor thumbnail selection to an accepted run",
);
assert.match(
  channelsSource,
  /const current = await currentLibraryThumbnail\(ctx, \{/,
  "channel-card projection must resolve refreshed candidates and Lo-Fi frames",
);
assert.match(
  channelsSource,
  /withIndex\("by_run_kind", \(q\) => q\.eq\("runId", latestAcceptedRun\._id\)\.eq\("kind", "thumbnail"\)\)/,
  "channel-card projection must read only retained thumbnail media",
);
assert.match(
  channelsSource,
  /withIndex\("by_run_kind", \(q\) => q\.eq\("runId", latestAcceptedRun\._id\)\.eq\("kind", "video"\)\)/,
  "channel-card projection must read only retained video media",
);
assert.doesNotMatch(
  channelsSource,
  /withIndex\("by_channel_kind"[^\n]+kind", \(q\) => q\.eq\("channelId", channel\._id\)/,
  "channel-card projection must not select the newest raw thumbnail independently",
);

console.log("channel card projection tests passed");
