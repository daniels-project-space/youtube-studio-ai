import assert from "node:assert/strict";
import { assertMiniMaxH3OnDemandArgs } from "@/trigger/minimaxH3OnDemand";

const valid = {
  orderKey: "run-20260913-owner-a",
  receiptKey: "owner/a/runs/run-1/h3/on-demand-receipt.json",
  request: {
    prompt: "A readable action, no words.",
    seed: 3,
    firstFrame: { r2Key: "owner/a/runs/run-1/frames/001.png", sha256: "a".repeat(64) },
    output: { r2Key: "owner/a/runs/run-1/h3/clip-0001.mp4" },
    maxCostUsd: 0.5,
  },
};

assert.equal(assertMiniMaxH3OnDemandArgs(valid).orderKey, valid.orderKey);
assert.throws(
  () => assertMiniMaxH3OnDemandArgs({ ...valid, receiptKey: "other/receipt.json" }),
  /owner-scoped/,
);
assert.throws(
  () => assertMiniMaxH3OnDemandArgs({ ...valid, receiptKey: "owner/a/receipt.txt" }),
  /receipt key.*\.json/,
);
assert.throws(
  () => assertMiniMaxH3OnDemandArgs({
    ...valid,
    request: { ...valid.request, firstFrame: { ...valid.request.firstFrame, r2Key: "shared/frame.png" } },
  }),
  /first-frame key.*owner-scoped/,
);
assert.throws(
  () => assertMiniMaxH3OnDemandArgs({
    ...valid,
    request: { ...valid.request, output: { r2Key: "owner/a/../escape.mp4" } },
  }),
  /output key.*owner-scoped/,
);
console.log("on-demand MiniMax H3 task contracts passed");
