import assert from "node:assert/strict";
import { _resetBlocks } from "@/engine/blocks";
import { type VisualRepairSignal } from "@/engine/healer";
import { register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { type Block, type RunStageSink } from "@/engine/types";
import { VisualReviewFailure } from "@/lib/visualReview";

const signal: VisualRepairSignal = {
  schemaVersion: 1,
  owner: "timeline_assemble",
  action: "recompose_overlay",
  category: "caption_cutoff",
  severity: "major",
  startSec: 9,
  endSec: 10,
  observed: "Caption is clipped at the lower edge.",
  expected: "Caption remains fully readable in-frame.",
  confidence: 0.91,
  frameIds: ["f014"],
};

const failingReview: Block = {
  id: "visual_review_failure_fixture",
  consumes: [],
  produces: ["reviewResult"],
  run: async () => {
    throw new VisualReviewFailure("qa_visual FAILED: visual-review caption_cutoff", [signal]);
  },
};

async function main(): Promise<void> {
  _resetBlocks();
  register(failingReview);
  const sink: RunStageSink = { async upsert() {} };
  const result = await runPipeline(validatePipeline([{ block: failingReview.id }]), {
    ownerId: "owner",
    channelId: "channel",
    runId: "visual-review-recovery",
    keyPrefix: "owner/channel/",
    budgetUsd: 0,
    sink,
    defaultRetries: 2,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.visualRepair, [signal], "structured review signal must survive runner failure handling");
  console.log("visual review recovery signal test passed");
}

void main();
