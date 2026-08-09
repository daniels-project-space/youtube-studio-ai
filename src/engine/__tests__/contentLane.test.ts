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

const music = contentLaneForFamily("music_loop");
assert(music, "music loop must have a canonical lane");
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
