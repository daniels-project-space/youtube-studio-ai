import assert from "node:assert/strict";
import { NANO_BANANA_THUMBNAIL_PROFILE } from "@/lib/nanoBananaThumbnailContract";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";
import {
  PLAN_WEEK_RECOVERY_GUARD_VERSION,
  assertExactFailedPlanWeekRecoveryState,
  assertPlanWeekRecoveryRuntime,
  assertSameClaimedPlanWeekRecovery,
  type PlanWeekRecoveryExpectation,
  type PlanWeekRecoveryState,
} from "@/lib/planWeekRecoveryContract";

const recovery: PlanWeekRecoveryExpectation = {
  guardVersion: PLAN_WEEK_RECOVERY_GUARD_VERSION,
  batchId: "batch-exact",
  itemIds: ["item-a", "item-b", "item-c"],
  expectedActualCostUsd: 0.024551,
  contractVersion: PLAN_WEEK_CONTRACT_VERSION,
  providerRoute: NANO_BANANA_THUMBNAIL_PROFILE.route,
  taskVersion: "20260809.3",
};

function exactState(): PlanWeekRecoveryState {
  return {
    batch: {
      id: recovery.batchId,
      ownerId: "owner_daniel",
      channelId: "channel-quiet-stoic",
      requestKey: "run-original",
      contractVersion: recovery.contractVersion,
      requestedCount: 3,
      actualCostUsd: recovery.expectedActualCostUsd,
      status: "failed",
      topicState: "complete",
      accountingComplete: true,
      budgetExceeded: false,
      retryable: true,
      itemIds: [...recovery.itemIds],
      recoveryGuardVersion: null,
      recoveryTaskRunId: null,
      recoveryExpectedItemIds: [],
      recoveryExpectedActualCostUsd: null,
      recoveryExpectedProviderRoute: null,
      recoveryExpectedTaskVersion: null,
    },
    items: recovery.itemIds.map((id) => ({
      id,
      ownerId: "owner_daniel",
      channelId: "channel-quiet-stoic",
      batchId: recovery.batchId,
      status: "failed",
      generationState: "failed",
      generationAttempt: 3,
      generationRetryable: true,
      generationProviderStartedAt: null,
      thumbnailKey: null,
    })),
    renderReceiptCount: 0,
    renderReceiptOverflow: false,
    usageOverflow: false,
    usageTotalUsd: recovery.expectedActualCostUsd,
    usageAccountingComplete: true,
    itemUsageCostUsd: 0,
    itemUsageAccountingComplete: true,
  };
}

function assertExact(state: PlanWeekRecoveryState): void {
  assertExactFailedPlanWeekRecoveryState({
    recovery,
    ownerId: "owner_daniel",
    channelId: "channel-quiet-stoic",
    requestKey: "run-original",
    requestedCount: 3,
    state,
});
}

function main(): void {
  assertPlanWeekRecoveryRuntime({ recovery, runVersion: recovery.taskVersion });
  assertExact(exactState());

  assert.throws(
    () => assertPlanWeekRecoveryRuntime({ recovery, runVersion: "older-deployment" }),
    /does not match pinned deployment/,
  );

  const missing = exactState();
  missing.batch = null;
  assert.throws(() => assertExact(missing), /batch batch-exact is missing/);

  const extraItem = exactState();
  extraItem.batch!.itemIds = [...recovery.itemIds, "item-extra"];
  assert.throws(() => assertExact(extraItem), /item ids do not exactly match/);

  const reordered = exactState();
  reordered.batch!.itemIds = [recovery.itemIds[1], recovery.itemIds[0], recovery.itemIds[2]];
  assert.throws(() => assertExact(reordered), /item ids do not exactly match/);

  const changedCost = exactState();
  changedCost.batch!.actualCostUsd = 0.024552;
  assert.throws(() => assertExact(changedCost), /actual cost changed/);

  const paidItem = exactState();
  paidItem.items[0]!.generationProviderStartedAt = Date.now();
  assert.throws(() => assertExact(paidItem), /not failed\/retryable before provider spend/);

  const receiptExists = exactState();
  receiptExists.renderReceiptCount = 1;
  assert.throws(() => assertExact(receiptExists), /provider receipts already exist/);

  const thumbnailExists = exactState();
  thumbnailExists.items[1]!.thumbnailKey = "owner/x/channel/y/plan/item-b.jpg";
  assert.throws(() => assertExact(thumbnailExists), /not failed\/retryable before provider spend/);

  const claimed = exactState();
  claimed.batch!.recoveryGuardVersion = recovery.guardVersion;
  claimed.batch!.recoveryTaskRunId = "new-run";
  claimed.batch!.recoveryExpectedItemIds = [...recovery.itemIds];
  claimed.batch!.recoveryExpectedActualCostUsd = recovery.expectedActualCostUsd;
  claimed.batch!.recoveryExpectedProviderRoute = recovery.providerRoute;
  claimed.batch!.recoveryExpectedTaskVersion = recovery.taskVersion;
  assertSameClaimedPlanWeekRecovery({ recovery, taskRunId: "new-run", state: claimed });
  assert.throws(
    () => assertSameClaimedPlanWeekRecovery({ recovery, taskRunId: "other-run", state: claimed }),
    /different recovery run or contract/,
  );

  console.log("plan-week exact recovery contract tests passed");
}

main();
