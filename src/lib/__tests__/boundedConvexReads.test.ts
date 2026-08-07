import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHANNEL_PLAN_LIMIT,
  OWNER_PLAN_LIMIT,
  RECENT_RUNS_LIMIT,
  RUN_HISTORY_PAGE_LIMIT,
  RUNS_BY_CHANNEL_LIMIT,
  validatedReadLimit,
} from "@/lib/boundedConvexReads";

assert.equal(validatedReadLimit(undefined, RECENT_RUNS_LIMIT), 10);
assert.equal(validatedReadLimit(200, RECENT_RUNS_LIMIT), 200);
for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 201]) {
  assert.throws(
    () => validatedReadLimit(invalid, RECENT_RUNS_LIMIT),
    /integer between 1 and 200/,
  );
}
assert.equal(validatedReadLimit(undefined, RUNS_BY_CHANNEL_LIMIT), 200);
assert.throws(() => validatedReadLimit(501, RUNS_BY_CHANNEL_LIMIT), /between 1 and 500/);
assert.throws(() => validatedReadLimit(201, RUN_HISTORY_PAGE_LIMIT), /between 1 and 200/);
assert.equal(validatedReadLimit(undefined, CHANNEL_PLAN_LIMIT), 200);
assert.equal(validatedReadLimit(undefined, OWNER_PLAN_LIMIT), 500);

const runsSource = readFileSync(
  new URL("../../../convex/runs.ts", import.meta.url),
  "utf8",
);
const listRunsByChannel = runsSource.slice(
  runsSource.indexOf("export const listRunsByChannel"),
  runsSource.indexOf("export const listRunsByChannelSincePage"),
);
assert.match(listRunsByChannel, /validatedReadLimit\(args\.limit, RUNS_BY_CHANNEL_LIMIT\)/);
assert.match(listRunsByChannel, /\.take\(limit\)/);
assert.doesNotMatch(listRunsByChannel, /\.collect\(\)/);

const listRecent = runsSource.slice(
  runsSource.indexOf("export const listRecent"),
);
assert.match(listRecent, /validatedReadLimit\(args\.limit, RECENT_RUNS_LIMIT\)/);
assert.match(listRecent, /\.take\(limit\)/);

const planSource = readFileSync(
  new URL("../../../convex/contentPlan.ts", import.meta.url),
  "utf8",
);
for (const [start, end] of [
  ["export const listPlan =", "export const listReadyPlanPreview"],
  ["export const listPlanByOwner", "export const listPlanHistoryPage"],
] as const) {
  const query = planSource.slice(planSource.indexOf(start), planSource.indexOf(end));
  assert.match(query, /validatedReadLimit/);
  assert.match(query, /\.take\(/);
  assert.doesNotMatch(query, /\.collect\(\)/);
}
assert.match(planSource, /export const listPlanHistoryPage/);
assert.match(planSource, /\.paginate\(args\.paginationOpts\)/);

const doctorSource = readFileSync(
  new URL("../../trigger/pipelineDoctor.ts", import.meta.url),
  "utf8",
);
assert.match(doctorSource, /listRunHistorySince\(convex, ch\._id, Date\.now\(\) - 60 \* DAY\)/);
assert.doesNotMatch(doctorSource, /run stuck 'running' >3h/);
assert.doesNotMatch(doctorSource, /reaper: flipped stuck run/);

console.log("BOUNDED CONVEX READ TESTS PASS");
