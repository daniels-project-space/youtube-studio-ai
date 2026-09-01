import assert from "node:assert/strict";
import { diagnoseRunFailure, INITIAL_VISIBLE_RUNS, projectRunHistory } from "./runsModel";

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

assert.deepEqual(diagnoseRunFailure('budget ceiling exceeded: spent $3.23 > budget $2.00 after block "whiteboard_scribe"'), {
  faultDomain: "Spend boundary",
  cause: "Recorded stage spend reached the channel ceiling before completion.",
  nextAction: "Inspect per-stage spend; repair repeated upstream calls or explicitly revise the channel budget.",
});
assert.equal(diagnoseRunFailure("qa.visual FAILED: validation-spec deterministic spatial title cut").faultDomain, "Visual QA");
assert.equal(diagnoseRunFailure("banana: both attempts failed at thumbnail gate punch-2").faultDomain, "Packaging QA");
assert.equal(diagnoseRunFailure("hookcraft failed: opening is 31 words; banned filler opener").faultDomain, "Opening QA");
assert.equal(diagnoseRunFailure("topiccraft: off-niche; demand/freshness/fit failed").faultDomain, "Editorial fit");
assert.equal(diagnoseRunFailure("Unexpected non-whitespace character after JSON at position 5105").faultDomain, "Provider payload");
assert.equal(diagnoseRunFailure("Novita Comfy worker timed out with 503").faultDomain, "Render runtime");
assert.equal(diagnoseRunFailure("unknown terminal error").faultDomain, "Pipeline stop");

console.log("run history projection tests passed");
