export type H3ProgressState = "pending" | "held" | "complete" | "reconciliation_required";

export interface H3ProgressSnapshot {
  state: H3ProgressState;
  triggerStatus: string;
  receipt: { completedCount: number; requestCount: number } | null;
}

/**
 * Project durable H3 receipt evidence into the compact progress bar used by
 * the render desk. Receipt counts are authoritative once present; transport
 * status is only a coarse fallback while the first receipt is being written.
 * A non-terminal run never reaches 100%, so a completed-looking bar cannot
 * hide reconciliation or a missing final receipt.
 */
export function h3ProgressPercent(snapshot: H3ProgressSnapshot): number {
  if (snapshot.state === "complete") return 100;
  if (snapshot.state === "held") return 8;
  if (snapshot.state === "reconciliation_required") return 92;

  const requestCount = snapshot.receipt?.requestCount;
  const completedCount = snapshot.receipt?.completedCount;
  if (
    typeof requestCount === "number" && Number.isSafeInteger(requestCount) && requestCount > 0 &&
    typeof completedCount === "number" && Number.isSafeInteger(completedCount) && completedCount >= 0
  ) {
    const ratio = Math.min(1, completedCount / requestCount);
    // Reserve the first 16% for queued/admission work and the final 8% for
    // receipt validation and R2 reconciliation.
    return Math.min(94, Math.max(16, Math.round(16 + ratio * 78)));
  }

  return /EXECUTING|RUNNING|IN_PROGRESS/i.test(snapshot.triggerStatus) ? 58 : 16;
}
