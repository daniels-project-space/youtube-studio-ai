import assert from "node:assert/strict";
import { allLinkedH3RunsSettled, projectH3ReceiptState } from "../h3StatusProjection";

async function* linked(...runs: Array<{ id: string; status: string }>) {
  yield* runs;
}
async function main() {
assert.equal(await allLinkedH3RunsSettled("original", linked(
  { id: "original", status: "FAILED" }, { id: "fallback-child", status: "EXECUTING" },
)), false);
assert.equal(await allLinkedH3RunsSettled("original", linked(
  { id: "original", status: "FAILED" }, { id: "fallback-child", status: "COMPLETED" },
)), true);
assert.equal(await allLinkedH3RunsSettled("original", linked({ id: "fallback-child", status: "COMPLETED" })), false,
  "a filtered or stale run listing cannot settle an order whose queried run is absent");

const weekly = { aggregateKind: "weekly" as const, packetState: "frozen" as const, capacityHold: false, linkedRunsSettled: true };
assert.deepEqual(projectH3ReceiptState({ ...weekly, triggerStatus: "COMPLETED", rejectedCount: 0 }),
  { state: "complete", lineageConflict: false });
assert.deepEqual(projectH3ReceiptState({ ...weekly, triggerStatus: "EXECUTING", rejectedCount: 1 }),
  { state: "pending", lineageConflict: true }, "a live worker and conflicting aggregate must keep polling");
assert.deepEqual(projectH3ReceiptState({ ...weekly, triggerStatus: "COMPLETED", rejectedCount: 1 }),
  { state: "reconciliation_required", lineageConflict: true }, "an aggregate cannot hide a rejected paid shot");
assert.deepEqual(projectH3ReceiptState({ ...weekly, aggregateKind: null, triggerStatus: "EXECUTING", rejectedCount: 1 }),
  { state: "pending", lineageConflict: false }, "a first rejected shot must not invite a new order while workers run");
assert.deepEqual(projectH3ReceiptState({ ...weekly, aggregateKind: null, triggerStatus: "FAILED", rejectedCount: 1 }),
  { state: "repair_required", lineageConflict: false });
assert.deepEqual(projectH3ReceiptState({ ...weekly, aggregateKind: null, triggerStatus: "FAILED", rejectedCount: 1, linkedRunsSettled: false }),
  { state: "pending", lineageConflict: false }, "a terminal queried run cannot settle an active tagged child");
assert.deepEqual(projectH3ReceiptState({ ...weekly, triggerStatus: "FAILED", rejectedCount: 1, linkedRunsSettled: false }),
  { state: "pending", lineageConflict: true }, "conflicting aggregate still waits for active linked runs");
assert.deepEqual(projectH3ReceiptState({ ...weekly, packetState: "missing", triggerStatus: "COMPLETED", rejectedCount: 0 }),
  { state: "reconciliation_required", lineageConflict: false }, "aggregate without frozen lineage is not complete");
assert.deepEqual(projectH3ReceiptState({ ...weekly, aggregateKind: null, triggerStatus: "FAILED", rejectedCount: 0, capacityHold: true }),
  { state: "held", lineageConflict: false, paidRequestStarted: false });

console.log("H3 receipt lineage status projection passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
