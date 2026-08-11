import assert from "node:assert/strict";
import {
  assertContentLaneMatchesFamily,
  assertPipelineMatchesContentLane,
  contentLaneFingerprint,
  contentLaneForFamily,
  inferContentLane,
  injectContentLaneIntoPipeline,
  resolveContentLane,
} from "@/engine/contentLane";
import type { PipelineEntry } from "@/engine/types";
import { designPipeline } from "@/engine/designer";
import { FAMILIES } from "@/engine/families";

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
assert.equal(whiteboardPipeline.find((entry) => entry.block === "qa_visual")?.params?.contentLane, undefined);

// Regression: every real family design must satisfy the same lane contract
// before it is persisted. This prevents a future compiler completion or new
// module from quietly changing a specialist channel's renderer.
for (const family of Object.keys(FAMILIES) as Array<keyof typeof FAMILIES>) {
  const design = designPipeline({ family });
  assert.equal(design.contentLane.family, family);
  assert.doesNotThrow(() => assertPipelineMatchesContentLane(design.contentLane, design.pipeline));
}

// A long-form channel preset must not reopen the topic scope after the native
// documentary Short lane has clamped every production stage to 60 seconds.
const documentaryShortWithLongPreset = designPipeline({
  family: "documentary_collage_short",
  lengthMinutes: 5,
});
for (const block of ["topic_select", "script_gen", "short_strategy", "documotion_short"]) {
  const entry = documentaryShortWithLongPreset.pipeline.find((candidate) => candidate.block === block);
  assert(entry, `documentary Short pipeline must contain ${block}`);
  const seconds = Number(entry.params?.[block === "script_gen" ? "maxSeconds" : "targetSeconds"]);
  assert.equal(seconds, 60, `${block} must retain the native-Short duration clamp`);
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
  { block: "qa_visual" },
], music);
assert.equal(
  musicInjected.find((entry) => entry.block === "qa_visual")?.params?.audioQa,
  true,
  "music-lane QA must score audio even for a legacy pipeline without the parameter",
);

console.log("CONTENT LANE TESTS PASS");
