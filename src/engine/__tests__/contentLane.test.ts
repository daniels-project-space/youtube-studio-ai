import assert from "node:assert/strict";
import {
  assertContentLaneMatchesFamily,
  assertPipelineMatchesContentLane,
  contentLaneFingerprint,
  contentLaneForFamily,
  inferContentLane,
  injectContentLaneIntoPipeline,
  laneQualityPolicy,
  resolveContentLane,
} from "@/engine/contentLane";
import type { PipelineEntry } from "@/engine/types";
import { designPipeline } from "@/engine/designer";
import { FAMILIES } from "@/engine/families";
import { validatePipeline } from "@/engine/validate";

const whiteboard = contentLaneForFamily("whiteboard");
assert(whiteboard, "whiteboard must have a canonical content lane");

const whiteboardPipeline: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "director_brief" },
  { block: "critic_spec" },
  { block: "music" },
  { block: "whiteboard_scribe" },
  { block: "originality_gate" },
  { block: "qa_visual", params: { qaProfile: "production" } },
];

assert.doesNotThrow(() => assertPipelineMatchesContentLane(whiteboard, whiteboardPipeline));
assert.throws(
  () => assertPipelineMatchesContentLane(whiteboard, whiteboardPipeline.filter((entry) => entry.block !== "qa_visual")),
  /requires qa_visual/,
  "every defined channel lane must retain the visual release gate",
);
assert.throws(
  () => assertPipelineMatchesContentLane(whiteboard, [...whiteboardPipeline, { block: "stock_footage" }]),
  /forbids stock_footage/,
  "a whiteboard channel cannot silently add stock footage",
);
assert.throws(
  () => assertPipelineMatchesContentLane(whiteboard, [...whiteboardPipeline, { block: "gen_footage" }]),
  /forbids gen_footage/,
  "a whiteboard channel cannot silently add generated footage",
);
assert.throws(
  () => assertPipelineMatchesContentLane(whiteboard, [...whiteboardPipeline, { block: "motion_comic" }]),
  /forbids motion_comic/,
  "a whiteboard channel cannot silently become a comic channel",
);
assert.throws(
  () => assertPipelineMatchesContentLane(
    whiteboard,
    whiteboardPipeline.map((entry) => entry.block === "whiteboard_scribe" ? { block: "stock_footage" } : entry),
  ),
  /requires whiteboard_scribe; forbids stock_footage/,
  "renderer replacement must be rejected even when the rest of the pipeline is valid",
);

const narrated = contentLaneForFamily("narrated_stock");
assert(narrated, "narrated stock must have a canonical content lane");
const narratedPipeline: PipelineEntry[] = [
  { block: "topic_select" },
  { block: "director_brief" },
  { block: "stock_footage" },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
];
assert.doesNotThrow(
  () => assertPipelineMatchesContentLane(narrated, narratedPipeline),
  "crew and QA additions must not change a visual lane",
);
assert.throws(
  () => assertPipelineMatchesContentLane(
    narrated,
    narratedPipeline.map((entry) => entry.block === "stock_footage" ? { block: "gen_footage" } : entry),
  ),
  /requires stock_footage; forbids gen_footage/,
);

// A Casefile sequence uses the same pinned Novita visual stack as the direct
// cinematic renderer, but its reviewed LTX handoff is encapsulated by
// gen_footage. It must be a complete alternative chain, never a way to add
// stock footage or skip final assembly/QA.
const cinematic = contentLaneForFamily("cinematic");
assert(cinematic, "cinematic must have a canonical content lane");
assert.doesNotThrow(() => assertPipelineMatchesContentLane(cinematic, [
  { block: "novita_render_images" },
  { block: "qa_assets" },
  { block: "novita_render_video" },
  { block: "qa_shots" },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
]));
assert.doesNotThrow(() => assertPipelineMatchesContentLane(cinematic, [
  { block: "cinematic_case_sequence" },
  { block: "gen_footage" },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
]), "the source-admitted Casefile handoff must be a valid cinematic Novita chain");
assert.throws(
  () => assertPipelineMatchesContentLane(cinematic, [
    { block: "gen_footage" },
    { block: "timeline_assemble" },
    { block: "qa_visual" },
  ]),
  /gen_footage requires cinematic_case_sequence/,
  "the shared LTX renderer must not bypass the source-admitted cinematic sequence",
);
assert.throws(
  () => assertPipelineMatchesContentLane(cinematic, [
    { block: "novita_render_images" },
    { block: "novita_render_video" },
    { block: "timeline_assemble" },
    { block: "qa_visual" },
  ]),
  /requires one renderer chain: novita_render_images \+ qa_assets \+ novita_render_video \+ qa_shots OR gen_footage/,
  "a partial direct Novita chain must remain rejected",
);
const designedCinematicBlocks = designPipeline({ family: "cinematic" }).pipeline.map((entry) => entry.block);
for (const block of ["novita_render_images", "qa_assets", "novita_render_video", "qa_shots"]) {
  assert(
    designedCinematicBlocks.includes(block),
    `the standard cinematic template must compile its complete pinned Novita chain, including ${block}`,
  );
}
assert.equal(
  designedCinematicBlocks.includes("stock_footage"),
  false,
  "the cinematic template must not retain the narrated-stock producer beside its Novita chain",
);

