import assert from "node:assert/strict";
import { projectH3ReceiptState } from "../h3StatusProjection";

const weekly = { aggregateKind: "weekly" as const, packetState: "frozen" as const, capacityHold: false };
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
assert.deepEqual(projectH3ReceiptState({ ...weekly, packetState: "missing", triggerStatus: "COMPLETED", rejectedCount: 0 }),
  { state: "reconciliation_required", lineageConflict: false }, "aggregate without frozen lineage is not complete");
assert.deepEqual(projectH3ReceiptState({ ...weekly, aggregateKind: null, triggerStatus: "FAILED", rejectedCount: 0, capacityHold: true }),
  { state: "held", lineageConflict: false, paidRequestStarted: false });

console.log("H3 receipt lineage status projection passed");
