import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/salad/capacity/route.ts"), "utf8");

assert.match(route, /requireStudioActor/);
assert.match(route, /readSaladCapacitySnapshot/);
assert.match(route, /saladPriorityPolicyFromEnv/);
assert.match(route, /StudioConvexHttpClient/);
assert.match(route, /api\.saladFleetReservations\.listActive/,
  "fleet visibility must observe durable logical leases, not only provider groups");
assert.match(route, /readLogicalOccupiedGpuSlots/);
assert.doesNotMatch(route, /process\.env\.MINIMAX_H3_SALAD_(?:HIGH_PRIORITY_FALLBACK|MEDIUM_PRIORITY)/,
  "fleet visibility must consume the shared Salad tier policy");
assert.match(route, /jobCount/);
assert.match(route, /requiredWorkers/);
assert.match(route, /paidRequestStarted: false/);
assert.match(route, /Cache-Control.*private, no-store/);
assert.doesNotMatch(route, /createContainerGroup|startContainerGroup|stopContainerGroup|updateReplicas/);

console.log("Salad fleet capacity route contracts passed");
