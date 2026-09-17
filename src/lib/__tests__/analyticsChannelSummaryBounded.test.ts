import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("convex/analytics.ts", "utf8");
const start = source.indexOf("export const channelSummary");
const end = source.indexOf("export const refreshStatus", start);
assert.ok(start >= 0 && end > start, "channelSummary query remains present");
const summary = source.slice(start, end);

assert.match(summary, /query\("runs"\)\s*\.withIndex\("by_owner"/,
  "channel summaries should share one owner-scoped run history read");
assert.match(summary, /query\("planBatches"\)\s*\.withIndex\("by_owner"/,
  "channel summaries should share one owner-scoped planning history read");
assert.match(summary, /runsByChannel/);
assert.match(summary, /batchesByChannel/);
assert.doesNotMatch(summary, /query\("runs"\)[\s\S]*?withIndex\("by_channel"/,
  "channel summaries must not repeat an unbounded run scan per channel");
assert.doesNotMatch(summary, /query\("planBatches"\)[\s\S]*?withIndex\("by_channel"/,
  "channel summaries must not repeat an unbounded plan-batch scan per channel");

const trendStart = source.indexOf("export const ownerTrends");
const trendEnd = source.indexOf("export const videoSnapshotProvenance", trendStart);
const trends = source.slice(trendStart, trendEnd);
assert.match(trends, /Math\.min\(Math\.floor\(args\.days\), 365\)/,
  "owner trend windows must cap explicit oversized requests");

console.log("Analytics channel summary bounded-read contracts passed");
