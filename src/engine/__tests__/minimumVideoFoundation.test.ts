import assert from "node:assert/strict";
import { certifiedFamilyAdmission } from "../certifiedFamilyAdmission";
import { designPipeline } from "../designer";
import { FAMILY_KEYS, type FamilyKey } from "../families";
import {
  MINIMUM_VIDEO_FOUNDATION_TEMPLATE,
  MINIMUM_VIDEO_FOUNDATION_VERSION,
  assertMinimumVideoFoundationForAutomaticFamily,
  assertMinimumVideoFoundation,
  minimumVideoFoundationFor,
  pipelineSupportsNarrationAlignedShorts,
} from "../minimumVideoFoundation";
import type { PipelineEntry } from "../types";

function designed(family: FamilyKey) {
  return designPipeline({ family, nicheKey: "history", publishMode: "draft" });
}

for (const family of FAMILY_KEYS) {
  const design = designed(family);
  const foundation = assertMinimumVideoFoundation({
    family,
    contentLane: design.contentLane,
    pipeline: design.pipeline,
  });
  assert.equal(foundation.version, MINIMUM_VIDEO_FOUNDATION_VERSION);
  assert.equal(foundation.family, family);
  assert.equal(foundation.primaryRenderer, design.contentLane.primaryRenderer);
  assert.equal(foundation.stages, MINIMUM_VIDEO_FOUNDATION_TEMPLATE);
  if (certifiedFamilyAdmission(family).automatic) {
    assert.equal(
      assertMinimumVideoFoundationForAutomaticFamily({
        family,
        contentLane: design.contentLane,
        pipeline: design.pipeline,
      }),
      true,
      `the creator baseline must produce an automatic-ready foundation for ${family}`,
    );
  }
}

{
  const design = designed("narrated_stock");
  const broken = design.pipeline.filter((entry) => entry.block !== "thumbnail_gen");
  assert.throws(
    () => assertMinimumVideoFoundation({ family: "narrated_stock", contentLane: design.contentLane, pipeline: broken }),
    /thumbnail package requires exactly one thumbnail_gen stage/,
  );
}

{
  const design = designed("narrated_stock");
  const broken = design.pipeline.filter((entry) => entry.block !== "originality_gate");
  assert.throws(
    () => assertMinimumVideoFoundation({
      family: "narrated_stock",
      contentLane: design.contentLane,
      pipeline: broken,
    }),
    /episode differentiation requires one of originality_gate, quiz_topic_plan, curriculum_episode_seed, cinematic_case_sequence, music_program_plan; found none/,
    "the shared baseline must not leave a non-certified draft route interchangeable merely because it has not reached automatic admission",
  );
assert.throws(
  () => assertMinimumVideoFoundationForAutomaticFamily({
    family: "narrated_stock",
      contentLane: design.contentLane,
      pipeline: broken,
    }),
  /episode differentiation requires one of originality_gate, quiz_topic_plan, curriculum_episode_seed, cinematic_case_sequence, music_program_plan; found none/,
  "automatic narrative routes must not persist without the creator-wide cross-episode differentiation authority",
);

assert.throws(
  () => assertMinimumVideoFoundationForAutomaticFamily({
    family: "narrated_stock",
    contentLane: design.contentLane,
    pipeline: [...design.pipeline, { block: "quiz_topic_plan" }],
  }),
  /automatic episode promise requires exactly one topic_select or quiz_topic_plan or curriculum_episode_seed or cinematic_case_sequence stage; found 2/,
  "an optional capability cannot add a competing episode planner to a sealed automatic foundation",
);

assert.throws(
  () => assertMinimumVideoFoundationForAutomaticFamily({
    family: "narrated_stock",
    contentLane: design.contentLane,
    pipeline: [...design.pipeline, { block: "originality_gate" }],
  }),
  /automatic episode differentiation requires exactly one originality_gate or quiz_topic_plan stage; found 2/,
  "automatic production cannot combine independent episode-differentiation authorities",
);
}

{
  const design = designed("music_loop");
  const broken = design.pipeline.filter((entry) => entry.block !== "music_program_plan");
  assert.throws(
    () => assertMinimumVideoFoundation({
      family: "music_loop",
      contentLane: design.contentLane,
      pipeline: broken,
    }),
    /episode differentiation requires one of originality_gate, quiz_topic_plan, curriculum_episode_seed, cinematic_case_sequence, music_program_plan; found none/,
    "an original music lane must retain its program authority rather than relying on a decorative loop template",
  );
}

{
  const design = designed("quizyear");
  assert.doesNotThrow(
    () => assertMinimumVideoFoundationForAutomaticFamily({
      family: "quizyear",
      contentLane: design.contentLane,
      pipeline: design.pipeline,
    }),
    "the certified factual quiz path satisfies the shared differentiation baseline through its source-backed planner",
  );
}

