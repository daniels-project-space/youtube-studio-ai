import { maxAllowedVisualReviewGapSec } from "@/lib/visualReview";

/**
 * Broad-review budget for a private local proof.  It deliberately matches the
 * production maximum-gap rule, so a long proof cannot receive a flattering
 * verdict from a fixed small representative sample.
 */
export function localProofBroadFrameBudget(durationSec: number): number {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  if (duration === 0) return 16;
  return Math.max(16, Math.ceil(duration / maxAllowedVisualReviewGapSec(duration)));
}
