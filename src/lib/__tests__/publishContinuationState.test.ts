import assert from "node:assert/strict";
import {
  completeRun,
  listPendingPublishContinuations,
  markPublishContinuationQueued,
  PUBLISH_CONTINUATION_QUEUE_LEASE_MS,
  preparePublishContinuation,
  reapExpiredQueuedPublishContinuations,
  recordPublishContinuationEnqueueFailure,
} from "../../../convex/runs";
import { bindExactPublishIntent } from "../../../convex/publishContinuationState";
import type { Id } from "../../../convex/_generated/dataModel";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private readonly filters: Array<{
    field: string;
    value: unknown;
    comparison: "eq" | "gt" | "lte";
  }> = [];

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(_name: string, build: (range: unknown) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, value, comparison: "eq" });
        return range;
      },
      gt: (field: string, value: unknown) => {
        this.filters.push({ field, value, comparison: "gt" });
        return range;
      },
      lte: (field: string, value: unknown) => {
        this.filters.push({ field, value, comparison: "lte" });
        return range;
      },
    };
    build(range);
    return this;
  }

  async take(count: number): Promise<Row[]> {
    return this.db
      .rows(this.table)
      .filter((row) => this.filters.every(({ field, value, comparison }) => {
        if (comparison === "eq") return row[field] === value;
        const left = row[field] as number | undefined;
        const right = value as number | undefined;
        if (comparison === "gt" && right === undefined) return left !== undefined;
        if (left === undefined || right === undefined) return false;
        return comparison === "gt" ? left > right : left <= right;
      }))
      .slice(0, count);
  }
}

class MemoryDb {
  private readonly tables = new Map<string, Map<string, Row>>();
  private counter = 0;

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, value: Record<string, unknown>, id: string): void {
    const rows = this.tables.get(table) ?? new Map<string, Row>();
    this.tables.set(table, rows);
    rows.set(id, { ...value, _id: id, _creationTime: ++this.counter });
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

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  query(table: string): MemoryQuery {
    return new MemoryQuery(this, table);
  }
}

function context(db: MemoryDb) {
  return {
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: "trigger-service",
        issuer: "https://studio.test",
        tokenIdentifier: "test|owner-a",
        role: "service",
        owner_id: "owner-a",
      }),
    },
  };
}

async function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(ctx, args);
}

