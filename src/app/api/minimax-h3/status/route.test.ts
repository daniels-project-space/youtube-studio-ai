import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/status/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /ownerReceiptKey/);
assert.match(source, /startsWith\(`owner\/\$\{ownerId\}\/`\)/);
assert.match(source, /runs\.retrieve\(runId\)/);
assert.match(source, /getObjectBytes\(receiptKey\)/);
assert.match(source, /reconciliation_required/);
assert.match(source, /Cache-Control.*private, no-store/);
assert.doesNotMatch(source, /MINIMAX_H3_(?:SALAD|NOVITA)_WORKER_TOKEN/);
assert.doesNotMatch(source, /fetch\s*\(/);

console.log("MiniMax H3 owner-scoped status route contracts passed");
