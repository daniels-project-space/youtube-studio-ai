import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const pipeline = read("src/components/LivePipeline.tsx");
const runDetail = read("src/app/(app)/runs/[runId]/page.tsx");

assert.match(pipeline, /planSource\?: "frozen" \| "legacy"/);
assert.match(pipeline, /Waiting for the next stage/);
assert.match(pipeline, /Using the saved legacy plan/);
assert.match(pipeline, /blockLabel\(active\.block\)/,
  "the compact header must still name the actual persisted active block");
assert.match(pipeline, /summaryElapsed/,
  "the compact header must retain elapsed time for the actual active stage");
assert.match(pipeline, /aria-live="polite"/,
  "active stage receipt changes must remain announced without a decorative duplicate panel");
assert.doesNotMatch(pipeline, /receiptPercent|role="progressbar"|activeStage/,
  "stage and phase receipt counts are the one truthful progress surface; do not reintroduce redundant meters/panels");
assert.match(pipeline, /const inspectionPhase = selectedPhase;/,
  "phase receipts must remain explicitly inspect-on-demand rather than auto-expanding queued siblings after one failure");
assert.doesNotMatch(pipeline, /inspectionDismissed|blockedNode/,
  "the compact live workbench must not retain a hidden auto-open failure phase");

assert.match(runDetail, /api\.runs\.getRunPresentation/);
assert.match(runDetail, /run\.pipeline\?\.entries\.length/);
assert.match(runDetail, /const planSource = run\.pipeline \? "frozen" : "legacy"/);
assert.match(runDetail, /<LivePipeline nodes=\{nodes\} planSource=\{planSource\} \/>/);
assert.doesNotMatch(runDetail, /api\.runs\.getRun,/);

console.log("live pipeline frozen-plan UI contract passed");