async function main(): Promise<void> {
  const db = new MemoryDb();
  const ctx = context(db);
  const ownerId = "owner-a";
  const channelId = "channels:a" as Id<"channels">;
  const runId = "runs:a" as Id<"runs">;
  const intentId = "publishIntents:a" as Id<"publishIntents">;
  const conflictingIntentId = "publishIntents:b" as Id<"publishIntents">;
  const recoveryRunId = "runs:queued-recovery" as Id<"runs">;
  const recoveryIntentId = "publishIntents:queued-recovery" as Id<"publishIntents">;
  const artifactId = `sha256:${"a".repeat(64)}`;
  const youtubeVideoId = "youtube-a";
  const pipelineFence = {
    leaseOwner: "pipeline-worker-a",
    executionLeaseToken: 1,
  };
  const resumedFence = {
    leaseOwner: "pipeline-worker-c",
    executionLeaseToken: 3,
  };
  const externalFailedRunHandoff = {
    externalUploadedFailedRunHandoff: "uploaded_failed_run" as const,
  };
  db.seed("channels", { ownerId }, channelId);
  db.seed("runs", {
    ownerId,
    channelId,
    status: "running",
    costTotal: 0,
    leaseOwner: pipelineFence.leaseOwner,
    executionAttempts: pipelineFence.executionLeaseToken,
    leaseExpiresAt: Date.now() + 60_000,
  }, runId);
  db.seed("publishIntents", {
    ownerId,
    channelId,
    runId,
    videoArtifactId: artifactId,
    status: "approved",
  }, intentId);

  await bindExactPublishIntent(ctx as never, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
  });
  assert.equal((await db.get(runId))?.blockedPublishIntentId, intentId);
  assert.equal((await db.get(runId))?.blockedPublishArtifactId, artifactId);

  db.seed("publishIntents", {
    ownerId,
    channelId,
    runId,
    videoArtifactId: `sha256:${"b".repeat(64)}`,
    status: "uploaded",
    youtubeVideoId: "youtube-b",
  }, conflictingIntentId);
  await assert.rejects(
    bindExactPublishIntent(ctx as never, {
      ownerId,
      channelId,
      runId,
      intentId: conflictingIntentId,
      artifactId: `sha256:${"b".repeat(64)}`,
    }),
    /different publish intent/,
  );

  await db.patch(intentId, { status: "uploaded", youtubeVideoId });

  // An external scheduler must never use its no-lease handoff to write into a
  // live pipeline generation.
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 190,
      ...externalFailedRunHandoff,
    }),
    /external uploaded handoff requires a terminal failed run/,
  );

  // The in-pipeline path remains protected by its exact execution generation.
  await invoke(preparePublishContinuation, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    preparedAt: 200,
    ...pipelineFence,
  });
  let run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "pending");
  assert.equal(run?.publishContinuationIntentId, intentId);
  assert.equal(run?.youtubeVideoId, youtubeVideoId);

  // A reaper-pending failed row is still owned by recovery; an external
  // uploaded-intent receipt cannot race it.
  await db.patch(runId, {
    status: "failed",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    leaseRecoveryPending: true,
  });
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 210,
      ...externalFailedRunHandoff,
    }),
    /external uploaded handoff requires a terminal failed run/,
  );

  // A failed status alone is insufficient if an execution lease has not been
  // fully retired yet.
  await db.patch(runId, {
    status: "failed",
    leaseOwner: "pipeline-worker-b",
    executionAttempts: 2,
    leaseExpiresAt: Date.now() + 60_000,
    leaseRecoveryPending: undefined,
  });
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 215,
      ...externalFailedRunHandoff,
    }),
    /external uploaded handoff requires a terminal failed run/,
  );

  // Nor may it touch a recovery that has already claimed a new live lease.
  await db.patch(runId, {
    status: "running",
    leaseOwner: "pipeline-worker-b",
    executionAttempts: 2,
    leaseExpiresAt: Date.now() + 60_000,
    leaseRecoveryPending: undefined,
  });
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 220,
      ...externalFailedRunHandoff,
    }),
    /external uploaded handoff requires a terminal failed run/,
  );

  // This models the real scheduler handoff: the upload succeeded, but the
  // original run is terminal before it could persist the continuation receipt.
  await db.patch(runId, {
    status: "failed",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    leaseRecoveryPending: undefined,
    youtubeVideoId: undefined,
    publishContinuationState: undefined,
    publishContinuationIntentId: undefined,
    publishContinuationArtifactId: undefined,
    publishContinuationVideoId: undefined,
    publishContinuationAttempts: undefined,
    publishContinuationUpdatedAt: undefined,
  });
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 230,
    }),
    /requires an execution lease fence/,
  );
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId,
      preparedAt: 235,
      ...pipelineFence,
      ...externalFailedRunHandoff,
    }),
    /external uploaded handoff cannot also provide an execution lease fence/,
  );
  await assert.rejects(
    invoke(preparePublishContinuation, ctx, {
      ownerId,
      channelId,
      runId,
      intentId,
      artifactId,
      youtubeVideoId: "youtube-wrong",
      preparedAt: 240,
      ...externalFailedRunHandoff,
    }),
    /YouTube video identity mismatch/,
  );
  await invoke(preparePublishContinuation, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    preparedAt: 250,
    ...externalFailedRunHandoff,
  });
  run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "pending");
  assert.equal(run?.publishContinuationIntentId, intentId);
  assert.equal(run?.youtubeVideoId, youtubeVideoId);

  const pending = await invoke<Row[]>(listPendingPublishContinuations, ctx, {
    ownerId,
    limit: 10,
  });
  assert.deepEqual(pending.map((row) => row._id), [runId]);

  await invoke(recordPublishContinuationEnqueueFailure, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    error: "Trigger unavailable",
    failedAt: 300,
    enqueueAttempt: 1,
    ...externalFailedRunHandoff,
  });
  run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "pending");
  assert.equal(run?.publishContinuationAttempts, 1);
  assert.equal(run?.publishContinuationLastError, "Trigger unavailable");

  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-run-a",
    queuedAt: 400,
    enqueueAttempt: 2,
    ...externalFailedRunHandoff,
  });
  run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "queued");
  assert.equal(run?.publishContinuationAttempts, 2);
  assert.equal(run?.publishContinuationTriggerRunId, "trigger-run-a");

  // The queued continuation is later claimed by a fresh pipeline generation;
  // completion remains fenced to that generation, not the external scheduler.
  await db.patch(runId, {
    status: "running",
    leaseOwner: resumedFence.leaseOwner,
    executionAttempts: resumedFence.executionLeaseToken,
    leaseExpiresAt: Date.now() + 60_000,
  });
  await db.patch(intentId, { youtubeVideoId: "youtube-conflict" });
  await assert.rejects(
    invoke(completeRun, ctx, {
      ownerId,
      channelId,
      runId,
      finishedAt: 450,
      costTotal: 1.25,
      ...resumedFence,
    }),
    /YouTube video identity mismatch/,
  );
  assert.equal((await db.get(runId))?.blockedPublishIntentId, intentId);
  await db.patch(intentId, { youtubeVideoId });

  await invoke(completeRun, ctx, {
    ownerId,
    channelId,
    runId,
    finishedAt: 500,
    costTotal: 1.25,
    ...resumedFence,
  });
  run = await db.get(runId);
  assert.equal(run?.status, "ok");
  assert.equal(run?.blockedPublishIntentId, undefined);
  assert.equal(run?.blockedPublishArtifactId, undefined);
  assert.equal(run?.publishContinuationState, "completed");
  assert.equal(run?.publishContinuationIntentId, intentId);
  assert.equal(run?.publishContinuationVideoId, youtubeVideoId);

  // A queue receipt racing behind successful completion is idempotent and may
  // never reopen or regress the completed outbox.
  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-run-a",
    queuedAt: 600,
    enqueueAttempt: 2,
    ...externalFailedRunHandoff,
  });
  assert.equal((await db.get(runId))?.publishContinuationState, "completed");

  // An accepted Trigger delivery that never starts must not leave an uploaded
  // run parked in `queued` forever. The scanner returns it to the exact
  // immutable outbox once, gives the reissue a newer attempt, and then makes
  // the receipt manual-only when that final accepted delivery also expires.
  db.seed("runs", {
    ownerId,
    channelId,
    status: "failed",
    costTotal: 0,
  }, recoveryRunId);
  db.seed("publishIntents", {
    ownerId,
    channelId,
    runId: recoveryRunId,
    videoArtifactId: artifactId,
    status: "uploaded",
    youtubeVideoId,
  }, recoveryIntentId);
  await bindExactPublishIntent(ctx as never, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
  });
  await invoke(preparePublishContinuation, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    preparedAt: 700,
    ...externalFailedRunHandoff,
  });
  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-never-started-a",
    queuedAt: 710,
    enqueueAttempt: 1,
    ...externalFailedRunHandoff,
  });
  let recoveryRun = await db.get(recoveryRunId);
  const firstDeadline = recoveryRun?.publishContinuationQueueDeadlineAt as number;
  assert.equal(firstDeadline, 710 + PUBLISH_CONTINUATION_QUEUE_LEASE_MS);
  assert.deepEqual(
    await invoke(reapExpiredQueuedPublishContinuations, ctx, {
      ownerId,
      now: firstDeadline,
      limit: 10,
    }),
    { checked: 1, requeued: 1, blocked: 0 },
  );
  recoveryRun = await db.get(recoveryRunId);
  assert.equal(recoveryRun?.publishContinuationState, "pending");
  assert.equal(recoveryRun?.publishContinuationAttempts, 1);
  assert.equal(recoveryRun?.publishContinuationQueueDeadlineAt, undefined);

  // The older accepted task may acknowledge late, but its attempt number may
  // never overwrite the recovery-pending receipt or its eventual newer queue.
  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-never-started-a-late",
    queuedAt: firstDeadline + 1,
    enqueueAttempt: 1,
    ...externalFailedRunHandoff,
  });
  assert.equal((await db.get(recoveryRunId))?.publishContinuationState, "pending");
  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-never-started-b",
    queuedAt: firstDeadline + 2,
    enqueueAttempt: 2,
    ...externalFailedRunHandoff,
  });
  recoveryRun = await db.get(recoveryRunId);
  const secondDeadline = recoveryRun?.publishContinuationQueueDeadlineAt as number;
  assert.equal(secondDeadline, firstDeadline + 2 + PUBLISH_CONTINUATION_QUEUE_LEASE_MS);
  await invoke(recordPublishContinuationEnqueueFailure, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    error: "stale Trigger transport error",
    failedAt: secondDeadline - 1,
    enqueueAttempt: 1,
    ...externalFailedRunHandoff,
  });
  assert.equal((await db.get(recoveryRunId))?.publishContinuationState, "queued");
  assert.deepEqual(
    await invoke(reapExpiredQueuedPublishContinuations, ctx, {
      ownerId,
      now: secondDeadline,
      limit: 10,
    }),
    { checked: 1, requeued: 0, blocked: 1 },
  );
  recoveryRun = await db.get(recoveryRunId);
  assert.equal(recoveryRun?.status, "failed");
  assert.equal(recoveryRun?.publishContinuationState, "manual_recovery_required");
  assert.equal(recoveryRun?.blockedPublishIntentId, recoveryIntentId);
  assert.match(
    String(recoveryRun?.publishContinuationLastError),
    /manual reconciliation is required/,
  );
  await invoke(markPublishContinuationQueued, ctx, {
    ownerId,
    channelId,
    runId: recoveryRunId,
    intentId: recoveryIntentId,
    artifactId,
    youtubeVideoId,
    triggerRunId: "trigger-never-started-a-very-late",
    queuedAt: secondDeadline + 1,
    enqueueAttempt: 1,
    ...externalFailedRunHandoff,
  });
  assert.equal(
    (await db.get(recoveryRunId))?.publishContinuationState,
    "manual_recovery_required",
  );

  console.log("publish continuation state tests passed");
}

void main();
