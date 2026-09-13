import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const onDemand = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/on-demand/route.ts"), "utf8");
const weekly = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/weekly/route.ts"), "utf8");

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
assert.doesNotMatch(weekly, /bootstrapSecrets|MINIMAX_H3_SALAD_WORKER_TOKEN|fetch\s*\(/);

console.log("MiniMax H3 HTTP dispatch route contracts passed");
