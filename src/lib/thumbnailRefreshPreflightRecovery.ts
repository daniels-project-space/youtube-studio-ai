/**
 * A thumbnail candidate may be retried only when it stopped before the paid
 * renderer boundary. Keeping this decision pure lets the API, Convex mutation,
 * and Library present one identical, intentionally narrow recovery policy.
 */
export type ThumbnailPreflightRecoveryCandidate = Readonly<{
  status: string;
  costTotal: number;
  error?: string | null;
}>;

const RETRYABLE_QA_PREFLIGHT_FAILURE = /^(?:bootstrap: CRITICAL keys missing after vault hydration: OPENROUTER_API_KEY\b|thumbnail_gen: no configured production QA provider$)/u;

export function canRetryThumbnailPreflight(
  candidate: ThumbnailPreflightRecoveryCandidate | null | undefined,
): boolean {
  if (!candidate || candidate.status !== "failed" || candidate.costTotal !== 0) return false;
  return RETRYABLE_QA_PREFLIGHT_FAILURE.test(candidate.error?.trim() ?? "");
}
