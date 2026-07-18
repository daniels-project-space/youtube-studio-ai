/**
 * Run freshness is deliberately based on the time the run was created, not on
 * the Doctor's reporting window. A run can remain active for longer than that
 * window when a worker dies, and must still be visible to triage.
 */
export const STALE_RUN_AFTER_MS = 3 * 60 * 60 * 1000;

export type PipelineRunState = {
  status?: string;
  startedAt?: number;
  _creationTime?: number;
};

/** Use the explicit run timestamp, with Convex creation time for legacy rows. */
export function runCreatedAt(run: PipelineRunState): number {
  return run.startedAt ?? run._creationTime ?? 0;
}

export function isStaleActiveRun(run: PipelineRunState, now = Date.now()): boolean {
  return (
    (run.status === "queued" || run.status === "running") &&
    runCreatedAt(run) > 0 &&
    now - runCreatedAt(run) > STALE_RUN_AFTER_MS
  );
}

/**
 * A stale running task has already crossed the pipeline's 70-minute hard
 * duration and can be honestly failed. A queued record has no persisted
 * Trigger handle, so its dispatch state cannot be proven; it is triage-only
 * until an operator decides whether to clear it.
 */
export function staleRunAction(run: PipelineRunState): "fail-running" | "triage-queued" | null {
  if (run.status === "running") return "fail-running";
  if (run.status === "queued") return "triage-queued";
  return null;
}
