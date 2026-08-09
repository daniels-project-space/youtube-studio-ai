import assert from "node:assert/strict";
import {
  claimPlanItem,
  claimPlanTopics,
  completePlanItem,
  deleteItem,
  failPlanItem,
  failPlanTopics,
  finalizePlanBatch,
  listProvenReadyPlan,
  listProvenReadyPlanPage,
  markPlanItemProviderStarted,
  markPlanTopicsProviderStarted,
  recordPlanBatchUsage,
  reservePlanBatch,
  savePlanTopics,
} from "../../../convex/contentPlan";
import { overview } from "../../../convex/analytics";
import {
  finalizeArtifactReceipt,
  recordProviderReceipt,
} from "../../../convex/planWeekRenderReceipts";
import {
  PLAN_WEEK_CONTRACT_VERSION,
  buildPlanWeekTopicCheckpoint,
  buildPlanWeekUsageCheckpoint,
  dedupePlanCandidates,
  planWeekReservation,
  parsePlanWeekTopicCheckpoint,
  topicsNearEquivalent,
} from "@/lib/planWeekBatch";
import { createModelUsageScope } from "@/lib/modelUsage";
import { createImageUsageScope, recordImageUsage } from "@/lib/imageUsage";
import {
  finalizedPlanWeekRenderReceiptFixture,
  planWeekProviderResultFixture,
} from "@/lib/__tests__/planWeekRenderReceiptFixture";
import { isFinalizedPlanWeekRenderReceipt } from "@/lib/planWeekRenderReceipt";
import { NANO_BANANA_THUMBNAIL_PROFILE } from "@/lib/nanoBananaThumbnailContract";
import { PLAN_WEEK_RECOVERY_GUARD_VERSION } from "@/lib/planWeekRecoveryContract";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private filters: Array<[string, unknown]> = [];
  private direction: "asc" | "desc" = "asc";

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(_name: string, build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown): this {
    const index = {
      eq: (field: string, value: unknown) => {
        this.filters.push([field, value]);
        return index;
      },
    };
    build(index);
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<Row[]> {
    const rows = this.db.rows(this.table).filter((row) =>
      this.filters.every(([field, value]) => row[field] === value),
    );
    return rows.sort((left, right) =>
      this.direction === "asc"
        ? left._creationTime - right._creationTime
        : right._creationTime - left._creationTime,
    );
  }

  async take(limit: number): Promise<Row[]> {
    return (await this.collect()).slice(0, limit);
  }

  async paginate(options: { numItems: number; cursor: string | null }): Promise<{
    page: Row[];
    continueCursor: string;
    isDone: boolean;
  }> {
    const rows = await this.collect();
    const start = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
    const end = Math.min(rows.length, start + options.numItems);
    return {
      page: rows.slice(start, end),
      continueCursor: String(end),
      isDone: end >= rows.length,
    };
  }

  async unique(): Promise<Row | null> {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error("fake unique query returned multiple rows");
    return rows[0] ?? null;
  }

  async first(): Promise<Row | null> {
    return (await this.collect())[0] ?? null;
  }
}

class MemoryDb {
  private readonly tables = new Map<string, Map<string, Row>>();
  private counter = 0;

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, value: Record<string, unknown>, id = `${table}:seed`): string {
    const rows = this.tables.get(table) ?? new Map<string, Row>();
    this.tables.set(table, rows);
    rows.set(id, { ...value, _id: id, _creationTime: ++this.counter });
    return id;
  }

  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) {
      const row = rows.get(id);
      if (row) return row;
    }
    return null;
  }

  normalizeId(table: string, id: string): string | null {
    return this.tables.get(table)?.has(id) ? id : null;
  }

  async insert(table: string, value: Record<string, unknown>): Promise<string> {
    const id = `${table}:${++this.counter}`;
    this.seed(table, value, id);
    return id;
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    Object.assign(row, patch);
  }

  async delete(id: string): Promise<void> {
    for (const rows of this.tables.values()) rows.delete(id);
  }

  query(table: string): MemoryQuery {
    return new MemoryQuery(this, table);
  }
}

function testContext(db: MemoryDb, ownerId = "owner-test", role: "owner" | "service" = "service") {
  return {
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: role === "service" ? "trigger-service" : ownerId,
        issuer: "https://studio.test",
        tokenIdentifier: `test|${ownerId}`,
        role,
        owner_id: ownerId,
      }),
    },
  };
}

interface InvokeResult {
  actualCostUsd: number;
  attempt: number;
  batchId: string;
  itemIds: string[];
  planningCost: number;
  retryable: boolean;
  state: string;
  status: string;
  totalCost: number;
}

async function invoke<Result = InvokeResult>(definition: unknown, ctx: unknown, args: unknown): Promise<Result> {
  const runtime = definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<Result>;
  };
  return runtime._handler(ctx, args);
}

