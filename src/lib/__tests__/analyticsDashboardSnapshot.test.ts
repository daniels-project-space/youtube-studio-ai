import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "convex/analytics.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/analytics/page.tsx"), "utf8");
const snapshot = source.slice(source.indexOf("export const dashboardSnapshot"), source.indexOf("export const ownerTrends"));

assert.match(page, /useQuery\(api\.analytics\.dashboardSnapshot, \{ ownerId \}\)/);
assert.doesNotMatch(page, /useQuery\(api\.analytics\.(overview|channelSummary|refreshStatus), \{ ownerId \}\)/,
  "Analytics must not keep three overlapping fleet subscriptions");
assert.match(snapshot, /ctx\.db\.query\("runs"\)[\s\S]*?withIndex\("by_owner"/);
assert.match(snapshot, /ctx\.db\.query\("planBatches"\)[\s\S]*?withIndex\("by_owner"/);
assert.match(snapshot, /const currentRuns = runs\.filter\(hasFrozenPipelineProvenance\)/,
  "current analytics must exclude legacy rows without a frozen pipeline receipt");
assert.match(snapshot, /ctx\.db\.query\("youtubeAuth"\)[\s\S]*?withIndex\("by_channel"[\s\S]*?\.unique\(\)/);
assert.match(snapshot, /ctx\.db\.query\("analyticsRefreshCursors"\)[\s\S]*?withIndex\("by_owner_channel"[\s\S]*?\.unique\(\)/);
assert.doesNotMatch(snapshot, /ctx\.db\.query\("youtubeAuth"\)[^;]*withIndex\("by_owner"[^;]*\.collect\(\)/,
  "dashboard connector status must not collect the owner history");
assert.doesNotMatch(snapshot, /ctx\.db\.query\("analyticsRefreshCursors"\)[^;]*withIndex\("by_owner"[^;]*\.collect\(\)/,
  "dashboard refresh status must not collect the owner history");
assert.match(snapshot, /return \{[\s\S]*overview:[\s\S]*summary,[\s\S]*refreshStatus,/);

console.log("analytics dashboard snapshot consolidation passed");
