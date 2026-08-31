import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src", "trigger", "runPipeline.ts"), "utf8");
const admission = source.indexOf("if (certifiedFamilyAdmission(laneFamily as FamilyKey).automatic)");
const foundation = source.indexOf("assertMinimumVideoFoundationForAutomaticFamily({", admission);
const autonomousPlanner = source.indexOf("assertFamilyAutonomousPlanningPipeline(laneFamily as FamilyKey, entries)");
const providerPreflight = source.indexOf("preflight(resolved, { budgetUsd: invocationCandidate.budgetUsd });");

assert.ok(admission >= 0 && foundation > admission, "run-pipeline must identify the automatic family before checking its foundation");
assert.ok(
  foundation < autonomousPlanner && autonomousPlanner < providerPreflight,
  "the durable automatic foundation must be rechecked before planning admission and provider preflight",
);
assert.match(
  source.slice(admission, autonomousPlanner),
  /family: laneFamily as FamilyKey,[\s\S]*?contentLane,[\s\S]*?pipeline: entries/,
  "the runtime gate must validate the exact frozen family, lane, and pipeline—not a reconstructed approximation",
);

console.log("run-pipeline minimum foundation gate test passed");
