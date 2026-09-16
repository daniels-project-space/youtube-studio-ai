import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The live Salad preflight cannot be executed in unit tests without vault
 * credentials. Keep its provider-facing policy mechanically tied to the
 * production admission contract instead of allowing a future edit to regress
 * to a locality-only capacity read.
 */
const source = readFileSync(resolve(process.cwd(), "scripts/salad-runtime-preflight.ts"), "utf8");

assert.match(source, /SALAD_GLOBAL_CAPACITY_FALLBACK/);
assert.match(source, /preferredCanAdmit/);
assert.match(source, /getGpuAvailability\(resources\)/,
  "preflight must retain a bounded unfiltered global capacity comparison");
assert.match(source, /global_availability_read_failed/,
  "an optional global comparison failure must remain visible in the report");
assert.match(source, /selectSaladCapacityPriority\([\s\S]*highEligible:/,
  "preflight must use the shared medium-first/high-fallback selector");
assert.match(source, /let selectedPriority: SaladBulkPriority \| null = null;/,
  "preflight must not report a discovered GPU tier as selected before capacity admission");
assert.match(source, /const admittedPriority = selectSaladCapacityPriority\([\s\S]*requiredWorkers: 1/,
  "preflight must derive the selected tier from the complete wave capacity check");

console.log("Salad runtime preflight fallback contract passed");
