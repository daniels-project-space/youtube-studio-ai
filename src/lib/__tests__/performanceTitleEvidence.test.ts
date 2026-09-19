import assert from "node:assert/strict";

import {
  MIN_TITLE_LEARNING_IMPRESSIONS,
  performanceEntriesForLens,
  titlePerformanceEntries,
  type PerfEntry,
} from "@/lib/performance";

const base: PerfEntry = {
  videoId: "video",
  topic: "topic",
  title: "A concrete title",
  publishedAt: 1,
  views: 10_000,
  avgViewPct: 48,
  ctr: 6,
  thumbnailImpressions: MIN_TITLE_LEARNING_IMPRESSIONS,
  updatedAt: 1,
};

const admitted = titlePerformanceEntries([
  base,
  { ...base, videoId: "high-volume", thumbnailImpressions: 60_000 },
  { ...base, videoId: "no-denominator", thumbnailImpressions: undefined },
  { ...base, videoId: "early-noise", thumbnailImpressions: MIN_TITLE_LEARNING_IMPRESSIONS - 1 },
  { ...base, videoId: "no-rate", ctr: undefined },
]);

assert.deepEqual(
  admitted.map((entry) => entry.videoId),
  ["video", "high-volume"],
  "title learning must not teach a CTR rate with missing or sub-threshold impression evidence",
);

const missingRetention = { ...base, videoId: "ctr-without-retention", avgViewPct: 0 };
assert.deepEqual(
  performanceEntriesForLens([base, missingRetention], { lens: "ctr" }).map((entry) => entry.videoId),
  ["video", "ctr-without-retention"],
  "title evidence must remain eligible when the independent retention report is unavailable",
);
assert.deepEqual(
  performanceEntriesForLens([base, missingRetention], { lens: "blended" }).map((entry) => entry.videoId),
  ["video"],
  "whole-video learning still requires retention evidence",
);

console.log("PERFORMANCE TITLE EVIDENCE PASS");
