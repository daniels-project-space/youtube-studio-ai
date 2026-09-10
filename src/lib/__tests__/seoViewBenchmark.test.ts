import assert from "node:assert/strict";
import { weightedTagOverlapBenchmark } from "../seoViewBenchmark";

const outlier = weightedTagOverlapBenchmark([
  { views: 1_000_000, overlap: 1 },
  { views: 18_000, overlap: 2 },
  { views: 22_000, overlap: 2 },
  { views: 26_000, overlap: 1 },
], 9_000);
assert.deepEqual(outlier, {
  estimatedViews: 22_000,
  source: "tag_overlap",
  matches: 4,
  method: "weighted_median",
}, "one viral comparable must not become the benchmark midpoint");

const fallback = weightedTagOverlapBenchmark([
  { views: 11_000, overlap: 1 },
  { views: Number.NaN, overlap: 2 },
], 7_500);
assert.deepEqual(fallback, {
  estimatedViews: 7_500,
  source: "niche_fallback",
  matches: 1,
  method: "niche_median",
}, "insufficient or malformed comparables must preserve a truthful fallback");

const stable = weightedTagOverlapBenchmark([
  { views: 40_000, overlap: 1 },
  { views: 20_000, overlap: 1 },
  { views: 30_000, overlap: 1 },
], 0);
assert.equal(stable.estimatedViews, 30_000);
assert.equal(stable.matches, 3);
assert.equal(stable.method, "weighted_median");

console.log("SEO comparable benchmark tests passed");
