const LIVE_RUN_STATUSES = new Set(["queued", "running"]);

/**
 * A console should demand space only while it is changing or when the run
 * stopped in a state that needs diagnosis. Completed/cancelled records retain
 * their persisted counts in the header and open explicitly for review.
 */
export function isLiveRunStatus(status?: string): boolean {
  return status !== undefined && LIVE_RUN_STATUSES.has(status);
}

export function runConsoleStartsOpen(status?: string): boolean {
  if (isLiveRunStatus(status)) return true;
  return status === "failed" || Boolean(status?.includes("blocked"));
}

export function completedLogSummary({
  loading,
  lines,
  warnings,
  errors,
}: {
  loading: boolean;
  lines: number;
  warnings: number;
  errors: number;
}): string {
  if (loading) return "Reading receipt";
  const lineLabel = `${lines} ${lines === 1 ? "line" : "lines"}`;
  if (warnings === 0 && errors === 0) return `${lineLabel} · clean`;
  return `${lineLabel} · ${warnings}W · ${errors}E`;
}
