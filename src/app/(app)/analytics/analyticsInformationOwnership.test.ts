import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(app)/analytics/page.tsx", "utf8");

assert.doesNotMatch(page, /ArtifactWorkRail|Visible work behind the numbers|api\.videos\.listVideos/,
  "Analytics must not duplicate the Library's saved-media surface or subscribe to its video query");
assert.match(page, /api\.analytics\.dashboardSnapshot/);
assert.match(page, /const overview = dashboard\?\.overview/);
assert.match(page, /const summary = dashboard\?\.summary/);
assert.match(page, /const refreshStatus = dashboard\?\.refreshStatus/);
assert.match(page, /api\.analytics\.channelTrend/);
assert.match(page, /Portfolio analytics/,
  "the all-channel dashboard should identify the operator's portfolio, not spend a hero on generic copy");
assert.match(page, /Observed reach, committed spend, and released inventory/);
assert.doesNotMatch(page, /observationState/,
  "the hero must not repeat the separate, actionable connection-health panel");
const analyticsHeroStart = page.indexOf("function AnalyticsHero");
const analyticsSnapshotMapStart = page.indexOf("function AnalyticsSnapshotMap");
assert.ok(analyticsHeroStart >= 0 && analyticsSnapshotMapStart > analyticsHeroStart,
  "the retained snapshot map stays outside the compact hero");
assert.doesNotMatch(page.slice(analyticsHeroStart, analyticsSnapshotMapStart), /<FleetEfficiencyField/,
  "the hero should lead with metrics, while the map remains a secondary detail surface");
assert.match(page, /<QualityLearningPanel/);
assert.match(page, /<CompetitorsSection ownerId=\{ownerId\} selected=\{selected\}/);
assert.match(page, /ANALYTICS_FLEET_PAGE_SIZE/);
assert.match(page, /ranked\.slice\(0, visibleLimit\)/);
assert.match(page, /setVisibleLimit\(ANALYTICS_FLEET_PAGE_SIZE\)/);
assert.match(page, /nextAnalyticsFleetLimit\(current, ranked\.length\)/);
assert.match(page, /function CompetitorPrompt/);
assert.doesNotMatch(page, /title="Select a channel"[\s\S]{0,200}<EmptyState/);

console.log("Analytics information ownership contracts passed");
