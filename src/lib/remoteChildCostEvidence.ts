/** Durable accounting evidence for one fenced Trigger child dispatch. */
export interface RemoteChildCostAttempt {
  dispatchKey: string;
  taskRunId: string;
  attemptNumber: number;
  status: "started" | "succeeded" | "failed";
  costUsd: number;
  complete: boolean;
}

export interface RemoteChildCostSummary {
  costUsd: number;
  complete: boolean;
  attempts: number;
}

export function summarizeRemoteChildCosts(
  attempts: readonly RemoteChildCostAttempt[],
  dispatchKey: string,
): RemoteChildCostSummary {
  const matching = attempts.filter((attempt) => attempt.dispatchKey === dispatchKey);
  return {
    costUsd: matching.reduce((sum, attempt) => sum + attempt.costUsd, 0),
    complete: matching.length > 0 && matching.every((attempt) => attempt.complete && attempt.status !== "started"),
    attempts: matching.length,
  };
}

/** Numeric costs come from the fenced database receipt, never serialized errors. */
export function remoteChildFailureWithEvidence(
  message: string,
  summary?: RemoteChildCostSummary,
): Error {
  const complete = summary?.complete === true;
  return Object.assign(new Error(complete
    ? message
    : `PAID_STAGE_RECONCILIATION_REQUIRED: remote child cost is incomplete; ${message}`), {
    observedCostUsd: summary?.costUsd ?? 0,
  });
}
