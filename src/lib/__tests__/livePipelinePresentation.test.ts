import assert from "node:assert/strict";
import {
  describeLivePipelinePhase,
  livePipelinePhaseForBlock,
  summarizeLivePipelinePhases,
} from "../livePipelinePresentation";

assert.equal(livePipelinePhaseForBlock("narrative_series_visual_controls"), "narrative");
assert.equal(livePipelinePhaseForBlock("visual_matter_references"), "visual");
assert.equal(livePipelinePhaseForBlock("timeline_assemble"), "assembly");
assert.equal(livePipelinePhaseForBlock("qa_visual"), "release");

const summaries = summarizeLivePipelinePhases([
  { block: "topic_select", stage: { status: "ok" } },
  { block: "script_gen", stage: { status: "ok" } },
  { block: "story_spine", stage: { status: "running" } },
  { block: "visual_matter_references" },
  { block: "novita_render_images", stage: { status: "failed" } },
  { block: "timeline_assemble" },
  { block: "qa_visual" },
]);

assert.deepEqual(
  summaries.map((summary) => [summary.phase, summary.state, summary.verified, summary.running, summary.blocked, summary.waiting]),
  [
    ["foundation", "complete", 1, 0, 0, 0],
    ["narrative", "active", 1, 1, 0, 0],
    ["visual", "blocked", 0, 0, 1, 1],
    ["assembly", "waiting", 0, 0, 0, 1],
    ["release", "waiting", 0, 0, 0, 1],
  ],
);
assert.equal(
  describeLivePipelinePhase(summaries[2]!),
  "Visual production: 1 stage needs attention",
);

console.log("live pipeline presentation tests passed");
