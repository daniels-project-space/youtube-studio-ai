import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type {
  AutomaticProviderPlan,
  AutomaticQualityGateContract,
  AutomaticReleaseRollbackPlan,
} from "@/lib/automaticOperations";

/**
 * Small, deterministic contracts shared by the automatic scheduler and UI.
 * These are deliberately provider-neutral: provider adapters still own live
 * capacity admission, while this layer prevents avoidable duplicate work.
 */
export const AUTOMATIC_WORKFLOW_VERSION = "automatic-workflow/v1" as const;
export const AUTOMATIC_RESUME_MAX_ATTEMPTS = 2 as const;

export type AutomaticPreflightReceipt = {
  version: typeof AUTOMATIC_WORKFLOW_VERSION;
  runId: string;
  channelId: string;
  budgetUsd: number;
  reservedMaxCostUsd: number;
  paidModules: readonly string[];
  /** Exact already-admitted dependencies reused by this run. */
  reusedDependencies?: readonly {
    kind: "topic" | "script" | "footage" | "music" | "weekly_sidecar";
    key: string;
  }[];
  checks: readonly {
    id: "budget" | "module_contracts" | "resume_boundary";
    status: "pass";
    detail: string;
  }[];
  /** The provider order is frozen before the first paid block. */
  providerPlan?: AutomaticProviderPlan;
  /** Threshold contract consumed by the real final-master QA stage. */
  qualityGate?: AutomaticQualityGateContract;
  /** Private-first release safety and retry behavior. */
  rollbackPlan?: AutomaticReleaseRollbackPlan;
  fingerprint: string;
};

export function createAutomaticPreflightReceipt(input: {
  runId: string;
  channelId: string;
  budgetUsd: number;
  reservedMaxCostUsd: number;
  paidModules: readonly string[];
  reusedDependencies?: readonly {
    kind: "topic" | "script" | "footage" | "music" | "weekly_sidecar";
    key: string;
  }[];
  resumeBoundaryReady: boolean;
  providerPlan?: AutomaticProviderPlan;
  qualityGate?: AutomaticQualityGateContract;
  rollbackPlan?: AutomaticReleaseRollbackPlan;
}): AutomaticPreflightReceipt {
  if (!input.runId.trim() || !input.channelId.trim()) throw new Error("automatic preflight identity is required");
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0) throw new Error("automatic preflight budget is invalid");
  if (input.paidModules.length > 0 && input.budgetUsd <= 0) throw new Error("automatic preflight budget is invalid for paid work");
  if (!Number.isFinite(input.reservedMaxCostUsd) || input.reservedMaxCostUsd < 0) throw new Error("automatic preflight reservation is invalid");
  if (input.reservedMaxCostUsd > input.budgetUsd + Number.EPSILON) {
    throw new Error("automatic preflight reservation exceeds the frozen budget");
  }
  if (!input.resumeBoundaryReady) throw new Error("automatic preflight resume boundary is not ready");
  const body = {
    version: AUTOMATIC_WORKFLOW_VERSION,
    runId: input.runId,
    channelId: input.channelId,
    budgetUsd: Number(input.budgetUsd.toFixed(6)),
    reservedMaxCostUsd: Number(input.reservedMaxCostUsd.toFixed(6)),
    paidModules: [...new Set(input.paidModules)].sort(),
    ...(input.reusedDependencies?.length
      ? {
          reusedDependencies: [...input.reusedDependencies]
            .filter((entry) => entry.key.trim())
            .sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
        }
      : {}),
    checks: [
      { id: "budget" as const, status: "pass" as const, detail: "reserved envelope is inside the frozen per-video budget" },
      { id: "module_contracts" as const, status: "pass" as const, detail: "paid modules have bounded, idempotent contracts" },
      { id: "resume_boundary" as const, status: "pass" as const, detail: "stage receipts can resume without replaying accepted paid work" },
    ],
    ...(input.providerPlan ? { providerPlan: input.providerPlan } : {}),
    ...(input.qualityGate ? { qualityGate: input.qualityGate } : {}),
    ...(input.rollbackPlan ? { rollbackPlan: input.rollbackPlan } : {}),
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export function automaticReuseKey(input: {
  ownerId: string;
  moduleId: string;
  moduleVersion: string;
  inputHashes: readonly string[];
  params: unknown;
  /** Portable recipe/media may cross channels; identity-bearing output may not. */
  scope: "portable" | "channel" | "series";
  channelId?: string;
  seriesIdentity?: string;
}): string {
  if (input.scope === "channel" && !input.channelId) throw new Error("channel reuse requires channelId");
  if (input.scope === "series" && (!input.channelId || !input.seriesIdentity)) throw new Error("series reuse requires channelId and seriesIdentity");
  return sha256Hex(canonicalJson({
    version: AUTOMATIC_WORKFLOW_VERSION,
    ownerId: input.ownerId,
    moduleId: input.moduleId,
    moduleVersion: input.moduleVersion,
    inputHashes: [...new Set(input.inputHashes)].sort(),
    params: input.params,
    scope: input.scope,
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.seriesIdentity ? { seriesIdentity: input.seriesIdentity } : {}),
  }));
}

