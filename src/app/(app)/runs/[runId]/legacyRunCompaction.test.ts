import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/(app)/runs/[runId]/page.tsx"), "utf8");

assert.match(
  source,
  /const compactLegacyRecord = planSource === "legacy" && stages !== undefined/,
  "a legacy row without a frozen invocation must use the compact historical view",
);
assert.match(source, /compactLegacyRecord \? "Legacy record" : "Legacy inferred plan"/);
assert.match(source, /\{!compactLegacyRecord \? \(\n        <nav className=\{styles\.runMap\}/);
assert.match(source, /\{compactLegacyRecord \? \(\n        <LegacyRecordShelf/);
assert.match(source, /\{!compactLegacyRecord \? \(\n        <>\n          <section id="pipeline-route"/);
assert.match(source, /No pipeline receipt is available/);
assert.match(source, /no frozen pipeline was saved/);
assert.doesNotMatch(source, /compactLegacyRecord[\s\S]{0,240}LivePipeline/,
  "the compact historical branch must not render a pipeline inferred from today's channel");

console.log("Legacy run compaction contract passed");
