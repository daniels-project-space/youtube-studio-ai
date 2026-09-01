import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRoutePipelineCompatibility,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { designPipeline } from "@/engine/designer";
import { familyProductionReadiness } from "@/engine/families";

function indexOf(pipeline: readonly { block: string }[], block: string): number {
  const index = pipeline.findIndex((entry) => entry.block === block);
  assert.ok(index >= 0, `missing required ${block} block`);
  return index;
}

const programBrief = createChannelProgramBrief({
  family: "music_loop",
  nicheKey: "lofi",
  locale: "en",
  concept: "Original late-night instrumental focus sessions with calm seamless visual loops.",
});
const programRoute = resolveChannelProgramRoute(programBrief);
assert.ok(programRoute, "Music Loop must resolve a route-owned program");
assert.equal(programRoute?.routeKey, "music-loop/foundation/v1");

const design = designPipeline({
  family: "music_loop",
  nicheKey: programBrief.nicheKey,
  programBrief,
  programRoute,
  lengthMinutes: 60,
});

assertChannelProgramRoutePipelineCompatibility({
  route: programRoute!,
  programBrief,
  pipeline: design.pipeline,
});

const program = indexOf(design.pipeline, "music_program_plan");
const scenes = indexOf(design.pipeline, "scene_planner");
const loop = indexOf(design.pipeline, "loop_clips");
const music = indexOf(design.pipeline, "music");
const assemble = indexOf(design.pipeline, "assemble");
const qa = indexOf(design.pipeline, "qa_visual");
const upload = indexOf(design.pipeline, "upload_draft");
assert.ok(program < scenes && program < music, "the sealed original-music plan must precede both paid branches");
assert.ok(
  scenes < loop && music < loop && loop < assemble && music < assemble && assemble < qa && qa < upload,
  "the sealed mastered track must exist before the loop stage, including any future open-weight A2V candidate",
);
assert.equal(
  design.pipeline.filter((entry) => entry.block === "music_program_plan").length,
  1,
  "one episode has exactly one route-owned music program",
);

const admission = certifiedFamilyAdmission("music_loop");
assert.equal(admission.automatic, false, "planning readiness must not bypass the independent LTX benchmark gate");
assert.deepEqual(admission.checks, {
  productionReadiness: false,
  route: true,
  composition: true,
  inception: true,
  editorialPolicy: true,
  referenceQuality: true,
  runtime: false,
});
assert.deepEqual(
  familyProductionReadiness("music_loop").blockers,
  ["Music + looping visual: loop_clips:ltx_2_5_revision_not_benchmarked_on_rtx_4090"],
  "once the program path is registered, only the real pinned LTX benchmark may unlock Music Loop",
);

console.log("music-loop automatic admission path tests passed");
