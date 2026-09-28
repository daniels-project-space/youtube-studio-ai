import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const onDemand = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/on-demand/route.ts"), "utf8");
const weekly = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/weekly/route.ts"), "utf8");
const retry = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/retry/route.ts"), "utf8");

assert.match(onDemand, /assertMiniMaxH3OnDemandArgs/);
assert.match(onDemand, /tasks\.trigger\("minimax-h3-on-demand"/);
assert.match(onDemand, /all H3 paths must be inside the signed-in owner namespace/);
assert.doesNotMatch(onDemand, /bootstrapSecrets|MINIMAX_H3_NOVITA_WORKER_TOKEN|fetch\s*\(/);

for (const [name, route] of [["weekly", weekly], ["retry", retry]] as const) {
  assert.match(route, /requireStudioActor/, `${name} remains owner-only`);
  assert.match(route, /status:\s*410/, `${name} reports the Engine handoff`);
  assert.match(route, /Render Engine/, `${name} points to the Engine handoff`);
  assert.doesNotMatch(route, /tasks\.trigger|runs\.retrieve|bootstrapSecrets|fetch\s*\(/, `${name} cannot dispatch or contact a provider`);
}

console.log("MiniMax H3 HTTP dispatch route contracts passed");