async function main() {
  const ownerId = "owner-test";
  const channelId = "channels:test";
  const db = new MemoryDb();
  db.seed("channels", {
    ownerId,
    name: "Test Channel",
    slug: "test-channel",
    budget: 2,
    status: "active",
    identity: { niche: "finance" },
  }, channelId);
  const ctx = testContext(db, ownerId);
  const reservation = planWeekReservation(5);
  assert.equal(reservation.imageUnitUsd, 0.04);
  assert.equal(reservation.thumbnailConceptUsd, 0.05);
  assert.equal(reservation.thumbnailQaUsd, 0.015);
  assert.equal(reservation.thumbnailModelUsd, 0.08);
  const largeReservation = planWeekReservation(12);
  assert.equal(largeReservation.thumbnailConceptUsd, 0.12);
  assert.equal(largeReservation.thumbnailQaUsd, 0.036);
  assert.equal(largeReservation.thumbnailModelUsd, 0.156);
  assert.ok(reservation.totalUsd > 0 && reservation.totalUsd <= 2);

  const common = {
    ownerId,
    channelId,
    requestKey: "request-1",
    triggerRunId: "run-1",
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    requestedCount: 5,
    reservedCostUsd: reservation.totalUsd,
  };

  const bypassDb = new MemoryDb();
  bypassDb.seed("channels", {
    ownerId, name: "Bypass", slug: "bypass", budget: 2, status: "active",
  }, channelId);
  await assert.rejects(
    invoke(reservePlanBatch, testContext(bypassDb, ownerId, "owner"), common),
    /requires a studio service identity/,
  );
  await assert.rejects(
    invoke(reservePlanBatch, testContext(bypassDb, ownerId), {
      ...common, requestKey: "under-reserved", reservedCostUsd: 0.01,
    }),
    new RegExp(`below ${PLAN_WEEK_CONTRACT_VERSION} floor`),
  );
  await assert.rejects(
    invoke(reservePlanBatch, testContext(bypassDb, ownerId), {
      ...common, requestKey: "wrong-contract", contractVersion: "caller-chosen-price",
    }),
    /unsupported plan reservation contract/,
  );
  assert.equal(bypassDb.rows("planBatches").length, 0, "caller-supplied reservations cannot bypass admission");

  const exactRecoveryDb = new MemoryDb();
  exactRecoveryDb.seed("channels", {
    ownerId, name: "Exact recovery", slug: "exact-recovery", budget: 2, status: "active",
  }, channelId);
  const exactBatchId = "planBatches:exact-recovery";
  const exactItemIds = [
    "contentPlan:exact-a",
    "contentPlan:exact-b",
    "contentPlan:exact-c",
  ];
  const exactCostUsd = 0.024551;
  for (let index = 0; index < exactItemIds.length; index++) {
    exactRecoveryDb.seed("contentPlan", {
      ownerId,
      channelId,
      batchId: exactBatchId,
      itemKey: `exact-request:${index}`,
      order: index,
      topic: `Exact topic ${index + 1}`,
      status: "failed",
      generationState: "failed",
      generationAttempt: 3,
      generationRetryable: true,
      createdAt: 1_900_000_000_000 + index,
    }, exactItemIds[index]);
  }
  const exactReservation = planWeekReservation(exactItemIds.length);
  exactRecoveryDb.seed("planBatches", {
    ownerId,
    channelId,
    channelSlug: "exact-recovery",
    requestKey: "exact-request",
    triggerRunId: "original-failed-run",
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    requestedCount: exactItemIds.length,
    reservedCostUsd: exactReservation.totalUsd,
    actualCostUsd: exactCostUsd,
    status: "failed",
    topicState: "complete",
    topicAttempt: 1,
    itemIds: exactItemIds,
    accountingComplete: true,
    budgetExceeded: false,
    retryable: true,
    leaseExpiresAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }, exactBatchId);
  exactRecoveryDb.seed("planBatchUsage", {
    ownerId,
    channelId,
    batchId: exactBatchId,
    checkpointKey: "topics:1",
    fingerprint: "a".repeat(64),
    modelUsage: {},
    imageUsage: {},
    costUsd: exactCostUsd,
    accountingComplete: true,
    createdAt: 1,
  }, "planBatchUsage:exact-topics");
  const exactRecoveryArgs = {
    ownerId,
    channelId,
    requestKey: "exact-request",
    triggerRunId: "exact-recovery-run",
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    requestedCount: exactItemIds.length,
    reservedCostUsd: exactReservation.totalUsd,
    recovery: {
      guardVersion: PLAN_WEEK_RECOVERY_GUARD_VERSION,
      batchId: exactBatchId,
      itemIds: exactItemIds,
      expectedActualCostUsd: exactCostUsd,
      providerRoute: NANO_BANANA_THUMBNAIL_PROFILE.route,
      taskVersion: "20260809.3",
    },
  };
  const exactRecovered = await invoke(
    reservePlanBatch,
    testContext(exactRecoveryDb, ownerId),
    exactRecoveryArgs,
  );
  assert.equal(exactRecovered.batchId, exactBatchId);
  assert.equal(exactRecoveryDb.rows("planBatches").length, 1, "recovery must never create a second batch");
  assert.equal((await exactRecoveryDb.get(exactBatchId))?.recoveryTaskRunId, "exact-recovery-run");
  const sameRunReplay = await invoke(
    reservePlanBatch,
    testContext(exactRecoveryDb, ownerId),
    exactRecoveryArgs,
  );
  assert.equal(sameRunReplay.batchId, exactBatchId, "same Trigger run may resume its claimed recovery");
  await assert.rejects(
    invoke(reservePlanBatch, testContext(exactRecoveryDb, ownerId), {
      ...exactRecoveryArgs,
      triggerRunId: "different-recovery-run",
    }),
    /different recovery run or contract/,
  );

  const missingRecoveryDb = new MemoryDb();
  missingRecoveryDb.seed("channels", {
    ownerId, name: "Missing recovery", slug: "missing-recovery", budget: 2, status: "active",
  }, channelId);
  await assert.rejects(
    invoke(reservePlanBatch, testContext(missingRecoveryDb, ownerId), exactRecoveryArgs),
    /batch planBatches:exact-recovery is missing/,
  );
  assert.equal(missingRecoveryDb.rows("planBatches").length, 0, "missing recovery may not create a fresh batch");

  const admitted = await invoke(reservePlanBatch, ctx, common);
  const replay = await invoke(reservePlanBatch, ctx, common);
  assert.equal(replay.batchId, admitted.batchId, "same request must reuse one batch");
  assert.equal(db.rows("planBatches").length, 1, "replay must not duplicate reservation rows");
  await assert.rejects(
    invoke(reservePlanBatch, ctx, { ...common, requestedCount: 4 }),
    /different parameters/,
  );

  const lowBudgetDb = new MemoryDb();
  lowBudgetDb.seed("channels", { ownerId, name: "Low", slug: "low", budget: 0.1, status: "active" }, channelId);
  await assert.rejects(
    invoke(reservePlanBatch, testContext(lowBudgetDb, ownerId), common),
    /budget admission denied/,
  );
  assert.equal(lowBudgetDb.rows("planBatches").length, 0, "denied work must not reserve or spend");

  const activeGuardDb = new MemoryDb();
  activeGuardDb.seed("channels", {
    ownerId, name: "Active guard", slug: "active-guard", budget: 2, status: "active",
  }, channelId);
  const activeGuardCtx = testContext(activeGuardDb, ownerId);
  const retryableBatch = await invoke(reservePlanBatch, activeGuardCtx, {
    ...common, requestKey: "retryable-a",
  });
  const retryableClaim = await invoke(claimPlanTopics, activeGuardCtx, {
    ownerId, channelId, batchId: retryableBatch.batchId, claimant: "guard:1",
  });
  const guardUsage = buildPlanWeekUsageCheckpoint(
    createModelUsageScope().snapshot(),
    createImageUsageScope().snapshot(),
  );
  await invoke(recordPlanBatchUsage, activeGuardCtx, {
    ownerId, channelId, batchId: retryableBatch.batchId,
    checkpointKey: "topics:1", fingerprint: guardUsage.fingerprint,
    modelUsage: guardUsage.modelUsage, imageUsage: guardUsage.imageUsage,
    costUsd: guardUsage.costUsd, accountingComplete: guardUsage.accountingComplete,
  });
  await invoke(failPlanTopics, activeGuardCtx, {
    ownerId, channelId, batchId: retryableBatch.batchId, attempt: retryableClaim.attempt,
    usageCheckpointKey: "topics:1", error: "transient zero-cost failure", retryable: true,
  });
  await invoke(reservePlanBatch, activeGuardCtx, { ...common, requestKey: "active-b" });
  await assert.rejects(
    invoke(reservePlanBatch, activeGuardCtx, { ...common, requestKey: "retryable-a" }),
    /channel already has active batch active-b/,
  );

  const originalNow = Date.now;
  let now = 1_900_000_000_000;
  Date.now = () => now;
  try {
    const leaseDb = new MemoryDb();
    leaseDb.seed("channels", { ownerId, name: "Lease", slug: "lease", budget: 2, status: "active" }, channelId);
    const leaseCtx = testContext(leaseDb, ownerId);
    const leaseBatch = await invoke(reservePlanBatch, leaseCtx, { ...common, requestKey: "lease-request" });
    const firstClaim = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:1",
    });
    assert.equal(firstClaim.state, "claimed");
    const liveClaim = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:2",
    });
    assert.equal(liveClaim.state, "busy", "a live claim must not duplicate provider work");
    now += 2 * 60 * 60 * 1_000 + 1;
    const expiredReplay = await invoke(reservePlanBatch, leaseCtx, { ...common, requestKey: "lease-request" });
    assert.equal(expiredReplay.retryable, true);
    const reclaimed = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:2",
    });
    assert.equal(reclaimed.state, "claimed");
    assert.equal(reclaimed.attempt, 2, "an expired pre-spend claim must be fenced by a new attempt");
    await invoke(markPlanTopicsProviderStarted, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, attempt: reclaimed.attempt, claimant: "run:2",
    });
    const livePaidClaim = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:3",
    });
    assert.equal(livePaidClaim.state, "busy");
    assert.equal(livePaidClaim.attempt, reclaimed.attempt);
    now += 2 * 60 * 60 * 1_000 + 1;
    const paidExpiredClaim = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:3",
    });
    assert.equal(paidExpiredClaim.state, "recovery_only");
    assert.equal(paidExpiredClaim.attempt, reclaimed.attempt,
      "an expired post-start claim must never open a new paid attempt");
    assert.equal((await leaseDb.get(leaseBatch.batchId))?.topicAttempt, 2);
    await assert.rejects(
      invoke(savePlanTopics, leaseCtx, {
        ownerId, channelId, batchId: leaseBatch.batchId, attempt: firstClaim.attempt,
        usageCheckpointKey: "topics:1", fingerprint: "0".repeat(64),
        modelUsage: {}, imageUsage: {}, costUsd: 0, accountingComplete: true,
        items: [{ topic: "Stale topic", title: "Stale topic", description: "Must not commit." }],
      }),
      /stale plan topic completion attempt/,
    );
    await assert.rejects(
      invoke(failPlanTopics, leaseCtx, {
        ownerId, channelId, batchId: leaseBatch.batchId, attempt: firstClaim.attempt,
        usageCheckpointKey: "topics:1", error: "stale attempt", retryable: false,
      }),
      /stale plan topic failure attempt/,
    );
    const postStartFailureUsage = buildPlanWeekUsageCheckpoint(
      createModelUsageScope().snapshot(),
      createImageUsageScope().snapshot(),
    );
    await invoke(recordPlanBatchUsage, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId,
      checkpointKey: "topics:2", fingerprint: postStartFailureUsage.fingerprint,
      modelUsage: postStartFailureUsage.modelUsage, imageUsage: postStartFailureUsage.imageUsage,
      costUsd: postStartFailureUsage.costUsd, accountingComplete: postStartFailureUsage.accountingComplete,
    });
    await invoke(failPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, attempt: reclaimed.attempt,
      usageCheckpointKey: "topics:2", error: "provider response was lost", retryable: true,
    });
    assert.equal((await leaseDb.get(leaseBatch.batchId))?.retryable, false,
      "provider-started topic failures cannot reopen paid work even with zero recorded cost");
    const failedPaidClaim = await invoke(claimPlanTopics, leaseCtx, {
      ownerId, channelId, batchId: leaseBatch.batchId, claimant: "run:4",
    });
    assert.equal(failedPaidClaim.state, "recovery_only");
    assert.equal(failedPaidClaim.attempt, reclaimed.attempt);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(topicsNearEquivalent(
    "How Compound Interest Builds Long-Term Wealth",
    "Building Long Term Wealth Through Compound Interest",
  ), true);
  const unique = dedupePlanCandidates(
    [
      { topic: "Building Long Term Wealth Through Compound Interest" },
      { topic: "Why Bond Duration Changes When Rates Rise" },
      { topic: "Bond Duration When Interest Rates Are Rising" },
    ],
    ["How Compound Interest Builds Long-Term Wealth"],
  );
  assert.deepEqual(unique.map((item) => item.topic), ["Why Bond Duration Changes When Rates Rise"]);

  const topicClaim = await invoke(claimPlanTopics, ctx, {
    ownerId, channelId, batchId: admitted.batchId, claimant: "run-1:1",
  });
  assert.equal(topicClaim.state, "claimed");
  const emptyModel = createModelUsageScope().snapshot();
  const emptyImage = createImageUsageScope().snapshot();
  const topicUsage = buildPlanWeekUsageCheckpoint(emptyModel, emptyImage);
  const saved = await invoke(savePlanTopics, ctx, {
    ownerId,
    channelId,
    batchId: admitted.batchId,
    attempt: topicClaim.attempt,
    usageCheckpointKey: "topics:1",
    fingerprint: topicUsage.fingerprint,
    modelUsage: topicUsage.modelUsage,
    imageUsage: topicUsage.imageUsage,
    costUsd: topicUsage.costUsd,
    accountingComplete: topicUsage.accountingComplete,
    items: [{
      topic: "Why Bond Duration Changes When Rates Rise",
      title: "Why Bond Duration Changes When Rates Rise",
      description: "A deterministic description.",
      sceneSeed: "A bond certificate bends as a rate dial rises.",
    }],
  });
  assert.equal(saved.state, "saved");
  const savedAgain = await invoke(savePlanTopics, ctx, {
    ownerId,
    channelId,
    batchId: admitted.batchId,
    attempt: topicClaim.attempt,
    usageCheckpointKey: "topics:1",
    fingerprint: topicUsage.fingerprint,
    modelUsage: topicUsage.modelUsage,
    imageUsage: topicUsage.imageUsage,
    costUsd: topicUsage.costUsd,
    accountingComplete: topicUsage.accountingComplete,
    items: [{ topic: "ignored replay", title: "ignored", description: "ignored" }],
  });
  assert.equal(savedAgain.itemIds[0], saved.itemIds[0]);
  assert.equal(db.rows("contentPlan").length, 1, "topic save replay must not duplicate plan rows");
  const durableTopics = buildPlanWeekTopicCheckpoint({
    batchId: admitted.batchId,
    attempt: topicClaim.attempt,
    usageCheckpointKey: "topics:1",
    items: [{
      topic: "Why Bond Duration Changes When Rates Rise",
      title: "Why Bond Duration Changes When Rates Rise",
      description: "A deterministic description.",
    }],
    usage: topicUsage,
  });
  assert.equal(parsePlanWeekTopicCheckpoint(durableTopics)?.artifactFingerprint, durableTopics.artifactFingerprint);
  assert.equal(parsePlanWeekTopicCheckpoint({ ...durableTopics, items: [{ ...durableTopics.items[0], topic: "tampered" }] }), null);
  const lostResponseResult = await invoke(failPlanTopics, ctx, {
    ownerId, channelId, batchId: admitted.batchId, attempt: topicClaim.attempt,
    usageCheckpointKey: "topics:1",
    error: "simulated lost HTTP response after committed save", retryable: false,
  });
  assert.equal(lostResponseResult.state, "complete");
  const afterLostResponse = await db.get(admitted.batchId);
  assert.equal(afterLostResponse?.topicState, "complete", "post-commit response loss must not undo saved topics");
  assert.equal(db.rows("contentPlan").length, 1);

  const itemId = saved.itemIds[0];
  const savedNow = Date.now;
  let itemNow = 1_910_000_000_000;
  Date.now = () => itemNow;
  const itemClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:1",
  });
  assert.equal(itemClaim.state, "claimed");
  const liveItemClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:2",
  });
  assert.equal(liveItemClaim.state, "busy");
  itemNow += 2 * 60 * 60 * 1_000 + 1;
  const expiredItemClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:2",
  });
  Date.now = savedNow;
  assert.equal(expiredItemClaim.state, "claimed");
  assert.equal(expiredItemClaim.attempt, 2, "expired item claim must be fenced by a new attempt");
  const zeroItemUsage = buildPlanWeekUsageCheckpoint(emptyModel, emptyImage);
  await invoke(recordPlanBatchUsage, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    checkpointKey: "thumbnail:item:1", fingerprint: zeroItemUsage.fingerprint,
    modelUsage: zeroItemUsage.modelUsage, imageUsage: zeroItemUsage.imageUsage,
    costUsd: zeroItemUsage.costUsd, accountingComplete: zeroItemUsage.accountingComplete,
  });
  await invoke(failPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, attempt: expiredItemClaim.attempt,
    usageCheckpointKey: "thumbnail:item:1", error: "HTTP 503", retryable: true,
  });
  const retryClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:2",
  });
  assert.equal(retryClaim.state, "claimed");
  assert.equal(retryClaim.attempt, 3);
  const paidCheckpointKey = `thumbnail:${itemId}:${retryClaim.attempt}`;
  await invoke(markPlanItemProviderStarted, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    attempt: retryClaim.attempt, claimant: "run-1:2",
  });

  const nonNanoImageScope = createImageUsageScope();
  await nonNanoImageScope.run(async () => {
    recordImageUsage({
      provider: "other", model: "unattested-image-model", route: "generic-image-route",
      images: 1, width: 1280, height: 720, costUsd: 0,
    });
  });
  const nonNanoUsage = buildPlanWeekUsageCheckpoint(emptyModel, nonNanoImageScope.snapshot());
  await invoke(recordPlanBatchUsage, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    checkpointKey: "thumbnail:item:unattested", fingerprint: nonNanoUsage.fingerprint,
    modelUsage: nonNanoUsage.modelUsage, imageUsage: nonNanoUsage.imageUsage,
    costUsd: nonNanoUsage.costUsd, accountingComplete: nonNanoUsage.accountingComplete,
  });
  await assert.rejects(
    invoke(completePlanItem, ctx, {
      ownerId, channelId, batchId: admitted.batchId, itemId, attempt: retryClaim.attempt,
      thumbnailKey: `owner/${ownerId}/channel/test-channel/plan/${itemId}.jpg`,
      usageCheckpointKey: "thumbnail:item:unattested",
    }),
    /finalized provider receipt is missing/,
  );

  const thumbnailKey = `owner/${ownerId}/channel/test-channel/plan/${itemId}.jpg`;
  const receiptScope = {
    ownerId,
    channelId,
    batchId: admitted.batchId,
    itemId,
    attempt: retryClaim.attempt,
    requestKey: common.requestKey,
    checkpointKey: paidCheckpointKey,
    destinationKey: thumbnailKey,
  };
  const imageScope = createImageUsageScope();
  const nanoProviderResult = planWeekProviderResultFixture(receiptScope);
  await imageScope.run(async () => {
    recordImageUsage({
      provider: nanoProviderResult.provider,
      model: nanoProviderResult.model,
      route: nanoProviderResult.route,
      images: 1,
      width: nanoProviderResult.width,
      height: nanoProviderResult.height,
      costUsd: nanoProviderResult.costUsd,
    });
  });
  const paidUsage = buildPlanWeekUsageCheckpoint(emptyModel, imageScope.snapshot());
  const firstLedger = await invoke(recordPlanBatchUsage, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    checkpointKey: paidCheckpointKey, fingerprint: paidUsage.fingerprint,
    modelUsage: paidUsage.modelUsage, imageUsage: paidUsage.imageUsage,
    costUsd: paidUsage.costUsd, accountingComplete: paidUsage.accountingComplete,
  });
  const replayLedger = await invoke(recordPlanBatchUsage, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    checkpointKey: paidCheckpointKey, fingerprint: paidUsage.fingerprint,
    modelUsage: paidUsage.modelUsage, imageUsage: paidUsage.imageUsage,
    costUsd: paidUsage.costUsd, accountingComplete: paidUsage.accountingComplete,
  });
  assert.equal(replayLedger.actualCostUsd, firstLedger.actualCostUsd, "usage replay must not double count cost");

  // Simulate the thumbnail reaching R2 with its exact attempt-3 checkpoint,
  // followed by a lost Convex completion response and lease expiry. Provider
  // spend has started, so the same attempt is recovery-only and can never buy
  // attempt 4.
  const realNow = Date.now;
  const responseLossAt = realNow();
  Date.now = () => responseLossAt + 2 * 60 * 60 * 1_000 + 1;
  const responseLossClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:3",
  });
  Date.now = realNow;
  assert.equal(responseLossClaim.state, "recovery_only");
  assert.equal(responseLossClaim.attempt, retryClaim.attempt);
  assert.equal((await db.get(itemId))?.generationAttempt, 3,
    "post-start lease expiry must not increment the paid thumbnail attempt");
  const recoveredLedger = await invoke(recordPlanBatchUsage, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    checkpointKey: paidCheckpointKey, fingerprint: paidUsage.fingerprint,
    modelUsage: paidUsage.modelUsage, imageUsage: paidUsage.imageUsage,
    costUsd: paidUsage.costUsd, accountingComplete: paidUsage.accountingComplete,
  });
  assert.equal(recoveredLedger.actualCostUsd, firstLedger.actualCostUsd);
  await invoke(failPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId,
    attempt: responseLossClaim.attempt, usageCheckpointKey: paidCheckpointKey,
    error: "ambiguous R2 upload response", retryable: false,
  });
  const recoveryOnly = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, claimant: "run-1:4",
  });
  assert.equal(recoveryOnly.state, "recovery_only");
  assert.equal(recoveryOnly.attempt, responseLossClaim.attempt);
  await assert.rejects(
    invoke(completePlanItem, ctx, {
      ownerId, channelId, batchId: admitted.batchId, itemId, attempt: recoveryOnly.attempt,
      thumbnailKey: "", usageCheckpointKey: paidCheckpointKey,
    }),
    /cannot be ready without a thumbnail/,
  );
  await assert.rejects(
    invoke(completePlanItem, ctx, {
      ownerId, channelId, batchId: admitted.batchId, itemId, attempt: recoveryOnly.attempt,
      thumbnailKey: "owner/wrong/channel/wrong/plan/item.jpg", usageCheckpointKey: paidCheckpointKey,
    }),
    /does not match its admitted artifact path|no matching finalized provider and artifact receipt/,
  );
  const receiptCreatedAt = Date.now();
  const finalizedRender = finalizedPlanWeekRenderReceiptFixture({
    ownerId,
    channelId,
    batchId: admitted.batchId,
    itemId,
    attempt: recoveryOnly.attempt,
    requestKey: common.requestKey,
    checkpointKey: paidCheckpointKey,
    destinationKey: thumbnailKey,
  }, receiptCreatedAt);
  const wrongDestinationRender = finalizedPlanWeekRenderReceiptFixture({
    ownerId,
    channelId,
    batchId: admitted.batchId,
    itemId,
    attempt: recoveryOnly.attempt,
    requestKey: common.requestKey,
    checkpointKey: paidCheckpointKey,
    destinationKey: `owner/${ownerId}/channel/wrong/plan/${itemId}.jpg`,
  }, receiptCreatedAt);
  await assert.rejects(invoke(recordProviderReceipt, ctx, {
    ownerId,
    channelId,
    batchId: admitted.batchId,
    itemId,
    requestKey: common.requestKey,
    checkpointKey: paidCheckpointKey,
    providerReceipt: wrongDestinationRender.providerReceipt,
  }), /invalid or unbound plan-week provider receipt/);
  assert.equal(db.rows("planWeekRenderReceipts").length, 0,
    "a wrong destination must not permanently poison the immutable checkpoint");
  const recordedRender = await invoke<{ receiptId: string; reused: boolean }>(
    recordProviderReceipt,
    ctx,
    {
      ownerId,
      channelId,
      batchId: admitted.batchId,
      itemId,
      requestKey: common.requestKey,
      checkpointKey: paidCheckpointKey,
      providerReceipt: finalizedRender.providerReceipt,
    },
  );
  await invoke(finalizeArtifactReceipt, ctx, {
    ownerId,
    channelId,
    batchId: admitted.batchId,
    itemId,
    requestKey: common.requestKey,
    checkpointKey: paidCheckpointKey,
    artifactReceipt: finalizedRender.artifactReceipt,
  });
  const storedRender = await db.get(recordedRender.receiptId);
  assert.equal(isFinalizedPlanWeekRenderReceipt(storedRender), true);
  assert.equal(finalizedRender.providerReceipt.model, nanoProviderResult.model);
  assert.equal(finalizedRender.providerReceipt.modelVersion, nanoProviderResult.modelVersion);
  assert.deepEqual(paidUsage.imageUsage.records, [{
    provider: "gemini",
    model: finalizedRender.providerReceipt.model,
    route: "nano-banana-flash",
    images: 1,
    width: finalizedRender.providerReceipt.width,
    height: finalizedRender.providerReceipt.height,
    costUsd: finalizedRender.providerReceipt.costUsd,
  }]);
  await invoke(completePlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId, itemId, attempt: recoveryOnly.attempt,
    thumbnailKey,
    usageCheckpointKey: paidCheckpointKey,
  });
  const final = await invoke(finalizePlanBatch, ctx, { ownerId, channelId, batchId: admitted.batchId });
  assert.equal(final.status, "ready");
  assert.equal(final.actualCostUsd, finalizedRender.providerReceipt.costUsd);
  for (let index = 0; index < 30; index++) {
    db.seed("contentPlan", {
      ownerId,
      channelId,
      order: 99 + index,
      topic: `Legacy row ${index} without an admitted batch`,
      status: "ready",
      thumbnailKey: `legacy/forged-${index}.jpg`,
      createdAt: Date.now(),
    }, `contentPlan:legacy-forged-${index}`);
  }
  for (let index = 0; index < 30; index++) {
    db.seed("planBatches", {
      ownerId,
      channelId,
      channelSlug: "test-channel",
      requestKey: `invalid-ready-${index}`,
      contractVersion: "legacy-unattested-contract",
      status: "ready",
      topicState: "complete",
      itemIds: [`contentPlan:legacy-forged-${index}`],
      accountingComplete: true,
      budgetExceeded: false,
      actualCostUsd: 0,
      reservedCostUsd: 0,
      createdAt: Date.now() + index,
    }, `planBatches:invalid-ready-${index}`);
  }
  const proven = await invoke<Row[]>(listProvenReadyPlan, ctx, { ownerId, channelId });
  assert.deepEqual(proven.map((row) => row._id), [itemId],
    "more than 24 newer invalid batches cannot crowd out an older proven row");
  let provenCursor: string | null = null;
  let provenDone = false;
  let provenPages = 0;
  const pagedProven: Row[] = [];
  while (!provenDone) {
    const pageResult: {
      page: Row[];
      continueCursor: string;
      isDone: boolean;
    } = await invoke(listProvenReadyPlanPage, ctx, {
      ownerId,
      channelId,
      paginationOpts: { numItems: 8, cursor: provenCursor },
    });
    pagedProven.push(...pageResult.page);
    provenCursor = pageResult.continueCursor;
    provenDone = pageResult.isDone;
    provenPages += 1;
  }
  assert.ok(provenPages > 3, "the readiness projection must advance beyond the old 24-row window");
  assert.deepEqual(pagedProven.map((row) => row._id), [itemId]);
  await assert.rejects(
    invoke<Row[]>(listProvenReadyPlan, testContext(db, ownerId, "owner"), { ownerId, channelId }),
    /requires a studio service identity/,
  );

  await assert.rejects(
    invoke(recordPlanBatchUsage, ctx, {
      ownerId, channelId, batchId: admitted.batchId,
      checkpointKey: "spoofed-accounting", fingerprint: "bad",
      modelUsage: { ...emptyModel, unpricedCalls: 1 }, imageUsage: emptyImage,
      costUsd: 0, accountingComplete: true,
    }),
    /accountingComplete does not match/,
  );
  await assert.rejects(
    invoke(recordPlanBatchUsage, ctx, {
      ownerId, channelId, batchId: admitted.batchId,
      checkpointKey: "missing-accounting-evidence", fingerprint: "0".repeat(64),
      modelUsage: { costUsd: 0 }, imageUsage: emptyImage,
      costUsd: 0, accountingComplete: true,
    }),
    /accountingComplete does not match/,
  );
  await assert.rejects(
    invoke(recordPlanBatchUsage, ctx, {
      ownerId, channelId, batchId: admitted.batchId,
      checkpointKey: "forged-canonical-fingerprint", fingerprint: "0".repeat(64),
      modelUsage: emptyModel, imageUsage: emptyImage,
      costUsd: 0, accountingComplete: true,
    }),
    /fingerprint does not match its canonical evidence/,
  );

  db.seed("runs", { ownerId, channelId, status: "ok", costTotal: 0.5 }, "runs:test");
  const analytics = await invoke(overview, ctx, { ownerId });
  assert.equal(analytics.planningCost, finalizedRender.providerReceipt.costUsd);
  assert.equal(
    analytics.totalCost,
    0.5 + finalizedRender.providerReceipt.costUsd,
    "analytics must include planner spend exactly once",
  );

  // Simulate provider output durably checkpointed, then a Convex network
  // failure before topic rows were saved. Restoring the exact R2 payload writes
  // rows without another model call and preserves its prior cost checkpoint.
  const recoveryDb = new MemoryDb();
  recoveryDb.seed("channels", { ownerId, name: "Recovery", slug: "recovery", budget: 2, status: "active" }, channelId);
  const recoveryCtx = testContext(recoveryDb, ownerId);
  const recoveryBatch = await invoke(reservePlanBatch, recoveryCtx, { ...common, requestKey: "recovery-request" });
  const recoveryClaim = await invoke(claimPlanTopics, recoveryCtx, {
    ownerId, channelId, batchId: recoveryBatch.batchId, claimant: "recovery:1",
  });
  const paidTopicUsage = buildPlanWeekUsageCheckpoint(
    { ...emptyModel, calls: 1, totalTokens: 100, inputTokens: 80, outputTokens: 20, costUsd: 0.02 },
    emptyImage,
  );
  const recoveryArtifact = buildPlanWeekTopicCheckpoint({
    batchId: recoveryBatch.batchId,
    attempt: recoveryClaim.attempt,
    usageCheckpointKey: "topics:1",
    items: [{ topic: "Recovered Topic", title: "Recovered Topic", description: "Recovered exactly once." }],
    usage: paidTopicUsage,
  });
  await invoke(recordPlanBatchUsage, recoveryCtx, {
    ownerId, channelId, batchId: recoveryBatch.batchId,
    checkpointKey: "topics:1", fingerprint: paidTopicUsage.fingerprint,
    modelUsage: paidTopicUsage.modelUsage, imageUsage: paidTopicUsage.imageUsage,
    costUsd: paidTopicUsage.costUsd, accountingComplete: paidTopicUsage.accountingComplete,
  });
  await invoke(failPlanTopics, recoveryCtx, {
    ownerId, channelId, batchId: recoveryBatch.batchId, attempt: recoveryClaim.attempt,
    usageCheckpointKey: "topics:1",
    error: "Convex unavailable after provider response", retryable: false,
  });
  const restored = await invoke(savePlanTopics, recoveryCtx, {
    ownerId, channelId, batchId: recoveryBatch.batchId,
    attempt: recoveryArtifact.attempt,
    usageCheckpointKey: recoveryArtifact.usageCheckpointKey,
    fingerprint: recoveryArtifact.usage.fingerprint,
    modelUsage: recoveryArtifact.usage.modelUsage,
    imageUsage: recoveryArtifact.usage.imageUsage,
    costUsd: recoveryArtifact.usage.costUsd,
    accountingComplete: recoveryArtifact.usage.accountingComplete,
    items: recoveryArtifact.items,
  });
  assert.equal(restored.state, "saved");
  assert.equal(recoveryDb.rows("contentPlan").length, 1);
  assert.equal((await recoveryDb.get(recoveryBatch.batchId))?.actualCostUsd, 0.02);

  await invoke(deleteItem, ctx, { id: itemId });
  assert.equal((await db.get(admitted.batchId))?.status, "failed");
  assert.equal((await db.get(admitted.batchId))?.retryable, false);
  const afterDelete = await invoke(finalizePlanBatch, ctx, {
    ownerId, channelId, batchId: admitted.batchId,
  });
  assert.equal(afterDelete.status, "failed");
  assert.equal(afterDelete.retryable, false);
  const terminalPendingId = db.seed("contentPlan", {
    ownerId, channelId, batchId: admitted.batchId, itemKey: "terminal-pending",
    order: 99, topic: "Must not spend", status: "generating",
    generationState: "pending", generationAttempt: 0, generationRetryable: true,
    createdAt: Date.now(),
  }, "contentPlan:terminal-pending");
  const terminalClaim = await invoke(claimPlanItem, ctx, {
    ownerId, channelId, batchId: admitted.batchId,
    itemId: terminalPendingId, claimant: "must-not-run",
  });
  assert.equal(terminalClaim.state, "blocked", "terminal batches cannot purchase later thumbnails");

  console.log("PLAN WEEK BATCH PASS: admission, idempotency, leases, failure recovery, exact accounting, and ready gate");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
