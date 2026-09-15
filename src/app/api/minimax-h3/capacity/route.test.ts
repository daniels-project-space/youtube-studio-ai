import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/capacity/route.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/novita-render/H3RenderConsole.tsx"), "utf8");

assert.match(route, /requireStudioActor/);
assert.match(route, /assertMiniMaxH3SaladCapacity/);
assert.match(route, /saladPriorityPolicyFromEnv/);
assert.match(route, /api\.saladFleetReservations\.listActive/,
  "the owner capacity probe must observe the same logical fleet lease as weekly dispatch");
assert.match(route, /Math\.max\(await salad\.getOccupiedGpuSlots\(\), logicalReservedGpuSlots\)/,
  "provider occupancy and logical leases must share one fail-closed occupied-slot fence");
assert.doesNotMatch(route, /process\.env\.MINIMAX_H3_SALAD_(?:HIGH_PRIORITY_FALLBACK|MEDIUM_PRIORITY)/,
  "H3 capacity admission must consume the shared Salad tier policy");
assert.match(route, /paidRequestStarted: false/);
assert.doesNotMatch(route, /tasks\.trigger/);
assert.match(page, /api\/minimax-h3\/capacity\?jobCount=/);
assert.match(page, /Check Salad capacity/);
assert.match(page, /Held before spend/);

console.log("H3 owner capacity probe contracts passed");
