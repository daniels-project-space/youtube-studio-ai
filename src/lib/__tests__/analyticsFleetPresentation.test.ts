import assert from "node:assert/strict";
import {
  ANALYTICS_FLEET_PAGE_SIZE,
  nextAnalyticsFleetLimit,
} from "../analyticsFleetPresentation";

assert.equal(ANALYTICS_FLEET_PAGE_SIZE, 6);
assert.equal(nextAnalyticsFleetLimit(6, 13), 12);
assert.equal(nextAnalyticsFleetLimit(12, 13), 13);
assert.equal(nextAnalyticsFleetLimit(6, 4), 4);
assert.equal(nextAnalyticsFleetLimit(Number.NaN, 13), 12);
assert.equal(nextAnalyticsFleetLimit(6, Number.POSITIVE_INFINITY), 0);

console.log("Analytics fleet paging contracts passed");