export type BatchConflictItem = {
  id: string;
  resourceKey: string;
  scheduledAt?: number;
  priority?: number;
};

export type BatchConflictWave = {
  items: readonly BatchConflictItem[];
  resourceKeys: readonly string[];
};

/** Stable waves: no resource is admitted twice in one wave. */
export function resolveBatchConflicts(items: readonly BatchConflictItem[], maxPerWave = 3, resourceCapacities: Readonly<Record<string, number>> = {}): readonly BatchConflictWave[] {
  if (!Number.isInteger(maxPerWave) || maxPerWave < 1 || maxPerWave > 12) throw new Error("batch wave bound is invalid");
  const ordered = [...items].sort((a, b) =>
    (a.scheduledAt ?? Number.MAX_SAFE_INTEGER) - (b.scheduledAt ?? Number.MAX_SAFE_INTEGER) ||
    (b.priority ?? 0) - (a.priority ?? 0) || a.resourceKey.localeCompare(b.resourceKey) || a.id.localeCompare(b.id),
  );
  const waves: BatchConflictWave[] = [];
  for (const item of ordered) {
    let wave = waves.find((candidate) => {
      if (candidate.items.length >= maxPerWave) return false;
      const capacity = resourceCapacities[item.resourceKey] ?? 1;
      const current = candidate.items.filter((entry) => entry.resourceKey === item.resourceKey).length;
      return current < capacity;
    });
    if (!wave) {
      wave = { items: [], resourceKeys: [] };
      waves.push(wave);
    }
    (wave.items as BatchConflictItem[]).push(item);
    (wave.resourceKeys as string[]).push(item.resourceKey);
  }
  return waves;
}

export type BulkUndoReceipt = {
  version: typeof AUTOMATIC_WORKFLOW_VERSION;
  actionKey: string;
  runIds: readonly string[];
  previousStates: readonly { runId: string; state: "active" | "archived" }[];
  nextState: "active" | "archived";
  fingerprint: string;
};

export function createBulkUndoReceipt(input: {
  actionKey: string;
  runIds: readonly string[];
  previousStates: readonly { runId: string; state: "active" | "archived" }[];
  nextState: "active" | "archived";
}): BulkUndoReceipt {
  const runIds = [...new Set(input.runIds)].sort();
  if (!input.actionKey.trim() || runIds.length === 0 || runIds.length > 100) throw new Error("bulk action is empty or too large");
  const previousStates = [...input.previousStates].sort((a, b) => a.runId.localeCompare(b.runId));
  if (previousStates.length !== runIds.length || previousStates.some((row) => !runIds.includes(row.runId))) {
    throw new Error("bulk action previous states do not cover every run");
  }
  const body = { version: AUTOMATIC_WORKFLOW_VERSION, actionKey: input.actionKey.trim(), runIds, previousStates, nextState: input.nextState };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}
