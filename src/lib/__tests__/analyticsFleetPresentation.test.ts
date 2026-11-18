import assert from "node:assert/strict";
import {
  ANALYTICS_FLEET_PAGE_SIZE,
  analyticsFleetRowsForMetric,
  nextAnalyticsFleetLimit,
} from "../analyticsFleetPresentation";

assert.equal(ANALYTICS_FLEET_PAGE_SIZE, 6);
assert.equal(nextAnalyticsFleetLimit(6, 13), 12);
assert.equal(nextAnalyticsFleetLimit(12, 13), 13);
assert.equal(nextAnalyticsFleetLimit(6, 4), 4);
assert.equal(nextAnalyticsFleetLimit(Number.NaN, 13), 12);
assert.equal(nextAnalyticsFleetLimit(6, Number.POSITIVE_INFINITY), 0);
const fleet = [{ channelId: "zero", totalViews: 0 }, { channelId: "missing", totalViews: 0 }];
const snapshots = new Set(["zero"]);
assert.deepEqual(analyticsFleetRowsForMetric(fleet, "totalViews", snapshots), [fleet[0]], "recorded zero is not confused with an absent snapshot");
assert.deepEqual(analyticsFleetRowsForMetric(fleet, "subscriberCount", snapshots), [fleet[0]]);
assert.deepEqual(analyticsFleetRowsForMetric(fleet, "costTotal", snapshots), fleet, "spend remains available without YouTube analytics");
assert.deepEqual(analyticsFleetRowsForMetric(fleet, "videoCount", snapshots), fleet, "saved upload IDs remain available without a snapshot");

console.log("Analytics fleet paging contracts passed");
