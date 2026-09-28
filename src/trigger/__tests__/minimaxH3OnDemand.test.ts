import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/trigger/minimaxH3OnDemand.ts"), "utf8");

assert.match(source, /id: "minimax-h3-on-demand"/);
assert.match(source, /qualified Render Engine workflow/);
assert.doesNotMatch(source, /bootstrapSecrets|renderMiniMaxH3|novita|R2_ACCESS_KEY_ID/);
console.log("on-demand MiniMax H3 tombstone contract passed");
