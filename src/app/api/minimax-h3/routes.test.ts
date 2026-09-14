import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const onDemand = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/on-demand/route.ts"), "utf8");
const weekly = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/weekly/route.ts"), "utf8");
const retry = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/retry/route.ts"), "utf8");

assert.match(onDemand, /assertMiniMaxH3OnDemandArgs/);
assert.match(onDemand, /provider:\s*"novita"/);
assert.match(onDemand, /execution:\s*"on-demand"/);
assert.match(onDemand, /runtimeId: MINIMAX_H3_RUNTIME_ID/);
assert.match(onDemand, /profile: MINIMAX_H3_PROFILE/);
assert.match(onDemand, /tasks\.trigger\("minimax-h3-on-demand"/);
assert.match(onDemand, /all H3 paths must be inside the signed-in owner namespace/);
assert.doesNotMatch(onDemand, /bootstrapSecrets|MINIMAX_H3_NOVITA_WORKER_TOKEN|fetch\s*\(/);

assert.match(weekly, /assertMiniMaxH3WeeklyBatchArgs/);
assert.match(weekly, /provider:\s*"salad"/);
assert.match(weekly, /execution:\s*"weekly-batch"/);
assert.match(weekly, /runtimeId: MINIMAX_H3_RUNTIME_ID/);
assert.match(weekly, /profile: MINIMAX_H3_PROFILE/);
assert.match(weekly, /tasks\.trigger\("minimax-h3-weekly-batch"/);
assert.match(weekly, /all H3 paths must be inside the signed-in owner namespace/);
assert.match(weekly, /preparedFootage\.ownerId !== actor\.ownerId/);
assert.doesNotMatch(weekly, /bootstrapSecrets|MINIMAX_H3_SALAD_WORKER_TOKEN|fetch\s*\(/);

assert.match(retry, /requireStudioActor/);
assert.match(retry, /runs\.retrieve\(runId\)/);
assert.match(retry, /run\.taskIdentifier !== "minimax-h3-weekly-batch"/);
assert.match(retry, /isMiniMaxH3CapacityHoldError\(run\.error\)/);
assert.match(retry, /getObjectBytes\(receiptKey\)/);
assert.match(retry, /miniMaxH3WeeklyRequestPacketKey\(receiptKey\)/);
assert.match(retry, /assertMiniMaxH3WeeklyBatchArgs/);
assert.match(retry, /minimax-h3-weekly-capacity-retry/);
assert.match(retry, /tasks\.trigger\("minimax-h3-weekly-batch"/);
assert.match(retry, /retryOfRunId/);
assert.doesNotMatch(retry, /MINIMAX_H3_SALAD_WORKER_TOKEN|fetch\s*\(/);
assert.doesNotMatch(retry, /runs\.replay/, "retry must dispatch a deterministic identity after revalidation");

console.log("MiniMax H3 HTTP dispatch route contracts passed");
