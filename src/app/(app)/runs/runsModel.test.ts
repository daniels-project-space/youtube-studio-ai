import assert from "node:assert/strict";
import { INITIAL_VISIBLE_RUNS, projectRunHistory } from "./runsModel";

const rows = Array.from({ length: 30 }, (_, index) => ({
  channelSlug: index < 20 ? "alpha" : "beta",
  status: index % 5 === 0 ? "failed" : index % 3 === 0 ? "ok" : "queued",
  id: index,
}));

const initial = projectRunHistory(rows, null, "all", INITIAL_VISIBLE_RUNS);
assert.equal(initial.matching.length, 30);
assert.equal(initial.visible.length, 12, "the initial production view stays bounded");
assert.equal(initial.remaining, 18);
assert.equal(initial.statusCounts.all, 30);
assert.equal(initial.statusCounts.failed, 6);

const channelFailures = projectRunHistory(rows, "alpha", "failed", 12);
assert.deepEqual(channelFailures.visible.map((run) => run.id), [0, 5, 10, 15]);
assert.equal(channelFailures.statusCounts.all, 20, "counts respect channel scope");
assert.equal(channelFailures.remaining, 0);

const expanded = projectRunHistory(rows, null, "queued", 24);
assert.equal(expanded.visible.length, expanded.matching.length);
assert.equal(expanded.remaining, 0);

assert.equal(projectRunHistory(rows, null, "all", -4).visible.length, 0);

console.log("run history projection tests passed");
