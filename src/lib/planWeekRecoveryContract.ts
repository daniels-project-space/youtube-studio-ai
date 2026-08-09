import { NANO_BANANA_THUMBNAIL_PROFILE } from "@/lib/nanoBananaThumbnailContract";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";

/**
 * Explicit release fence for one-off recovery dispatches. A deployment that
 * predates this contract cannot satisfy the recovery preflight task.
 */
export const PLAN_WEEK_RECOVERY_GUARD_VERSION = "plan-week-exact-recovery/v1" as const;

export interface PlanWeekRecoveryExpectation {
  guardVersion: typeof PLAN_WEEK_RECOVERY_GUARD_VERSION;
  batchId: string;
  itemIds: string[];
  expectedActualCostUsd: number;
  contractVersion: typeof PLAN_WEEK_CONTRACT_VERSION;
  providerRoute: typeof NANO_BANANA_THUMBNAIL_PROFILE.route;
  taskVersion: string;
}
export interface PlanWeekRecoveryState {
  batch: null | {
    id: string;
    ownerId: string;
    channelId: string;
    requestKey: string;
    contractVersion: string;
    requestedCount: number;
    actualCostUsd: number;
    status: string;
    topicState: string;
    accountingComplete: boolean;
    budgetExceeded: boolean;
    retryable: boolean;
    itemIds: string[];
    recoveryGuardVersion: string | null;
    recoveryTaskRunId: string | null;
    recoveryExpectedItemIds: string[];
    recoveryExpectedActualCostUsd: number | null;
    recoveryExpectedProviderRoute: string | null;
    recoveryExpectedTaskVersion: string | null;
  };
  items: Array<null | {
    id: string;
    ownerId: string;
    channelId: string;
    batchId: string | null;
    status: string;
    generationState: string | null;
    generationAttempt: number;
    generationRetryable: boolean;
    generationProviderStartedAt: number | null;
    thumbnailKey: string | null;
  }>;
  renderReceiptCount: number;
  renderReceiptOverflow: boolean;
  usageOverflow: boolean;
  usageTotalUsd: number;
  usageAccountingComplete: boolean;
  itemUsageCostUsd: number;
  itemUsageAccountingComplete: boolean;
}

function recoveryError(message: string): never {
  throw new Error(`plan-week recovery guard: ${message}`);
}

function sameOrderedIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

export function assertPlanWeekRecoveryExpectation(
  recovery: PlanWeekRecoveryExpectation,
): void {
  if (recovery.guardVersion !== PLAN_WEEK_RECOVERY_GUARD_VERSION) {
    recoveryError(`unsupported guard ${String(recovery.guardVersion)}`);
  }
  if (!recovery.batchId.trim()) recoveryError("batch id is required");
  if (
    recovery.itemIds.length < 1 ||
    recovery.itemIds.length > 12 ||
    recovery.itemIds.some((id) => !id.trim()) ||
    new Set(recovery.itemIds).size !== recovery.itemIds.length
  ) {
    recoveryError("item ids must be 1..12 unique non-empty ids");
  }
  if (!Number.isFinite(recovery.expectedActualCostUsd) || recovery.expectedActualCostUsd < 0) {
    recoveryError("expected actual cost must be finite and non-negative");
  }
  if (recovery.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
    recoveryError(`contract must be ${PLAN_WEEK_CONTRACT_VERSION}`);
  }
  if (recovery.providerRoute !== NANO_BANANA_THUMBNAIL_PROFILE.route) {
    recoveryError(`provider route must be ${NANO_BANANA_THUMBNAIL_PROFILE.route}`);
  }
  if (!recovery.taskVersion.trim()) recoveryError("deployed task version is required");
}

export function assertPlanWeekRecoveryRuntime(args: {
  recovery: PlanWeekRecoveryExpectation;
  runVersion: unknown;
}): void {
  assertPlanWeekRecoveryExpectation(args.recovery);
  if (typeof args.runVersion !== "string" || args.runVersion !== args.recovery.taskVersion) {
    recoveryError(
      `task version ${String(args.runVersion)} does not match pinned deployment ${args.recovery.taskVersion}`,
    );
  }
}

