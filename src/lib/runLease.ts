// Per-channel Trigger queues can legitimately wait behind one long-form render
// (up to 70 minutes plus a bounded retry). Three hours bounds abandoned
// dispatches without falsely reaping healthy serialized work.
export const RUN_QUEUE_LEASE_MS = 3 * 60 * 60_000;
export const RUN_EXECUTION_LEASE_MS = 80 * 60_000;

export interface RunLeaseSnapshot {
  status: string;
  startedAt?: number;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  leaseOwner?: string;
  pipelineInvocationSnapshot?: unknown;
  pipelineInvocationSha256?: string;
}

export type ExpiredRunRecoveryDisposition = "resume" | "replace";

export function effectiveRunLeaseExpiry(run: RunLeaseSnapshot): number {
  if (run.leaseExpiresAt !== undefined) return run.leaseExpiresAt;
  const base = run.heartbeatAt ?? run.startedAt ?? 0;
  return base + (run.status === "queued" ? RUN_QUEUE_LEASE_MS : RUN_EXECUTION_LEASE_MS);
}

export function isRunLeaseExpired(run: RunLeaseSnapshot, now: number): boolean {
  if (run.status !== "queued" && run.status !== "running") return false;
  return effectiveRunLeaseExpiry(run) <= now;
}

/**
 * Only an execution that already froze its exact invocation can safely resume
 * after a dead worker. A queued/pre-snapshot run is replaced so mutable inputs
 * are admitted again under a fresh run id instead of guessing what it spent.
 */
export function expiredRunRecoveryDisposition(
  run: RunLeaseSnapshot,
): ExpiredRunRecoveryDisposition {
  return run.status === "running" &&
    run.pipelineInvocationSnapshot !== undefined &&
    typeof run.pipelineInvocationSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(run.pipelineInvocationSha256)
    ? "resume"
    : "replace";
}

export function assertRunLeaseClaimable(
  run: RunLeaseSnapshot,
  claimant: string,
  now: number,
): void {
  if (!["queued", "running", "failed"].includes(run.status)) {
    throw new Error(`run is ${run.status}; execution cannot be claimed`);
  }
  if (
    run.status === "running" &&
    run.leaseOwner &&
    run.leaseOwner !== claimant &&
    !isRunLeaseExpired(run, now)
  ) {
    throw new Error("run is already leased by another live worker");
  }
}