const inferredWhiteboard = inferContentLane(whiteboardPipeline);
assert.equal(inferredWhiteboard.key, "whiteboard_explainer");
assert.equal(resolveContentLane({ family: "whiteboard", pipeline: narratedPipeline }).key, "whiteboard_explainer");
assert.equal(resolveContentLane({ pipeline: [{ block: "unknown_renderer" }] }).key, "legacy_unclassified");
assert.throws(
  () => resolveContentLane({ stored: narrated, family: "whiteboard" }),
  /Content lane is immutable/,
);
assert.throws(() => assertContentLaneMatchesFamily(whiteboard, "comic"), /Content lane is immutable/);

const firstFingerprint = contentLaneFingerprint(whiteboard);
assert.equal(firstFingerprint, contentLaneFingerprint({ ...whiteboard }));
assert.match(firstFingerprint, /^cl_[0-9a-f]{8}$/);

const injected = injectContentLaneIntoPipeline(whiteboardPipeline, whiteboard);
const injectedQa = injected.find((entry) => entry.block === "qa_visual");
assert.deepEqual(injectedQa?.params?.contentLane, whiteboard);
assert.equal(injectedQa?.params?.contentLaneFingerprint, firstFingerprint);
assert.equal(
  injectedQa?.params?.audioQa,
  true,
  "every classified production lane must score the final audience-facing audio",
);
assert.equal(whiteboardPipeline.find((entry) => entry.block === "qa_visual")?.params?.contentLane, undefined);

// Final-master pacing is owned by the same lane contract as static-hold QA.
// It is never a global "more cuts is better" score: only fast-paced Shorts
// receive the measurable cadence mode, while cinematic/narrated/children lanes
// preserve a calibrated human-review route for legitimate continuous movement.
assert.equal(laneQualityPolicy("short_form").visualPacing.mode, "scene_rhythm");
assert(laneQualityPolicy("short_form").visualPacing.maxMarkerHoldSec! <= 6);
for (const lane of ["children_learning_supervised", "narrated_documentary", "cinematic_ai"] as const) {
  assert.equal(laneQualityPolicy(lane).visualPacing.mode, "calibrated_review");
  assert(laneQualityPolicy(lane).visualPacing.maxMarkerHoldSec !== null);
}
for (const lane of ["ambient_guided", "music_loop"] as const) {
  assert.equal(laneQualityPolicy(lane).visualPacing.mode, "exempt");
  assert.equal(laneQualityPolicy(lane).visualPacing.maxMarkerHoldSec, null);
}

// Regression: every real family design must satisfy the same lane contract
// before it is persisted. This prevents a future compiler completion or new
// module from quietly changing a specialist channel's renderer.
for (const family of Object.keys(FAMILIES) as Array<keyof typeof FAMILIES>) {
  const design = designPipeline({ family });
  assert.equal(design.contentLane.family, family);
  assert.doesNotThrow(() => assertPipelineMatchesContentLane(design.contentLane, design.pipeline));
  assert.equal(
    design.pipeline.find((entry) => entry.block === "qa_visual")?.params?.audioQa,
    true,
    `${family} must carry aesthetic-audio QA in its production compiler output`,
  );
}

// Children’s learning is a supervised system profile, not a generic narrated
// channel with a colourful skin. A caller cannot use creator overrides to
// bypass the causal scene plan, deterministic renderer, or draft-only release.
const childrenLearning = designPipeline({ family: "children_learning", publishMode: "public" });
const childrenBlocks = childrenLearning.pipeline.map((entry) => entry.block);
for (const block of ["episode_graph", "learning_contract", "children_show_bible", "child_content_safety", "scene_compiler"]) {
  assert(childrenBlocks.includes(block), `children-learning must include ${block}`);
}
assert(
  childrenBlocks.indexOf("episode_graph") < childrenBlocks.indexOf("learning_contract") &&
    childrenBlocks.indexOf("learning_contract") < childrenBlocks.indexOf("children_show_bible") &&
    childrenBlocks.indexOf("children_show_bible") < childrenBlocks.indexOf("child_content_safety") &&
    childrenBlocks.indexOf("child_content_safety") < childrenBlocks.indexOf("scene_compiler"),
  "children-learning must bind a current child-editor packet before safety review and rendering",
);
assert.throws(
  () => validatePipeline(childrenLearning.pipeline, ["contentLane"]),
  /children_show_bible.*childrenShowBibleInput/,
  "a supervised children pipeline must declare the external human-editor packet rather than silently fabricate one",
);
assert.doesNotThrow(
  () => validatePipeline(childrenLearning.pipeline, ["contentLane", "childrenShowBibleInput"]),
  "the approved packet is a deliberate per-run seed, not a missing automatic planner output",
);
assert.throws(
  () => assertPipelineMatchesContentLane(
    childrenLearning.contentLane,
    childrenLearning.pipeline.filter((entry) => entry.block !== "children_show_bible"),
  ),
  /requires children_show_bible/,
  "the supervised lane cannot omit the child-editor admission block",
);
const childrenUpload = childrenLearning.pipeline.find((entry) => entry.block === "upload_draft");
assert.equal(childrenUpload?.params?.publishMode, "draft");
assert.equal(childrenUpload?.params?.madeForKids, true);

