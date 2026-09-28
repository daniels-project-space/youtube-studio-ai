import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/status/route.ts"), "utf8");
const projection = readFileSync(resolve(process.cwd(), "src/lib/minimaxH3Status.ts"), "utf8");
const statusProjection = readFileSync(resolve(process.cwd(), "src/lib/h3StatusProjection.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /ownerReceiptKey/);
assert.match(source, /startsWith\(`owner\/\$\{ownerId\}\/`\)/);
assert.match(source, /runs\.retrieve\(runId\)/);
assert.match(source, /getObjectBytes\(receiptKey\)/);
assert.match(source, /miniMaxH3WeeklyRequestPacketKey/);
assert.match(source, /requestPacketState/);
assert.match(projection, /capacityMode/);
assert.match(projection, /provider capacity provenance is malformed/);
assert.match(source, /minimax-h3-weekly-request\/v1/);
assert.match(statusProjection, /reconciliation_required/);
assert.match(source, /isMiniMaxH3CapacityHoldError/);
assert.match(source, /projectH3ReceiptState\(/);
assert.match(source, /reconcileWeeklyOrderRejections\(/);
assert(source.indexOf("reconcileWeeklyOrderRejections(") < source.indexOf("projectH3ReceiptState({"),
  "weekly claims must be reconciled before the status is projected, including when an aggregate exists");
assert.match(source, /aggregate_and_rejected_shot/);
assert.match(source, /paidRequestStarted/);
assert.doesNotMatch(source, /run\.error\s*\}\s*,/, "status must not expose raw Trigger error text");
assert.match(source, /Cache-Control.*private, no-store/);
assert.doesNotMatch(source, /MINIMAX_H3_(?:SALAD|NOVITA)_WORKER_TOKEN/);
assert.doesNotMatch(source, /fetch\s*\(/);

console.log("MiniMax H3 owner-scoped status route contracts passed");