{
  const design = designed("quizyear");
  const broken = design.pipeline.filter((entry) => entry.block !== "package_to_opening_plan");
  assert.throws(
    () => assertMinimumVideoFoundation({ family: "quizyear", contentLane: design.contentLane, pipeline: broken }),
    /package-to-opening binding requires exactly one package_to_opening_plan stage/,
  );
}

{
  const design = designed("illustrated_explainer");
  const broken: PipelineEntry[] = design.pipeline.map((entry) => ({ ...entry }));
  const reviewAt = broken.findIndex((entry) => entry.block === "qa_visual");
  const releaseAt = broken.findIndex((entry) => entry.block === "upload_draft");
  [broken[reviewAt], broken[releaseAt]] = [broken[releaseAt], broken[reviewAt]];
  assert.throws(
    () => assertMinimumVideoFoundation({ family: "illustrated_explainer", contentLane: design.contentLane, pipeline: broken }),
    /final-master review before draft release must run in this order/,
  );
}

{
  const design = designed("narrated_stock");
  const broken = design.pipeline.map((entry) =>
    entry.block === "qa_visual"
      ? { ...entry, params: { ...(entry.params ?? {}), audioQa: false } }
      : entry,
  );
  assert.throws(
    () => assertMinimumVideoFoundation({ family: "narrated_stock", contentLane: design.contentLane, pipeline: broken }),
    /requires final-master audio-aesthetics QA/,
    "the foundation must reject a named visual-review stage that silently omits audience-facing audio QA",
  );
}

{
  const design = designed("narrated_stock");
  const broken = design.pipeline.map((entry) =>
    entry.block === "qa_visual"
      ? { ...entry, params: { ...(entry.params ?? {}), qaProfile: "draft" } }
      : entry,
  );
  assert.throws(
    () => assertMinimumVideoFoundation({ family: "narrated_stock", contentLane: design.contentLane, pipeline: broken }),
    /requires production qa_visual/,
    "the foundation must reject a draft-only review before a draft upload handoff",
  );
}

{
  const design = designed("whiteboard");
  const foundation = minimumVideoFoundationFor({ family: "whiteboard", contentLane: design.contentLane });
  assert.equal(foundation.primaryRenderer, "whiteboard_scribe");
  assert.equal(
    foundation.stages.some((stage) => /script|character/i.test(stage.requirement)),
    false,
    "the universal foundation must not force a script or character-sheet workflow onto a whiteboard route",
  );
}

{
  const whiteboardWithShort = designPipeline({
    family: "whiteboard",
    nicheKey: "history",
    publishMode: "draft",
    toggles: { shorts: true },
  });
  const comicWithShort = designPipeline({
    family: "comic",
    nicheKey: "history",
    publishMode: "draft",
    toggles: { shorts: true },
  });
  assert.equal(pipelineSupportsNarrationAlignedShorts(whiteboardWithShort.pipeline), true);
  assert.equal(pipelineSupportsNarrationAlignedShorts(comicWithShort.pipeline), true);
  assert.ok(
    whiteboardWithShort.pipeline.some((entry) => entry.block === "shorts_spinoff"),
    "a Whiteboard master with its own sentence-aligned narration must qualify for the same certified Short transform",
  );
  assert.ok(
    comicWithShort.pipeline.some((entry) => entry.block === "shorts_spinoff"),
    "a Motion Comic master with its own sentence-aligned narration must qualify for the same certified Short transform",
  );
  const wordlessMusic = designPipeline({
    family: "music_loop",
    nicheKey: "history",
    publishMode: "draft",
    toggles: { shorts: true },
  });
  assert.equal(pipelineSupportsNarrationAlignedShorts(wordlessMusic.pipeline), false);
  assert.ok(
    !wordlessMusic.pipeline.some((entry) => entry.block === "shorts_spinoff"),
    "a wordless music master must not fabricate narration-aligned Short evidence",
  );
}

{
  const design = designed("narrated_stock");
  const broken = design.pipeline.filter((entry) => entry.block !== "thumbnail_gen");
  assert.throws(
    () => assertMinimumVideoFoundationForAutomaticFamily({
      family: "narrated_stock",
      contentLane: design.contentLane,
      pipeline: broken,
    }),
    /thumbnail package requires exactly one thumbnail_gen stage/,
    "an automatic family must not be persisted through the lane-only validator with an incomplete foundation",
  );
  assert.equal(
    assertMinimumVideoFoundationForAutomaticFamily({
      family: "cinematic",
      contentLane: designed("cinematic").contentLane,
      pipeline: designed("cinematic").pipeline,
    }),
    false,
    "a supervised or blocked family must not be silently treated as an automatic route at the persistence boundary",
  );
}

console.log("MINIMUM VIDEO FOUNDATION PASS");
