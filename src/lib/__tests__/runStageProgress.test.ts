import assert from "node:assert/strict";
import { summarizeRunStageProgress } from "../runStageProgress";
import { livePipelineOverallState } from "../livePipelinePresentation";

const pipeline = [
  { block: "topiccraft" },
  { block: "scriptcraft" },
  { block: "timeline_assemble" },
];

assert.deepEqual(summarizeRunStageProgress({ pipeline, stages: [] }), {
  completed: 0,
  total: 3,
  totalKnown: true,
  currentBlock: "topiccraft",
  currentStatus: "queued",
  currentPosition: 1,
});

assert.deepEqual(summarizeRunStageProgress({
  pipeline,
  stages: [
    { block: "scriptcraft", status: "running", startedAt: 20 },
    { block: "topiccraft", status: "ok", startedAt: 10 },
  ],
}), {
  completed: 1,
  total: 3,
  totalKnown: true,
  currentBlock: "scriptcraft",
  currentStatus: "running",
  currentPosition: 2,
});

assert.equal(livePipelineOverallState([]), "unavailable");
assert.equal(livePipelineOverallState([{ block: "script_gen" }]), "queued");
assert.equal(livePipelineOverallState([{ block: "script_gen", stage: { status: "running" } }]), "active");
assert.equal(livePipelineOverallState([{ block: "script_gen", stage: { status: "failed" } }]), "blocked");
assert.equal(livePipelineOverallState([{ block: "script_gen", stage: { status: "ok" } }]), "complete");

assert.deepEqual(summarizeRunStageProgress({
  pipeline,
  stages: [
    { block: "topiccraft", status: "ok" },
    { block: "scriptcraft", status: "failed" },
  ],
}), {
  completed: 1,
  total: 3,
  totalKnown: true,
  currentBlock: "scriptcraft",
  currentStatus: "failed",
  currentPosition: 2,
});

assert.deepEqual(summarizeRunStageProgress({
  stages: [
    { block: "scriptcraft", status: "running", startedAt: 20 },
    { block: "topiccraft", status: "ok", startedAt: 10 },
  ],
}), {
  completed: 1,
  total: 2,
  totalKnown: false,
  currentBlock: "scriptcraft",
  currentStatus: "running",
  currentPosition: 2,
});

assert.deepEqual(summarizeRunStageProgress({
  pipeline,
  stages: pipeline.map(({ block }) => ({ block, status: "ok" })),
}), {
  completed: 3,
  total: 3,
  totalKnown: true,
});

console.log("run stage progress summary tests passed");
