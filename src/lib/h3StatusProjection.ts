export type H3ReceiptState = "pending" | "held" | "complete" | "reconciliation_required" | "repair_required";
export type H3RequestPacketState = "frozen" | "missing" | "invalid" | "not-applicable";

export function isTerminalH3RunStatus(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED"]
    .includes(status.toUpperCase());
}

export async function allLinkedH3RunsSettled(
  queriedRunId: string,
  linkedRuns: AsyncIterable<{ id: string; status: string }>,
): Promise<boolean> {
  let count = 0;
  let foundQueriedRun = false;
  for await (const linked of linkedRuns) {
    count += 1;
    if (count > 256) return false;
    if (linked.id === queriedRunId) foundQueriedRun = true;
    if (!isTerminalH3RunStatus(linked.status)) return false;
  }
  return foundQueriedRun;
}

/** The aggregate, packet, and shot claims must agree before reporting completion. */
export function projectH3ReceiptState(args: {
  triggerStatus: string;
  aggregateKind: "weekly" | "on-demand" | null;
  packetState: H3RequestPacketState;
  rejectedCount: number;
  linkedRunsSettled: boolean;
  capacityHold: boolean;
}): { state: H3ReceiptState; lineageConflict: boolean; paidRequestStarted?: false } {
  const terminal = isTerminalH3RunStatus(args.triggerStatus) &&
    (args.rejectedCount === 0 || args.linkedRunsSettled);
  const lineageConflict = args.aggregateKind !== null && args.rejectedCount > 0;
  if (lineageConflict) return { state: terminal ? "reconciliation_required" : "pending", lineageConflict };
  if (args.aggregateKind === "on-demand") return { state: "complete", lineageConflict: false };
  if (args.aggregateKind === "weekly" && args.packetState === "frozen") {
    return { state: "complete", lineageConflict: false };
  }
  if (args.rejectedCount > 0) {
    return { state: terminal ? "repair_required" : "pending", lineageConflict: false };
  }
  if (!terminal) return { state: "pending", lineageConflict: false };
  if (args.aggregateKind === null && args.packetState === "frozen" && args.capacityHold) {
    return { state: "held", lineageConflict: false, paidRequestStarted: false };
  }
  return { state: "reconciliation_required", lineageConflict: false };
}
