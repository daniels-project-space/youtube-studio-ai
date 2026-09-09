import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

type CostStage = {
  block: string;
  cost?: number;
};
type ScopedCostStage = CostStage & Pick<Doc<"runStages">, "ownerId" | "runId">;

function validCost(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`run cost accounting: ${label} must be finite and non-negative`);
  }
  return value;
}

/**
 * Stage costs already include their attempts, checkpoint receipts and healed
 * generations. Sum the canonical rows once, including failed/superseded rows;
 * neither equal prices nor a matching block name prove duplicate billing.
 */
export function knownRunCostFloor(
  existingCost: number,
  proposedCost: number | undefined,
  stages: readonly CostStage[],
): number {
  validCost(existingCost, "existing total");
  if (proposedCost !== undefined) validCost(proposedCost, "proposed total");
  const blocks = new Set<string>();
  let stageCost = 0;
  for (const stage of stages) {
    if (typeof stage.block !== "string" || !stage.block.trim() || stage.block !== stage.block.trim()) {
      throw new Error("run cost accounting: stage block identity is missing");
    }
    if (blocks.has(stage.block)) {
      throw new Error(`run cost accounting: duplicate stage block ${stage.block} requires reconciliation`);
    }
    blocks.add(stage.block);
    stageCost += validCost(stage.cost === undefined ? 0 : stage.cost, `stage ${stage.block} cost`);
    validCost(stageCost, "stage total");
  }
  // Preserve imported/non-stage costs and historical charges even when a
  // retained stage set is smaller. A progress write is never a refund.
  return Math.max(existingCost, proposedCost ?? 0, stageCost);
}

/** Called inside the existing fenced transaction, never a new worker RPC. */
export async function runCostFloor(
  ctx: Pick<QueryCtx, "db">,
  run: Pick<Doc<"runs">, "_id" | "ownerId" | "costTotal">,
  proposedCost?: number,
  preloadedStages?: readonly ScopedCostStage[],
): Promise<number> {
  const stages = preloadedStages ?? await ctx.db
    .query("runStages")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  if (stages.some((stage) => stage.ownerId !== run.ownerId || stage.runId !== run._id)) {
    throw new Error("run cost accounting: stage ownership/run mismatch");
  }
  return knownRunCostFloor(run.costTotal, proposedCost, stages);
}
