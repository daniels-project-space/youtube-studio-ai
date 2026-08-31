import assert from "node:assert/strict";

import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRoutePipelineCompatibility,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import { designPipeline } from "@/engine/designer";
import { familyProductionReadiness } from "@/engine/families";

function indexOf(pipeline: readonly { block: string }[], block: string): number {
  const index = pipeline.findIndex((entry) => entry.block === block);
  assert.ok(index >= 0, `missing required ${block} block`);
  return index;
}

for (const [family, renderer, viewerJob, grammar] of [
  ["whiteboard", "whiteboard_scribe", "understand_a_drawn_whiteboard_explainer", "drawn_whiteboard_explainer_episode"],
  ["comic", "motion_comic", "experience_an_original_motion_comic", "motion_comic_episode"],
] as const) {
  const programBrief = createChannelProgramBrief({
    family,
    nicheKey: "educational",
    locale: "en",
    concept: "An original, focused channel program with a clear repeatable viewer payoff.",
  });
  const programRoute = resolveChannelProgramRoute(programBrief);
  const design = designPipeline({
    family,
    nicheKey: programBrief.nicheKey,
    programBrief,
    programRoute,
  });

  assert.equal(design.productionReady, true, `${family} must compile as a real automatic channel family`);
  assert.deepEqual(certifiedFamilyAdmission(family).checks, {
    productionReadiness: true,
    route: true,
    composition: true,
    inception: true,
    editorialPolicy: true,
    referenceQuality: true,
    runtime: true,
  });
  assertChannelProgramRoutePipelineCompatibility({
    route: programRoute,
    programBrief,
    pipeline: design.pipeline,
  });

  const compliance = indexOf(design.pipeline, "compliance_check");
  const plan = indexOf(design.pipeline, "self_contained_story_plan");
  const seal = indexOf(design.pipeline, "self_contained_story");
  const render = indexOf(design.pipeline, renderer);
  const originality = indexOf(design.pipeline, "originality_gate");
  const qa = indexOf(design.pipeline, "qa_visual");
  const upload = indexOf(design.pipeline, "upload_draft");
  assert.ok(
    compliance < plan && plan < seal && seal < render && render < originality && render < qa && qa < upload,
    `${family} must gate topic safety before the bounded plan and review the rendered master before draft upload`,
  );
  for (const replacedLegacyBlock of ["script_gen", "narration_tts", "stock_footage", "timeline_assemble"]) {
    assert.equal(
      design.pipeline.some((entry) => entry.block === replacedLegacyBlock),
      false,
      `${family} must not retain the generic ${replacedLegacyBlock} path beside its self-contained renderer`,
    );
  }

  const diagnosis = deriveCreatorIntentDiagnosis({ programBrief, programRoute });
  assert.equal(diagnosis.viewerJob.kind, viewerJob);
  assert.equal(diagnosis.editorialGrammar.kind, grammar);
}

const loreBrief = createChannelProgramBrief({
  family: "loreshort",
  nicheKey: "educational",
  locale: "en",
  concept: "An original first-person lore series with a clear recurring viewer payoff.",
});
const loreRoute = resolveChannelProgramRoute(loreBrief);
const loreDesign = designPipeline({
  family: "loreshort",
  nicheKey: loreBrief.nicheKey,
  programBrief: loreBrief,
  programRoute: loreRoute,
});
assertChannelProgramRoutePipelineCompatibility({
  route: loreRoute,
  programBrief: loreBrief,
  pipeline: loreDesign.pipeline,
});
assert.ok(
  indexOf(loreDesign.pipeline, "self_contained_story_plan")
    < indexOf(loreDesign.pipeline, "self_contained_story")
    && indexOf(loreDesign.pipeline, "self_contained_story") < indexOf(loreDesign.pipeline, "lore_short"),
  "Lore must use the shared sealed planner before its renderer once a benchmark admits the runtime",
);
const loreAdmission = certifiedFamilyAdmission("loreshort");
assert.equal(loreAdmission.automatic, false, "the shared planner must not erase the independent LTX benchmark gate");
assert.deepEqual(loreAdmission.checks, {
  productionReadiness: false,
  route: true,
  composition: true,
  inception: true,
  editorialPolicy: true,
  referenceQuality: true,
  runtime: false,
});
assert.deepEqual(
  familyProductionReadiness("loreshort").blockers,
  ["Lore micro-documentary: lore_short:ltx_2_5_revision_not_benchmarked_on_rtx_4090"],
  "after its common planner path is complete, only a real pinned LTX benchmark may unlock Lore",
);

console.log("self-contained automatic channel admission tests passed");
