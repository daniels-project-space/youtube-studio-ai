import assert from "node:assert/strict";

import {
  CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS,
} from "@/engine/channelProgramRoute";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { assertPipelineMatchesContentLane, contentLaneForFamily } from "@/engine/contentLane";
import { designPipeline } from "@/engine/designer";
import { assertFamilyAutonomousPlanningPipeline } from "@/engine/families";

const design = designPipeline({ family: "cinematic" });
const route = CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS.find(
  (definition) => definition.key === "cinematic/foundation/v1",
);
assert.ok(route, "cinematic must have one explicit automatic route definition before a benchmark can promote it");

assert.doesNotThrow(
  () => assertFamilyAutonomousPlanningPipeline("cinematic", design.pipeline),
  "the route-owned cinematic planner must cover the full sealed visual-control pipeline",
);
const heroDesign = designPipeline({ family: "cinematic", generationProfile: "hero" });
assert.doesNotThrow(
  () => assertFamilyAutonomousPlanningPipeline("cinematic", heroDesign.pipeline),
  "the hero profile is a stronger production-quality cinematic tier",
);
const draftPreview = designPipeline({ family: "cinematic", generationProfile: "draft" });
assert.equal(draftPreview.productionReady, false, "draft cinematic output is design-preview-only");
assert.throws(
  () => assertFamilyAutonomousPlanningPipeline("cinematic", draftPreview.pipeline),
  /novita_render_images\.generationProfile="production"/,
  "a preview-tier cinematic graph must be rejected by every runnable-pipeline boundary",
);
assert.doesNotThrow(
  () => assertPipelineMatchesContentLane(contentLaneForFamily("cinematic"), design.pipeline),
  "the cinematic route must retain the lane's image-to-video, QA, and release ordering",
);

for (const block of route.requiredBlocks) {
  assert.ok(
    design.pipeline.some((entry) => entry.block === block),
    `the cinematic designer must materialize the route-required ${block} block`,
  );
}
for (const [before, after] of route.requiredBlockOrder) {
  const beforeIndex = design.pipeline.findIndex((entry) => entry.block === before);
  const afterIndex = design.pipeline.findIndex((entry) => entry.block === after);
  assert.ok(beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex, `${before} must precede ${after}`);
}

assert.throws(
  () => assertFamilyAutonomousPlanningPipeline(
    "cinematic",
    design.pipeline.filter((entry) => entry.block !== "visual_matter"),
  ),
  /missing required module visual_matter/,
  "a cinematic run cannot omit its sealed visual-control planning layer",
);

const admission = certifiedFamilyAdmission("cinematic");
assert.equal(admission.automatic, false);
assert.deepEqual(admission.routeKeys, ["cinematic/foundation/v1"]);
assert.equal(admission.compositionKey, "cinematic_visual_control_story");
assert.equal(admission.checks.runtime, false, "the real immutable LTX benchmark remains the final promotion gate");
assert.ok(admission.blockers.every((blocker) => blocker.includes("revision_not_benchmarked")));

console.log("cinematic foundation route, planner, composition, and runtime gate tests passed");
