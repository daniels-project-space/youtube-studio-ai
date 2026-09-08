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
    { phase: "narrative", range: [4, 4], blocks: ["music"] },
    { phase: "assembly", range: [5, 5], blocks: ["timeline_assemble"] },
    { phase: "release", range: [6, 6], blocks: ["qa_visual"] },
  ],
  "compact bands must preserve exact execution order, including a repeated phase",
);
assert.deepEqual(
  bands.flatMap((band) => band.modules.map((module) => module.index)),
  [1, 2, 3, 4, 5, 6],
);
assert.equal(bands[1]?.modules[0]?.controlCount, 1);
assert.equal(bands[3]?.modules[0]?.controlCount, 2);
assert.equal(pipelineControlCount([]), 0);
assert.equal(pipelineControlCount(null), 0);

console.log("compact pipeline topology preserves route order and control counts");
