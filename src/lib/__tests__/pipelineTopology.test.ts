import assert from "node:assert/strict";
import { buildPipelineTopology, pipelineControlCount } from "../pipelineTopology";

const route = [
  { block: "topic_select" },
  { block: "script_gen", params: { targetWords: 900 } },
  { block: "stock_footage" },
  { block: "music", params: { volume: 0.12, role: "underscore" } },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
] as const;

const bands = buildPipelineTopology(route);
assert.deepEqual(
  bands.map((band) => ({
    phase: band.phase,
    range: [band.startIndex, band.endIndex],
    blocks: band.modules.map((module) => module.block),
  })),
  [
    { phase: "foundation", range: [1, 1], blocks: ["topic_select"] },
    { phase: "narrative", range: [2, 2], blocks: ["script_gen"] },
    { phase: "visual", range: [3, 3], blocks: ["stock_footage"] },
    { phase: "audio", range: [4, 4], blocks: ["music"] },
    { phase: "assembly", range: [5, 5], blocks: ["timeline_assemble"] },
    { phase: "release", range: [6, 6], blocks: ["qa_visual"] },
  ],
  "compact bands must preserve exact execution order",
);
assert.deepEqual(
  bands.flatMap((band) => band.modules.map((module) => module.index)),
  [1, 2, 3, 4, 5, 6],
);
assert.equal(bands[1]?.modules[0]?.controlCount, 1);
assert.equal(bands[3]?.modules[0]?.controlCount, 2);
assert.equal(pipelineControlCount([]), 0);
assert.equal(pipelineControlCount(null), 0);

const rainyNeonRoute = [
  "competitor_research",
  "topic_select",
  "critic_spec",
  "composer_brief",
  "dp_brief",
  "compliance_check",
  "scene_planner",
  "keyframes",
  "loop_clips",
  "upscale",
  "music",
  "metadata",
  "assemble",
  "package_to_opening_plan",
  "thumbnail_gen",
  "qa_visual",
  "upload_draft",
  "notify",
  "cleanup",
].map((block) => ({ block }));

assert.deepEqual(
  buildPipelineTopology(rainyNeonRoute).map((band) => ({
    label: band.label,
    range: [band.startIndex, band.endIndex],
  })),
  [
    { label: "Foundation", range: [1, 2] },
    { label: "Direction", range: [3, 6] },
    { label: "Visual production", range: [7, 10] },
    { label: "Audio", range: [11, 11] },
    { label: "Metadata", range: [12, 12] },
    { label: "Assembly", range: [13, 13] },
    { label: "Release", range: [14, 19] },
  ],
  "the real Lo-Fi route must use unique, truthful operator phase labels",
);

console.log("compact pipeline topology preserves route order and control counts");
