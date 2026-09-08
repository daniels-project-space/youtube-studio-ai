import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { ExecutionError } from "@/engine/executionErrors";

/** A persisted paid execution, identified by its checkpoint's actual receipt. */
export interface CheckpointCostReceipt {
  id: string;
  costUsd: number;
}

const MAX_RECEIPTS = 256;
type Observer = (receipt: CheckpointCostReceipt, restored: boolean) => void;
const activeObserver = new AsyncLocalStorage<Observer>();

export function checkpointCostReceiptId(checkpointKey: string, chargeIdentity: string): string {
  if (!checkpointKey || !chargeIdentity) throw new Error("checkpoint cost receipt requires an exact identity");
  return createHash("sha256").update(JSON.stringify([checkpointKey, chargeIdentity])).digest("hex");
}

/** Accounting only: the adapter still owns its provider and checkpoint work. */
export function observeCheckpointCostReceipt(receipt: CheckpointCostReceipt, restored: boolean): void {
  activeObserver.getStore()?.(receipt, restored);
}

/** Provider failures default to fresh spend; only explicit cumulative quotes carry old receipts. */
export function incrementalObservedFailureCostUsd(error: unknown, alreadyAccountedCostUsd: number): number {
  const metadata = error as { observedCostUsd?: unknown; observedCostIncludesCheckpointReceipts?: unknown } | null;
  const cost = metadata && typeof metadata.observedCostUsd === "number" &&
    Number.isFinite(metadata.observedCostUsd) && metadata.observedCostUsd >= 0 ? metadata.observedCostUsd : 0;
  return metadata?.observedCostIncludesCheckpointReceipts === true
    ? Math.max(0, cost - alreadyAccountedCostUsd)
    : cost;
}

function receiptMap(receipts: readonly CheckpointCostReceipt[]): Map<string, CheckpointCostReceipt> {
  if (receipts.length > MAX_RECEIPTS) throw new Error("checkpoint cost receipt limit exceeded");
  const map = new Map<string, CheckpointCostReceipt>();
  for (const receipt of receipts) {
    if (!/^[a-f0-9]{64}$/.test(receipt.id) || !Number.isFinite(receipt.costUsd) || receipt.costUsd < 0) {
      throw new Error("invalid persisted checkpoint cost receipt");
    }
    const existing = map.get(receipt.id);
    if (existing && existing.costUsd !== receipt.costUsd) throw new Error("checkpoint cost receipt amount changed");
    map.set(receipt.id, { ...receipt });
  }
  return map;
}

export function createCheckpointCostScope(priorReceipts: readonly CheckpointCostReceipt[], priorCostUsd: number) {
  const prior = receiptMap(priorReceipts);
  const priorAttributed = [...prior.values()].reduce((sum, receipt) => sum + receipt.costUsd, 0);
  if (priorAttributed > priorCostUsd + 1e-9) throw new Error("checkpoint cost receipts exceed recorded stage spend");
  const current = new Map<string, CheckpointCostReceipt>();
  const observe: Observer = (receipt, restored) => {
    receiptMap([receipt]);
    const existing = current.get(receipt.id) ?? prior.get(receipt.id);
    if (existing && existing.costUsd !== receipt.costUsd) throw new Error("checkpoint cost receipt amount changed");
    // A legacy stage may already include this historical charge but lack its
    // identity. Equal dollars or equal inputs do not prove attribution.
    if (restored && !existing && receipt.costUsd > 0 && priorCostUsd - priorAttributed > 1e-9) {
      throw new ExecutionError(
        "PAID_STAGE_RECONCILIATION_REQUIRED: restored checkpoint has no recorded charge identity for prior stage spend; reconcile the existing receipt before replay",
        { code: "CHECKPOINT_COST_RECONCILIATION_REQUIRED", retryable: false },
      );
    }
    current.set(receipt.id, { ...receipt });
    if (new Set([...prior.keys(), ...current.keys()]).size > MAX_RECEIPTS) {
      throw new Error("checkpoint cost receipt limit exceeded");
    }
  };
  return {
    run<T>(fn: () => T): T { return activeObserver.run(observe, fn); },
    snapshot() {
      return {
        receipts: [...new Map([...prior, ...current]).values()],
        reportedReceiptCostUsd: [...current.values()].reduce((sum, receipt) => sum + receipt.costUsd, 0),
        alreadyAccountedCostUsd: [...current.values()].reduce(
          (sum, receipt) => sum + (prior.has(receipt.id) ? receipt.costUsd : 0), 0,
        ),
      };
    },
  };
}
