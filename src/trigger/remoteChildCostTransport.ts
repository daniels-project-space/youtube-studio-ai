import { createImageUsageScope } from "@/lib/imageUsage";
import { createModelUsageScope } from "@/lib/modelUsage";
import { COST_PATCH_KEY } from "@/engine/types";
import { remoteChildFailureWithEvidence, type RemoteChildCostSummary } from "@/lib/remoteChildCostEvidence";
import { createCheckpointCostScope, incrementalObservedFailureCostUsd, type CheckpointCostReceipt } from "@/lib/checkpointCostAccounting";

export interface RemoteChildCostTransport {
  begin(): Promise<unknown>;
  finish(result: { status: "succeeded" | "failed"; costUsd: number; complete: boolean; checkpointCostReceipts: CheckpointCostReceipt[] }): Promise<RemoteChildCostSummary>;
}

function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The same wrapper runs in both real remote tasks and transport integration tests. */
export async function executeRemoteCostTrackedBlock(args: {
  paid: boolean;
  priorCostUsd: number;
  checkpointCostReceipts: readonly CheckpointCostReceipt[];
  transport: RemoteChildCostTransport;
  execute: () => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  // A crashed worker leaves a started receipt, which fences the next attempt.
  await args.transport.begin();
  const models = createModelUsageScope();
  const images = createImageUsageScope();
  const checkpoints = createCheckpointCostScope(args.checkpointCostReceipts, args.priorCostUsd);
  let patch: Record<string, unknown>;
  try {
    patch = await checkpoints.run(() => models.run(() => images.run(args.execute)));
  } catch (error) {
    const reported = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const observed = amount(reported.observedCostUsd);
    const additional = amount(reported.additionalObservedCostUsd);
    const modelUsage = models.snapshot();
    const imageUsage = images.snapshot();
    const checkpoint = checkpoints.snapshot();
    const costUsd = Math.max(
      0,
      incrementalObservedFailureCostUsd(error, checkpoint.alreadyAccountedCostUsd),
      modelUsage.costUsd + imageUsage.costUsd,
      checkpoint.reportedReceiptCostUsd - checkpoint.alreadyAccountedCostUsd,
    ) + (additional ?? 0);
    const complete = (!args.paid || observed !== undefined) &&
      (reported.additionalObservedCostUsd === undefined || additional !== undefined) &&
      modelUsage.unpricedCalls === 0;
    let summary: RemoteChildCostSummary;
    try {
      summary = await args.transport.finish({ status: "failed", costUsd, complete, checkpointCostReceipts: checkpoint.receipts });
    } catch {
      throw remoteChildFailureWithEvidence("remote failure cost receipt could not be committed", {
        costUsd, complete: false, attempts: 1,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    const failure = remoteChildFailureWithEvidence(message, summary);
    // Retain provider classification without trusting it as numeric accounting.
    if (error && typeof error === "object") {
      for (const key of ["code", "status", "retryable", "retryScope"]) {
        if (key in error) Object.assign(failure, { [key]: reported[key] });
      }
    }
    if (!complete) Object.assign(failure, { retryable: false });
    throw failure;
  }
  const modelUsage = models.snapshot();
  const imageUsage = images.snapshot();
  const explicit = amount(patch[COST_PATCH_KEY]);
  const checkpoint = checkpoints.snapshot();
  const costUsd = Math.max(
    0,
    (explicit ?? 0) - checkpoint.alreadyAccountedCostUsd,
    modelUsage.costUsd + imageUsage.costUsd,
    checkpoint.reportedReceiptCostUsd - checkpoint.alreadyAccountedCostUsd,
  );
  const complete = (!args.paid || explicit !== undefined) &&
    (patch[COST_PATCH_KEY] === undefined || explicit !== undefined) &&
    modelUsage.unpricedCalls === 0;
  let summary: RemoteChildCostSummary;
  try {
    summary = await args.transport.finish({ status: "succeeded", costUsd, complete, checkpointCostReceipts: checkpoint.receipts });
  } catch {
    throw remoteChildFailureWithEvidence("completed remote work lacks a committed cost receipt", {
      costUsd, complete: false, attempts: 1,
    });
  }
  if (!summary.complete) throw remoteChildFailureWithEvidence("completed remote work has unpriced provider usage", summary);
  // Trigger retries belong to one child dispatch. Return its cumulative cost,
  // including any earlier fully accounted failed attempts, to the parent.
  return { ...patch, [COST_PATCH_KEY]: summary.costUsd };
}