export function assertExactPlanWeekRecoveryIdentity(args: {
  recovery: PlanWeekRecoveryExpectation;
  ownerId: string;
  channelId: string;
  requestKey: string;
  requestedCount: number;
  state: PlanWeekRecoveryState;
}): void {
  const { recovery, state } = args;
  assertPlanWeekRecoveryExpectation(recovery);
  const batch = state.batch;
  if (!batch) recoveryError(`batch ${recovery.batchId} is missing`);
  if (batch.id !== recovery.batchId) recoveryError("loaded batch id changed");
  if (batch.ownerId !== args.ownerId || batch.channelId !== args.channelId) {
    recoveryError("batch owner/channel does not match the audited recovery");
  }
  if (batch.requestKey !== args.requestKey) recoveryError("batch request key changed");
  if (batch.contractVersion !== recovery.contractVersion) recoveryError("batch contract changed");
  if (batch.requestedCount !== args.requestedCount || args.requestedCount !== recovery.itemIds.length) {
    recoveryError("batch requested count does not match the exact item list");
  }
  if (!sameOrderedIds(batch.itemIds, recovery.itemIds)) {
    recoveryError("batch item ids do not exactly match the audited ordered list");
  }
  if (state.items.length !== recovery.itemIds.length) recoveryError("loaded item count changed");
  for (let index = 0; index < recovery.itemIds.length; index++) {
    const item = state.items[index];
    if (!item) recoveryError(`item ${recovery.itemIds[index]} is missing`);
    if (
      item.id !== recovery.itemIds[index] ||
      item.ownerId !== args.ownerId ||
      item.channelId !== args.channelId ||
      item.batchId !== recovery.batchId
    ) {
      recoveryError(`item ${recovery.itemIds[index]} identity changed`);
    }
  }
}

/**
 * Proves the original failed/pre-spend state. Convex runs this in the same
 * serializable mutation that claims the recovery, eliminating the query-to-
 * mutation race in the launcher.
 */
export function assertExactFailedPlanWeekRecoveryState(args: {
  recovery: PlanWeekRecoveryExpectation;
  ownerId: string;
  channelId: string;
  requestKey: string;
  requestedCount: number;
  state: PlanWeekRecoveryState;
}): void {
  assertExactPlanWeekRecoveryIdentity(args);
  const { recovery, state } = args;
  const batch = state.batch!;
  if (batch.status !== "failed" || !batch.retryable) {
    recoveryError("batch is not the audited failed/retryable batch");
  }
  if (batch.topicState !== "complete") recoveryError("batch topics are not complete");
  if (!batch.accountingComplete || batch.budgetExceeded) {
    recoveryError("batch accounting is incomplete or over budget");
  }
  if (Math.abs(batch.actualCostUsd - recovery.expectedActualCostUsd) > 0.000001) {
    recoveryError("batch actual cost changed");
  }
  if (
    state.usageOverflow ||
    !state.usageAccountingComplete ||
    Math.abs(state.usageTotalUsd - recovery.expectedActualCostUsd) > 0.000001
  ) {
    recoveryError("batch usage ledger does not exactly support the expected cost");
  }
  if (!state.itemUsageAccountingComplete || Math.abs(state.itemUsageCostUsd) > 0.000001) {
    recoveryError("thumbnail item usage contains unaccounted or paid work");
  }
  if (state.renderReceiptOverflow || state.renderReceiptCount !== 0) {
    recoveryError("thumbnail provider receipts already exist");
  }
  for (const item of state.items) {
    if (
      !item ||
      item.status !== "failed" ||
      item.generationState !== "failed" ||
      !item.generationRetryable ||
      item.generationProviderStartedAt !== null ||
      item.thumbnailKey !== null
    ) {
      recoveryError(`item ${item?.id ?? "missing"} is not failed/retryable before provider spend`);
    }
  }
}

export function assertSameClaimedPlanWeekRecovery(args: {
  recovery: PlanWeekRecoveryExpectation;
  taskRunId: string;
  state: PlanWeekRecoveryState;
}): void {
  const { recovery, state } = args;
  const batch = state.batch;
  if (!batch) recoveryError(`batch ${recovery.batchId} is missing`);
  if (
    batch.recoveryGuardVersion !== recovery.guardVersion ||
    batch.recoveryTaskRunId !== args.taskRunId ||
    !sameOrderedIds(batch.recoveryExpectedItemIds, recovery.itemIds) ||
    batch.recoveryExpectedActualCostUsd === null ||
    Math.abs(batch.recoveryExpectedActualCostUsd - recovery.expectedActualCostUsd) > 0.000001 ||
    batch.recoveryExpectedProviderRoute !== recovery.providerRoute ||
    batch.recoveryExpectedTaskVersion !== recovery.taskVersion
  ) {
    recoveryError("batch is claimed by a different recovery run or contract");
  }
}
