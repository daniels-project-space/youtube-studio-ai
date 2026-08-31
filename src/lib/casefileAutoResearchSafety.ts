/**
 * Durable stop conditions for the one Casefile path that can purchase
 * research before a normal pipeline invocation exists. These are deliberately
 * small, fixed safety ceilings: a channel that cannot converge must surface
 * for a human instead of silently consuming a fresh daily attempt forever.
 */
export const CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES = 3;
export const CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS = 48 * 60 * 60 * 1_000;

export type CasefileAutoResearchDeferralOutcome =
  | "research_failed"
  | "daily_ceiling_reached"
  | "ineligible";

export type CasefileAutoResearchPlanDisposition =
  | {
      state: "requeue";
      failureCount: number;
      ageMs: number;
    }
  | {
      state: "manual_required";
      failureCount: number;
      ageMs: number;
      reason: string;
    };

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requiredPositiveDuration(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${label} must be a positive finite duration`);
  }
  return value;
}

/**
 * Computes the next state without performing I/O so the durable Convex write
 * and regression tests share exactly the same stop rule.
 */
export function decideCasefileAutoResearchPlanDisposition(input: {
  outcome: CasefileAutoResearchDeferralOutcome;
  previousFailureCount: number | undefined;
  planClaimedAt: number | undefined;
  now: number;
  maxFailures?: number;
  maxAgeMs?: number;
}): CasefileAutoResearchPlanDisposition {
  const maxFailures = requiredPositiveInteger(
    input.maxFailures ?? CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES,
    "Casefile automatic research maximum failures",
  );
  const maxAgeMs = requiredPositiveDuration(
    input.maxAgeMs ?? CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS,
    "Casefile automatic research maximum plan age",
  );
  if (!Number.isFinite(input.now)) {
    throw new Error("Casefile automatic research decision requires a finite current time");
  }
  const previousFailureCount = input.previousFailureCount ?? 0;
  if (!Number.isInteger(previousFailureCount) || previousFailureCount < 0) {
    throw new Error("Casefile automatic research failure count is invalid");
  }

  const failureCount = previousFailureCount + (input.outcome === "research_failed" ? 1 : 0);
  const ageMs = typeof input.planClaimedAt === "number" && Number.isFinite(input.planClaimedAt)
    ? Math.max(0, input.now - input.planClaimedAt)
    : Number.POSITIVE_INFINITY;

  if (input.outcome === "ineligible") {
    return {
      state: "manual_required",
      failureCount,
      ageMs,
      reason:
        "Casefile automatic research stopped because this queued plan is no longer eligible. " +
        "Review the channel route and provide a manual Casefile source packet before retrying.",
    };
  }
  if (failureCount >= maxFailures) {
    return {
      state: "manual_required",
      failureCount,
      ageMs,
      reason:
        `Casefile automatic research stopped after ${failureCount}/${maxFailures} failed research attempts. ` +
        "Manual Casefile review or a source packet is required before retrying this plan.",
    };
  }
  if (ageMs >= maxAgeMs) {
    return {
      state: "manual_required",
      failureCount,
      ageMs,
      reason:
        "Casefile automatic research stopped because this queued plan exceeded its 48-hour research window. " +
        "Manual Casefile review or a source packet is required before retrying this plan.",
    };
  }
  return { state: "requeue", failureCount, ageMs };
}
