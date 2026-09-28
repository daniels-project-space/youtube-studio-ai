export type H3ReceiptState = "pending" | "held" | "complete" | "reconciliation_required" | "repair_required";
export type H3RequestPacketState = "frozen" | "missing" | "invalid" | "not-applicable";

export function isTerminalH3RunStatus(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED"]
    .includes(status.toUpperCase());
}

/** The aggregate, packet, and shot claims must agree before reporting completion. */
export function projectH3ReceiptState(args: {
  triggerStatus: string;
  aggregateKind: "weekly" | "on-demand" | null;
  packetState: H3RequestPacketState;
  rejectedCount: number;
  capacityHold: boolean;
}): { state: H3ReceiptState; lineageConflict: boolean; paidRequestStarted?: false } {
  const terminal = isTerminalH3RunStatus(args.triggerStatus);
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
