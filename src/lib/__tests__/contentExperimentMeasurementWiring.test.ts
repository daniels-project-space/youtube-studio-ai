import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const publishing = readFileSync(resolve(root, "convex/publishIntents.ts"), "utf8");
const governance = readFileSync(resolve(root, "convex/learningGovernance.ts"), "utf8");
const learning = readFileSync(resolve(root, "src/trigger/learn.ts"), "utf8");

assert.match(publishing, /measurementKind:\s*"single_variant_observation"/);
assert.match(governance, /export const recordCreativeAssignmentObservation = mutation/);
assert.match(governance, /admitOrdinaryCreativeObservation\(experiment\.measurementKind\)/);
assert.doesNotMatch(governance, /export const recordExperimentOutcome = mutation/);
assert.match(learning, /recordCreativeAssignmentObservations/);
assert.match(learning, /api\.learningGovernance\.recordCreativeAssignmentObservation/);
assert.doesNotMatch(learning, /recordExperimentOutcomes/);

console.log("contentExperimentMeasurement wiring: ordinary analytics cannot be named or wired as A/B outcomes");
