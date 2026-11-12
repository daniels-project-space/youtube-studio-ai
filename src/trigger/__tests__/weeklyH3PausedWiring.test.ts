import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Both the fresh and retained-image paths must stop before the legacy H3
// submission helper, including when a frozen pipeline names generated footage.
const source = readFileSync(join(process.cwd(), "src/trigger/planWeekPreparedImages.ts"), "utf8");
const task = source.slice(source.indexOf("export const planWeekPreparedImagesTask = task({"));
assert.ok(task.startsWith("export const planWeekPreparedImagesTask"));
assert.doesNotMatch(task, /dispatchPreparedFootage\s*\(/);
const consumer = readFileSync(join(process.cwd(), "src/trigger/blocks/novitaRenderBlocks.ts"), "utf8");
const video = consumer.slice(consumer.indexOf("export const novitaRenderVideo: Block"));
assert.ok(video.indexOf('selected.generation.contractVersion === "hrs-ernie/v1"') >= 0);
assert.ok(video.indexOf('selected.generation.contractVersion === "hrs-ernie/v1"') < video.indexOf('minimaxH3Readiness('));
console.log("Weekly prepared images leave H3 paused: ok");
