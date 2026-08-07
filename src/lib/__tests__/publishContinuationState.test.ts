import assert from "node:assert/strict";
import {
  completeRun,
  listPendingPublishContinuations,
  markPublishContinuationQueued,
  preparePublishContinuation,
  recordPublishContinuationEnqueueFailure,
} from "../../../convex/runs";
import { bindExactPublishIntent } from "../../../convex/publishContinuationState";
import type { Id } from "../../../convex/_generated/dataModel";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private readonly filters: Array<{ field: string; value: unknown }> = [];

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(_name: string, build: (range: unknown) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, value });
        return range;
      },
    };
    build(range);
    return this;
  }

  async take(count: number): Promise<Row[]> {
    return this.db
      .rows(this.table)
      .filter((row) => this.filters.every(({ field, value }) => row[field] === value))
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
  const artifactId = `sha256:${"a".repeat(64)}`;
  const youtubeVideoId = "youtube-a";
  db.seed("channels", { ownerId }, channelId);
  db.seed("runs", {
    ownerId,
    channelId,
    status: "running",
    costTotal: 0,
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
  await invoke(preparePublishContinuation, ctx, {
    ownerId,
    channelId,
    runId,
    intentId,
    artifactId,
    youtubeVideoId,
    preparedAt: 200,
  });
  let run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "pending");
  assert.equal(run?.publishContinuationIntentId, intentId);
  assert.equal(run?.youtubeVideoId, youtubeVideoId);

  await db.patch(runId, { status: "failed" });
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
  });
  run = await db.get(runId);
  assert.equal(run?.publishContinuationState, "queued");
  assert.equal(run?.publishContinuationAttempts, 2);
  assert.equal(run?.publishContinuationTriggerRunId, "trigger-run-a");

  await db.patch(intentId, { youtubeVideoId: "youtube-conflict" });
  await assert.rejects(
    invoke(completeRun, ctx, {
      ownerId,
      channelId,
      runId,
      finishedAt: 450,
      costTotal: 1.25,
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
  });
  assert.equal((await db.get(runId))?.publishContinuationState, "completed");

  console.log("publish continuation state tests passed");
}

void main();
