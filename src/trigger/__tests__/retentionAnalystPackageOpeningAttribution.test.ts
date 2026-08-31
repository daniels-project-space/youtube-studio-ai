import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src", "trigger", "retentionAnalyst.ts"), "utf8");

assert.match(
  source,
  /packageOpeningRetentionAttribution\(\{[\s\S]*?package_to_opening_plan[\s\S]*?qa_visual/,
  "retention analysis must attribute the opening from the sealed plan and final-QA receipt",
);
assert.match(
  source,
  /Opening evidence: \$\{openingAttribution\}/,
  "the analysis prompt must expose evidence state instead of a guessed opening device",
);
assert.match(
  source,
  /deriveAudienceOpeningRetention\(\{ durationSec, curve \}\)/,
  "the learning loop must calculate a distinct measured opening-retention value from the actual curve",
);
assert.match(
  source,
  /opening measure: \$\{openingRetentionSummary\}/,
  "the showrunner prompt must distinguish the measured opening value from the legacy 5%-through-video hold",
);
assert.doesNotMatch(
  source,
  /deviceIdx|devices\[deviceIdx % devices\.length\]/,
  "run IDs must never choose the opening device used for a retention conclusion",
);
assert.match(
  source,
  /packageOpeningAttribution,[\s\S]*?openingRetention,[\s\S]*?retentionLearnings/,
  "future playbook proposals must retain both package evidence and its measured opening-retention context",
);

console.log("retention analyst package-opening attribution test passed");
