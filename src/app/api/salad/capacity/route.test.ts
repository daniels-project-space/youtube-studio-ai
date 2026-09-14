import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/salad/capacity/route.ts"), "utf8");

assert.match(route, /requireStudioActor/);
assert.match(route, /readSaladCapacitySnapshot/);
assert.match(route, /jobCount/);
assert.match(route, /requiredWorkers/);
assert.match(route, /paidRequestStarted: false/);
assert.match(route, /Cache-Control.*private, no-store/);
assert.doesNotMatch(route, /createContainerGroup|startContainerGroup|stopContainerGroup|updateReplicas/);

console.log("Salad fleet capacity route contracts passed");
