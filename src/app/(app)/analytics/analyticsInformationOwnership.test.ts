import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(app)/analytics/page.tsx", "utf8");

assert.doesNotMatch(page, /ArtifactWorkRail|Visible work behind the numbers|api\.videos\.listVideos/,
  "Analytics must not duplicate the Library's saved-media surface or subscribe to its video query");
assert.match(page, /api\.analytics\.overview/);
assert.match(page, /api\.analytics\.channelSummary/);
assert.match(page, /api\.analytics\.refreshStatus/);
assert.match(page, /api\.analytics\.channelTrend/);
assert.match(page, /<QualityLearningPanel/);
assert.match(page, /<CompetitorsSection ownerId=\{ownerId\} selected=\{selected\}/);
assert.match(page, /ANALYTICS_FLEET_PAGE_SIZE/);
assert.match(page, /ranked\.slice\(0, visibleLimit\)/);
assert.match(page, /setVisibleLimit\(ANALYTICS_FLEET_PAGE_SIZE\)/);
assert.match(page, /nextAnalyticsFleetLimit\(current, ranked\.length\)/);
assert.match(page, /function CompetitorPrompt/);
assert.doesNotMatch(page, /title="Select a channel"[\s\S]{0,200}<EmptyState/);

console.log("Analytics information ownership contracts passed");
