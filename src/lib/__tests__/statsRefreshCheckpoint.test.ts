import assert from "node:assert/strict";
import {
  STATS_REFRESH_CADENCE_MS,
  STATS_REFRESH_FRESHNESS_CADENCE_MS,
  STATS_REFRESH_HISTORY_PAGE_LIMIT,
  STATS_REFRESH_MAX_CHANNELS_PER_RUN,
  STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH,
  STATS_REFRESH_RECENT_PAGE_LIMIT,
  selectStatsRefreshChannels,
  selectStatsRefreshWorkChannels,
  selectStatsRefreshVideoIds,
  planStatsRefreshScan,
  statsRefreshCadenceKey,
} from "@/lib/statsRefreshCheckpoint";

const now = 18 * STATS_REFRESH_CADENCE_MS;
assert.equal(statsRefreshCadenceKey(now), statsRefreshCadenceKey(now + 10_000));
assert.notEqual(
  statsRefreshCadenceKey(now),
  statsRefreshCadenceKey(now + STATS_REFRESH_CADENCE_MS),
);

const fleet = Array.from({ length: STATS_REFRESH_MAX_CHANNELS_PER_RUN + 5 }, (_, index) => ({
  _id: `channels:${String(index).padStart(3, "0")}`,
}));
const firstPage = selectStatsRefreshChannels(fleet, now);
const secondPage = selectStatsRefreshChannels(fleet, now + STATS_REFRESH_CADENCE_MS);
assert.equal(firstPage.length, STATS_REFRESH_MAX_CHANNELS_PER_RUN);
assert.equal(secondPage.length, 5);
assert.equal(
  new Set([...firstPage, ...secondPage].map((channel) => channel._id)).size,
  fleet.length,
  "rotation must cover every channel without expanding a single run's budget",
);

assert.deepEqual(planStatsRefreshScan(undefined, now), {
  mode: "freshness",
  startedAfter: Math.max(0, now - 30 * 24 * 60 * 60 * 1_000),
  cursor: null,
});
assert.deepEqual(
  planStatsRefreshScan({ freshnessNextAt: now + 1, historyCursor: "history:2" }, now),
  { mode: "history", startedAfter: 0, cursor: "history:2" },
);
assert.deepEqual(
  planStatsRefreshScan(
    { freshnessNextAt: now + 1, historyCompletedAt: now - 1, historyCursor: "ignored" },
    now,
  ),
  { mode: "rollup" },
  "a completed history scan must never automatically restart at cursor null",
);
assert.deepEqual(
  planStatsRefreshScan(
    {
      freshnessWindowStartedAfter: 0,
      freshnessCursor: "fresh:3",
      freshnessNextAt: now + STATS_REFRESH_FRESHNESS_CADENCE_MS,
    },
    now,
  ),
  { mode: "freshness", startedAfter: 0, cursor: "fresh:3" },
);

const selected = selectStatsRefreshVideoIds(
  [{ youtubeVideoId: "newest" }, { youtubeVideoId: "overlap" }, { youtubeVideoId: "" }],
  [{ youtubeVideoId: "overlap" }, { youtubeVideoId: "older" }],
);
assert.deepEqual(selected, ["newest", "overlap", "older"]);
assert.equal(
  selectStatsRefreshVideoIds(
    Array.from({ length: STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH + 8 }, (_, index) => ({
      youtubeVideoId: `video-${index}`,
    })),
    [],
  ).length,
  STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH,
);
const activeFirst = selectStatsRefreshWorkChannels(
  [{ _id: "channels:999" }],
  fleet,
  0,
  2,
);
assert.deepEqual(
  activeFirst.map((channel) => channel._id),
  ["channels:999", "channels:000"],
  "an interrupted batch must not be starved by fleet rotation",
);
assert.ok(
  STATS_REFRESH_RECENT_PAGE_LIMIT + STATS_REFRESH_HISTORY_PAGE_LIMIT <=
    STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH,
  "a planned batch must fit one bounded video-stat request",
);
assert.throws(() => selectStatsRefreshVideoIds([], [], STATS_REFRESH_MAX_VIDEO_IDS_PER_BATCH + 1));

console.log("STATS REFRESH CHECKPOINT TESTS PASS");
