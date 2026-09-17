import assert from "node:assert/strict";

import type { VisualReviewResult } from "@/lib/visualReview";
import { visualRepairSignals } from "@/lib/visualReview";
import {
  WHITEBOARD_TIMING_REPAIR_VERSION,
  whiteboardTimingRepairFromVisualRepair,
} from "@/lib/whiteboardSync";

const reviewed: VisualReviewResult = {
  ran: true,
  verdict: "fail",
  defects: [{
    id: "trace-7",
    startSec: 12.8,
    endSec: 16.1,
    severity: "major",
    category: "reveal_failure",
    confidence: 0.93,
    observed: "The supporting evidence drawing arrives without a visible hand trace.",
    expected: "The supporting evidence is visibly drawn alongside the narrated claim.",
    evidenceFrameIds: ["frame-12", "frame-16"],
    suggestedRepair: "Make the draw trace and completed hold visible.",
    source: "vision",
  }],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    version: "video-review/v5",
    source: { durationSec: 60 },
    frames: [],
    coverage: { maxGapSec: 2, maxAllowedGapSec: 3, focusedWindows: [] },
  },
  summary: "Whiteboard hand trace is missing.",
  focusWindows: [],
  reviewFingerprint: "review-fixture",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "receipt-fixture",
  framePaths: [],
};

const signals = visualRepairSignals(reviewed, {
  title: "How a water clock changed a city",
  primaryRenderer: "whiteboard_scribe",
});
assert.equal(signals.length, 1);
assert.equal(signals[0]?.owner, "whiteboard_scribe");
assert.equal(signals[0]?.action, "strengthen_draw_trace");

const timingRepair = whiteboardTimingRepairFromVisualRepair(signals);
assert.deepEqual(timingRepair, {
  version: WHITEBOARD_TIMING_REPAIR_VERSION,
  mode: "strengthen_draw_trace",
  // Review time includes the 2.6-second whiteboard prelude; renderer time is
  // source-relative to narration, so the repair must be shifted exactly once.
  targetStartMs: 10_200,
  targetEndMs: 13_500,
  drawMultiplier: 1.25,
  handLingerMultiplier: 1.25,
  panelHoldMultiplier: 1.25,
});
assert.equal(
  whiteboardTimingRepairFromVisualRepair([{ owner: "whiteboard_scribe", action: "strengthen_draw_trace", startSec: "bad" }]),
  undefined,
  "malformed persisted repair input must not be treated as a valid renderer change",
);

const nonWhiteboard = visualRepairSignals(reviewed, { title: "Other renderer" });
assert.equal(nonWhiteboard[0]?.owner, "stock_footage");
assert.equal(nonWhiteboard[0]?.action, "resample_footage");

console.log("whiteboard visual repair routing tests passed");
