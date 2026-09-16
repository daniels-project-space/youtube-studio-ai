/** Pure, owner-scoped projection of an H3 receipt for the progress surface. */

export type MiniMaxH3ReceiptSummary = {
  kind: "weekly" | "on-demand";
  requestCount: number;
  completedCount: number;
  totalCostUsd: number;
  capacityMode?: "medium" | "high" | "mixed" | "spot";
};

/**
 * A weekly task checks all capacity before setting its provider-start marker.
 * Keep this classifier narrow: only those explicit admission/account-capacity
 * failures may be shown as held; every other terminal run needs reconciliation.
 */
export function isMiniMaxH3CapacityHoldError(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // The organization-wide Convex fence runs before the provider admission
  // wrapper.  A full logical fence therefore has its own stable error text;
  // keep it in the same explicit, no-spend hold class so the status and
  // retry routes do not mislabel it as an ambiguous provider failure.
  return /weekly MiniMax H3 Salad (?:account )?capacity (?:check )?(?:could not admit|is insufficient|failed|is occupied)/i.test(value) ||
    /^Salad fleet reservation capacity is occupied\b/i.test(value.trim());
}

function isOwnerScopedR2Key(value: unknown, ownerId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r2Key = (value as Record<string, unknown>).r2Key;
  return typeof r2Key === "string" && r2Key.startsWith(`owner/${ownerId}/`);
}

function weeklyCapacityMode(receipt: Record<string, unknown>, outputCount: number): MiniMaxH3ReceiptSummary["capacityMode"] {
  if (receipt.providerReceipts === undefined) return undefined;
  if (!Array.isArray(receipt.providerReceipts) || receipt.providerReceipts.length !== outputCount) {
    throw new Error("H3 weekly receipt provider provenance is malformed");
  }
  const modes = receipt.providerReceipts.map((providerReceipt) => {
    if (!providerReceipt || typeof providerReceipt !== "object" || Array.isArray(providerReceipt)) return null;
    const runtime = (providerReceipt as Record<string, unknown>).runtime;
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
    const mode = (runtime as Record<string, unknown>).capacityMode;
    return mode === "medium" || mode === "high" ? mode : null;
  });
  if (modes.some((mode) => mode === null)) {
    throw new Error("H3 weekly receipt provider capacity provenance is malformed");
  }
  return new Set(modes).size === 1 ? modes[0]! : "mixed";
}

export function summarizeMiniMaxH3Receipt(value: unknown, ownerId: string): MiniMaxH3ReceiptSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("H3 receipt is malformed");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schema === "minimax-h3-weekly-batch/v1") {
    const outputs = receipt.outputs;
    const requestKeys = receipt.requestKeys;
    const totalCostUsd = receipt.totalCostUsd;
    if (!Array.isArray(outputs) || !Array.isArray(requestKeys) || outputs.length !== requestKeys.length ||
        outputs.length < 1 || outputs.length > 60 || typeof totalCostUsd !== "number" ||
        !Number.isFinite(totalCostUsd) || totalCostUsd < 0 || outputs.some((output) =>
          !isOwnerScopedR2Key(output, ownerId))) {
      throw new Error("H3 weekly receipt is malformed");
    }
    const capacityMode = weeklyCapacityMode(receipt, outputs.length);
    return {
      kind: "weekly",
      requestCount: requestKeys.length,
      completedCount: outputs.length,
      totalCostUsd,
      ...(capacityMode ? { capacityMode } : {}),
    };
  }
  if (receipt.schema === "minimax-h3-on-demand/v1") {
    const output = receipt.output;
    if (!output || typeof output !== "object" || Array.isArray(output) ||
        typeof receipt.requestKey !== "string" || !receipt.requestKey ||
        !isOwnerScopedR2Key(output, ownerId) ||
        typeof (output as Record<string, unknown>).costUsd !== "number" ||
        !Number.isFinite((output as Record<string, unknown>).costUsd) ||
        Number((output as Record<string, unknown>).costUsd) < 0) {
      throw new Error("H3 on-demand receipt is malformed");
    }
    return {
      kind: "on-demand",
      requestCount: 1,
      completedCount: 1,
      totalCostUsd: Number((output as Record<string, unknown>).costUsd),
      capacityMode: "spot",
    };
  }
  throw new Error("H3 receipt schema is unsupported");
}
