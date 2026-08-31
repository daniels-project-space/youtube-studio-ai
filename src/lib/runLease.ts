// Per-channel Trigger queues can legitimately wait behind one long-form render
// (up to 70 minutes plus a bounded retry). Three hours bounds abandoned
// dispatches without falsely reaping healthy serialized work.
export const RUN_QUEUE_LEASE_MS = 3 * 60 * 60_000;
export const RUN_EXECUTION_LEASE_MS = 80 * 60_000;
/** A dead worker may re-enter one frozen run twice, never indefinitely. */
export const MAX_AUTOMATIC_LEASE_RECOVERIES = 2;

export interface RunLeaseSnapshot {
  status: string;
  startedAt?: number;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  leaseOwner?: string;
  pipelineInvocationSnapshot?: unknown;
  pipelineInvocationSha256?: string;
}

/**
 * `executionAttempts` is a monotonically increasing execution generation.
 * It doubles as the write-fence token: a recovered worker receives a new
 * value, so a late predecessor cannot mutate the resumed run.
 */
export interface RunExecutionLeaseSnapshot extends RunLeaseSnapshot {
  executionAttempts?: number;
  leaseRecoveryPending?: boolean;
}

export interface RunExecutionLeaseFence {
  leaseOwner: string;
  executionLeaseToken: number;
}

export type ExpiredRunRecoveryDisposition = "resume" | "replace";

/**
 * Once a run has ever entered the leased execution model, every worker-originated
 * write must present its exact lease generation. This deliberately includes a
 * failed/reaped row: allowing an omitted pair after reaping would let the old
 * worker overwrite the recovery state. A still-running legacy row is also
 * fenced, even when it predates the numeric generation field.
 */
export function requiresRunExecutionWriteFence(run: RunExecutionLeaseSnapshot): boolean {
  return run.status === "running" ||
    run.executionAttempts !== undefined ||
    run.leaseRecoveryPending === true;
}

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
  // A serialized-program busy receipt deliberately parks a *queued* run until
  // its fenced episode lease expires. If dispatch is lost, that row still has
  // the same sealed invocation as a dead running worker and must resume it —
  // never be replaced/re-admitted from mutable channel state.
  return (run.status === "running" || run.status === "queued") &&
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

/**
 * Reject stale Trigger workers before they write a stage, artifact, or run
 * state. Owner identity alone is insufficient because Trigger retries can
 * reuse it; the execution generation changes on every lease claim.
 */
export function assertRunExecutionWriteFence(
  run: RunExecutionLeaseSnapshot,
  fence: RunExecutionLeaseFence,
  now: number,
): void {
  if (!fence.leaseOwner.trim() || !Number.isSafeInteger(fence.executionLeaseToken) ||
      fence.executionLeaseToken < 1) {
    throw new Error("run execution write fence is invalid");
  }
  if (run.status !== "running" || run.leaseOwner !== fence.leaseOwner) {
    throw new Error("run execution write fence no longer owns the active lease");
  }
  if (run.executionAttempts !== fence.executionLeaseToken) {
    throw new Error("run execution write fence is stale");
  }
  if (isRunLeaseExpired(run, now)) {
    throw new Error("run execution lease expired before the write fence could commit");
  }
}
