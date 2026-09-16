import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pipeline = readFileSync(resolve(process.cwd(), "src/trigger/runPipeline.ts"), "utf8");
const health = readFileSync(resolve(process.cwd(), "convex/automaticProviderHealth.ts"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "convex/schema.ts"), "utf8");
assert.match(pipeline, /automaticProviderHealthApi\.listForOwner/);
assert.match(pipeline, /automaticProviderHealthApi\.recordOutcome/);
assert.match(pipeline, /circuits: providerCircuits/);
assert.match(health, /nextProviderCircuitState/);
assert.match(schema, /automaticProviderHealth: defineTable/);
console.log("automatic provider health durable wiring passed");
