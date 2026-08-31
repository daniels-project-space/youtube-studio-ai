import type { VisualReviewResult } from "@/lib/visualReview";

/**
 * Portable, provider-independent summary for a local render proof. It is
 * separate from a release certificate: a local proof helps decide whether a
 * route is ready for a private benchmark and grants no publication authority.
 */
export interface LocalProofReviewAudit {
  contract: "local-proof-review-audit/v1";
  verdict: "pass" | "repair" | "fail";
  framesReviewed: number;
  coverage: {
    startSec: number;
    endSec: number;
    maxGapSec: number;
    maxAllowedGapSec: number;
  };
  findings: readonly {
    timestampSec: number;
    severity: "critical" | "major" | "minor";
    evidence: string;
    repair: string;
  }[];
  repairCycles: 0;
  artifactPath: string;
  reviewFingerprint: string;
}

export function localProofReviewAudit(input: {
  readonly artifactPath: string;
  readonly durationSec: number;
  readonly review: VisualReviewResult;
}): LocalProofReviewAudit {
  const endSec = Number.isFinite(input.durationSec) ? Math.max(0, input.durationSec) : 0;
  return {
    contract: "local-proof-review-audit/v1",
    verdict:
      input.review.verdict === "pass"
        ? "pass"
        : input.review.verdict === "needs_human"
          ? "repair"
          : "fail",
    framesReviewed: input.review.evidence.frames.length,
    coverage: {
      startSec: 0,
      endSec,
      maxGapSec: input.review.evidence.coverage.maxGapSec,
      maxAllowedGapSec: input.review.evidence.coverage.maxAllowedGapSec,
    },
    findings: input.review.defects.map((defect) => ({
      timestampSec: defect.startSec,
      severity: defect.severity,
      evidence: defect.observed,
      repair: defect.suggestedRepair,
    })),
    repairCycles: 0,
    artifactPath: input.artifactPath,
    reviewFingerprint: input.review.reviewFingerprint,
  };
}
