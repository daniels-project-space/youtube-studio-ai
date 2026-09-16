import assert from "node:assert/strict";
import { h3ProgressPercent } from "../h3Progress";

assert.equal(h3ProgressPercent({ state: "pending", triggerStatus: "QUEUED", receipt: null }), 16);
assert.equal(h3ProgressPercent({ state: "pending", triggerStatus: "EXECUTING", receipt: null }), 58);
assert.equal(h3ProgressPercent({ state: "pending", triggerStatus: "EXECUTING", receipt: { completedCount: 0, requestCount: 3 } }), 16);
assert.equal(h3ProgressPercent({ state: "pending", triggerStatus: "EXECUTING", receipt: { completedCount: 1, requestCount: 3 } }), 42);
assert.equal(h3ProgressPercent({ state: "pending", triggerStatus: "EXECUTING", receipt: { completedCount: 3, requestCount: 3 } }), 94);
assert.equal(h3ProgressPercent({ state: "held", triggerStatus: "HELD", receipt: null }), 8);
assert.equal(h3ProgressPercent({ state: "reconciliation_required", triggerStatus: "FAILED", receipt: null }), 92);
assert.equal(h3ProgressPercent({ state: "complete", triggerStatus: "COMPLETED", receipt: { completedCount: 3, requestCount: 3 } }), 100);

console.log("H3 progress projection contracts passed");
