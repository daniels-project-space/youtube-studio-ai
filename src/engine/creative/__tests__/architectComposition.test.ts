import assert from "node:assert/strict";

import { channelPipelineValidationSeedKeys } from "@/engine/channelPipelineSeedKeys";
import { designPipeline } from "@/engine/designer";
import { familyDurationContract, FAMILIES, type FamilyKey } from "@/engine/families";
import { validatePipeline } from "@/engine/validate";
import { applyArchitectPlan, type ArchitectPlan } from "../architect";

const emptyPlan: ArchitectPlan = {
  summary: "Keep the valid composition",
  decisions: [],
  antiRepetition: [],
  missingCapabilities: [],
  groundingActions: [],
};

function blockOrder(entries: ReturnType<typeof designPipeline>["pipeline"]) {
  return entries.map(({ block }) => block);
}

for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  const design = designPipeline({
    family,
    nicheKey: "history",
    lengthMinutes: familyDurationContract(family).defaultSeconds / 60,
    publishMode: "draft",
  });
  assert.ok(design.available, `${family} should provide its authored module floor`);
  const result = applyArchitectPlan(design.pipeline, emptyPlan, { family });
  assert.deepEqual(blockOrder(result.pipeline), blockOrder(design.pipeline), `${family}: no-op must preserve module order`);
  assert.deepEqual(result.report.applied, []);
  assert.deepEqual(result.report.rejected, [], `${family}: seed-backed final validation must not discard a valid floor`);
  assert.doesNotThrow(() => validatePipeline(
    result.pipeline,
    channelPipelineValidationSeedKeys(design.contentLane, undefined, result.pipeline),
  ));
}

const narrated = designPipeline({ family: "narrated_stock", nicheKey: "history", publishMode: "draft" });
const shortPlan: ArchitectPlan = {
  ...emptyPlan,
  summary: "Add a private discovery cut",
  decisions: [{
    action: "add",
    block: "shorts_spinoff",
    params: { shortDurSec: 45 },
    why: "Create a concise discovery version for this channel.",
  }],
};
const composed = applyArchitectPlan(narrated.pipeline, shortPlan, { family: "narrated_stock" });
assert.equal(composed.report.applied.length, 1, "a compatible real module should compose into the authored floor");
assert.deepEqual(composed.report.rejected, []);
const blocks = composed.pipeline.map((entry) => entry.block);
assert.ok(blocks.indexOf("upload_draft") < blocks.indexOf("shorts_spinoff"),
  "the composed Shorts module must follow its upload/watch URL producer");
const lane = narrated.contentLane;
assert.ok(lane);
assert.doesNotThrow(() => validatePipeline(
  composed.pipeline,
  channelPipelineValidationSeedKeys(lane, undefined, composed.pipeline),
));

const duplicatePlan: ArchitectPlan = {
  ...emptyPlan,
  decisions: [{ action: "add", block: "visual_inserts", why: "Already selected by the base graph." }],
};
const rejectedDuplicate = applyArchitectPlan(narrated.pipeline, duplicatePlan, { family: "narrated_stock" });
assert.deepEqual(blockOrder(rejectedDuplicate.pipeline), blockOrder(narrated.pipeline));
assert.deepEqual(rejectedDuplicate.report.rejected.map(({ reason }) => reason), ["already present"],
  "rejecting one bad architect operation must not convert seed-backed final validation into a floor fallback");

console.log("ARCHITECT COMPOSITION PASS: seeded floors, compatible module addition, and isolated rejection");
