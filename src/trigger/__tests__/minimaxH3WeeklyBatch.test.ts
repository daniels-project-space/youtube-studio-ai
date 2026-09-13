import assert from "node:assert/strict";
import { assertMiniMaxH3WeeklyBatchArgs } from "@/trigger/minimaxH3WeeklyBatch";

const valid = {
  orderKey: "week-20260913-owner-a",
  receiptKey: "owner/a/plan-batches/week-20260913/h3/receipt.json",
  jobs: [{
    prompt: "A readable action, no words.", seed: 3,
    firstFrame: { r2Key: "owner/a/frames/001.png", sha256: "a".repeat(64) },
    output: { r2Key: "owner/a/plan-batches/week-20260913/items/001/preparation/footage/clip-0001.mp4" },
    maxCostUsd: 0.5,
  }],
};
assert.equal(assertMiniMaxH3WeeklyBatchArgs(valid).orderKey, valid.orderKey);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, receiptKey: "../receipt.json" }), /receipt key/);
assert.throws(() => assertMiniMaxH3WeeklyBatchArgs({ ...valid, jobs: [{ ...valid.jobs[0], output: { r2Key: "other/path.mp4" } }] }), /owner-scoped/);
console.log("weekly MiniMax H3 batch task contracts passed");
