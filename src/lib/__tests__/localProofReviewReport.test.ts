import assert from "node:assert/strict";

import { localProofReviewAudit } from "@/lib/localProofReviewReport";
import type { VisualReviewResult } from "@/lib/visualReview";

function review(overrides: Record<string, unknown> = {}): VisualReviewResult {
  return {
    verdict: "pass",
    defects: [],
    evidence: {
      frames: [{ id: "frame-1" }],
      coverage: { maxGapSec: 3, maxAllowedGapSec: 4, focusedWindows: [] },
    },
    reviewFingerprint: "a".repeat(64),
    ...overrides,
  } as unknown as VisualReviewResult;
}

const pass = localProofReviewAudit({
  artifactPath: "/tmp/proof.mp4",
  durationSec: 42,
  review: review(),
});
assert.deepEqual(pass, {
  contract: "local-proof-review-audit/v1",
  verdict: "pass",
  framesReviewed: 1,
  coverage: { startSec: 0, endSec: 42, maxGapSec: 3, maxAllowedGapSec: 4 },
  findings: [],
  repairCycles: 0,
  artifactPath: "/tmp/proof.mp4",
  reviewFingerprint: "a".repeat(64),
});

const repair = localProofReviewAudit({
  artifactPath: "/tmp/proof.mp4",
  durationSec: 42,
  review: review({
    verdict: "needs_human",
    defects: [{
      id: "defect-1",
      startSec: 11,
      endSec: 12,
      severity: "major",
      observed: "Caption overlaps the subject.",
      suggestedRepair: "Move the caption into the clear band.",
    }],
  }),
});
assert.equal(repair.verdict, "repair");
assert.deepEqual(repair.findings, [{
  timestampSec: 11,
  severity: "major",
  evidence: "Caption overlaps the subject.",
  repair: "Move the caption into the clear band.",
}]);

console.log("local proof review report: PASS");
