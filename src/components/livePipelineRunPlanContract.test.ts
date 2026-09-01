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

assert.match(runDetail, /api\.runs\.getRunPresentation/);
assert.match(runDetail, /run\.pipeline\?\.entries\.length/);
assert.match(runDetail, /const planSource = run\.pipeline \? "frozen" : "legacy"/);
assert.match(runDetail, /<LivePipeline nodes=\{nodes\} planSource=\{planSource\} \/>/);
assert.doesNotMatch(runDetail, /api\.runs\.getRun,/);

console.log("live pipeline frozen-plan UI contract passed");