// A long-form request must be rejected instead of being silently converted
// into a one-minute Short. The valid upper-bound request then has to reach
// every duration-sensitive stage unchanged.
assert.throws(
  () => designPipeline({ family: "documentary_collage_short", lengthMinutes: 5 }),
  /supports 35 sec–60 sec/,
  "a documentary Short must not silently clamp an incompatible long-form request",
);
const documentaryShortAtMaximum = designPipeline({
  family: "documentary_collage_short",
  lengthMinutes: 1,
});
for (const block of ["topic_select", "script_gen", "short_strategy", "documotion_short"]) {
  const entry = documentaryShortAtMaximum.pipeline.find((candidate) => candidate.block === block);
  assert(entry, `documentary Short pipeline must contain ${block}`);
  const seconds = Number(entry.params?.[block === "script_gen" ? "maxSeconds" : "targetSeconds"]);
  assert.equal(seconds, 60, `${block} must preserve the selected native-Short duration`);
}

const documentarySources = [
  {
    id: "source:archive",
    type: "archive",
    title: "Primary archive record",
    citation: "Primary archive record, 1911.",
    url: "https://example.com/archive-record",
  },
];
const documentaryClaimEvidence = Array.from({ length: 7 }, (_, index) => ({
  claimId: `claim:${index + 1}`,
  sourceId: "source:archive",
  excerpt: `Archive excerpt for locked documentary beat ${index + 1}.`,
  locator: `folio ${index + 1}`,
}));
const documentaryShortWithSources = designPipeline({
  family: "documentary_collage_short",
  sourceReferences: documentarySources,
  claimEvidence: documentaryClaimEvidence,
});
const documentaryStrategy = documentaryShortWithSources.pipeline.find(
  (entry) => entry.block === "short_strategy",
);
assert.deepEqual(
  documentaryStrategy?.params?.sourceReferences,
  documentarySources,
  "documentary source references must persist into the executable short_strategy entry",
);
assert.deepEqual(
  documentaryStrategy?.params?.claimEvidence,
  documentaryClaimEvidence,
  "documentary claim evidence must persist into the executable short_strategy entry",
);
assert.equal(
  documentaryShortWithSources.warnings.some((warning) => /sourceReferences|claimEvidence/.test(warning)),
  false,
  "an explicit structured source bundle clears the documentary Short source warning",
);

const longFormDocumentaryCandidates = designPipeline({
  family: "narrated_stock",
  toggles: { documentaryCandidates: true },
});
const candidateIndex = longFormDocumentaryCandidates.pipeline.findIndex(
  (entry) => entry.block === "documentary_short_candidates",
);
assert(candidateIndex >= 0, "long-form documentary candidate mining must be reachable from the designed pipeline");
assert.equal(
  longFormDocumentaryCandidates.pipeline.some((entry) => entry.block === "shorts_spinoff"),
  false,
  "planning a documentary candidate set must not crop or upload a parent-video Short",
);
assert(
  candidateIndex > longFormDocumentaryCandidates.pipeline.findIndex((entry) => entry.block === "upload_draft"),
  "candidate mining must occur after the parent draft has completed",
);

const music = contentLaneForFamily("music_loop");
assert(music, "music loop must have a canonical lane");
assert.throws(
  () => assertPipelineMatchesContentLane(music, [
    { block: "loop_clips" },
    { block: "visual_matter" },
    { block: "assemble" },
    { block: "qa_visual" },
  ]),
  /forbids visual_matter/,
  "lo-fi must never inherit story-visual development just because the module exists",
);
const musicInjected = injectContentLaneIntoPipeline([
  { block: "loop_clips" },
  { block: "assemble" },
  { block: "qa_visual", params: { audioQa: false } },
], music);
assert.equal(
  musicInjected.find((entry) => entry.block === "qa_visual")?.params?.audioQa,
  true,
  "music-lane QA must score audio even when an old pipeline disabled it",
);
const ambient = contentLaneForFamily("sleep");
assert(ambient, "ambient guided must have a canonical lane");
const ambientInjected = injectContentLaneIntoPipeline([
  { block: "stock_footage" },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
], ambient);
assert.equal(
  ambientInjected.find((entry) => entry.block === "qa_visual")?.params?.audioQa,
  true,
  "guided ambient QA must score the audio-first experience",
);

console.log("CONTENT LANE TESTS PASS");
