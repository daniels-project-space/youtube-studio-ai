import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  acquire,
  admit,
  beginRequest,
  claimWorker,
  commit,
  quarantineActiveBatch,
  recordCommitFailure,
  saveChannelRollup,
  saveVideoStats,
} from "../../../convex/analyticsRefreshCursors";
import {
  STATS_REFRESH_FRESHNESS_CADENCE_MS,
  STATS_REFRESH_WORKER_LEASE_MS,
  statsRefreshCadenceKey,
} from "@/lib/statsRefreshCheckpoint";
import {
  DeterministicYouTubeConnectorError,
  isDeterministicYouTubeConnectorError,
} from "@/lib/youtubeConnector";

const TEST_SECRET = "stats-refresh-durability-test-secret";
process.env.INTERNAL_QUERY_SECRET = TEST_SECRET;

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private readonly filters: Array<{ field: string; value: unknown; kind: "eq" | "lt" }> = [];
  private descending = false;

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(
    _name: string,
    build: (range: {
      eq: (field: string, value: unknown) => unknown;
      lt: (field: string, value: unknown) => unknown;
    }) => unknown,
  ): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, value, kind: "eq" });
        return range;
      },
      lt: (field: string, value: unknown) => {
        this.filters.push({ field, value, kind: "lt" });
        return range;
      },
    };
    build(range);
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.descending = direction === "desc";
    return this;
  }

  private rows(): Row[] {
    const rows = this.db.rows(this.table).filter((row) =>
      this.filters.every(({ field, value, kind }) =>
        kind === "eq" ? row[field] === value : String(row[field]) < String(value),
      ),
    );
    return rows.sort((left, right) => {
      const comparison = String(left._creationTime).localeCompare(String(right._creationTime));
      return this.descending ? -comparison : comparison;
    });
  }

  async unique(): Promise<Row | null> {
    const rows = this.rows();
    if (rows.length > 1) throw new Error(`non-unique ${this.table} test query`);
    return rows[0] ?? null;
  }

  async first(): Promise<Row | null> {
    return this.rows()[0] ?? null;
  }

  async take(limit: number): Promise<Row[]> {
    return this.rows().slice(0, limit);
  }
}

class MemoryDb {
  private readonly tables = new Map<string, Map<string, Row>>();
  private counter = 0;

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, value: Record<string, unknown>, id: string): string {
    const rows = this.tables.get(table) ?? new Map<string, Row>();
    this.tables.set(table, rows);
    rows.set(id, { ...value, _id: id, _creationTime: ++this.counter });
    return id;
  }

  async get(id: string): Promise<Row | null> {
    for (const table of this.tables.values()) {
      const row = table.get(id);
      if (row) return row;
    }
    return null;
  }

  normalizeId(table: string, id: string): string | null {
    return this.tables.get(table)?.has(id) ? id : null;
  }

  async insert(table: string, value: Record<string, unknown>): Promise<string> {
    return this.seed(table, value, `${table}:${++this.counter}`);
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new Error(`missing ${id}`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  query(table: string): MemoryQuery {
    return new MemoryQuery(this, table);
  }
}

function invoke<T>(definition: unknown, args: unknown, db: MemoryDb): Promise<T> {
  const ownerId = (args as { ownerId?: string }).ownerId ?? "owner-stats-test";
  return (definition as {
    _handler: (ctx: unknown, args: unknown) => Promise<T>;
  })._handler({
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: "trigger-service",
        issuer: "https://studio.test",
        tokenIdentifier: `test|${ownerId}`,
        role: "service",
        owner_id: ownerId,
      }),
    },
  }, args);
}

function seededDb() {
  const db = new MemoryDb();
  const ownerId = "owner-stats-test";
  const channelId = "channels:stats" as Id<"channels">;
  const connectorId = "youtubeAuth:stats" as Id<"youtubeAuth">;
  db.seed("channels", { ownerId, status: "active" }, String(channelId));
  db.seed("youtubeAuth", {
    ownerId,
    channelId,
    tokenVersion: 1,
    status: "active",
    grantedScopes: [
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
  }, String(connectorId));
  return { db, ownerId, channelId, connectorId };
}

function historyProgress(args: {
  db: MemoryDb;
  ownerId: string;
  channelId: Id<"channels">;
  connectorId: Id<"youtubeAuth">;
  now: number;
  cursor?: string;
}) {
  args.db.seed("analyticsRefreshCursors", {
    ownerId: args.ownerId,
    channelId: args.channelId,
    connectorId: args.connectorId,
    connectorVersion: 1,
    freshnessNextAt: args.now + STATS_REFRESH_FRESHNESS_CADENCE_MS,
    ...(args.cursor ? { historyCursor: args.cursor } : {}),
    createdAt: args.now,
    updatedAt: args.now,
  }, `analyticsRefreshCursors:${String(args.channelId)}`);
}

function binding(args: {
  ownerId: string;
  channelId: Id<"channels">;
  connectorId: Id<"youtubeAuth">;
}) {
  return {
    secret: TEST_SECRET,
    ownerId: args.ownerId,
    channelId: args.channelId,
    connectorId: args.connectorId,
    connectorVersion: 1,
  };
}

type ClaimedWorker = {
  batch: { batchKey: string; generation: number; ingestionId: string };
  workerToken: string;
};

async function claim(
  seeded: ReturnType<typeof seededDb>,
  batch: { batchKey: string; generation: number },
  now: number,
): Promise<{ action: string; worker?: ClaimedWorker }> {
  const result = await invoke<{
    action: string;
    batch?: ClaimedWorker["batch"];
    workerToken?: string;
  }>(claimWorker, {
    ...binding(seeded),
    batchKey: batch.batchKey,
    batchGeneration: batch.generation,
    now,
  }, seeded.db);
  return result.action === "claimed"
    ? { action: result.action, worker: { batch: result.batch!, workerToken: result.workerToken! } }
    : { action: result.action };
}

function workerFence(worker: ClaimedWorker) {
  return {
    batchKey: worker.batch.batchKey,
    batchGeneration: worker.batch.generation,
    workerToken: worker.workerToken,
  };
}

async function run(): Promise<void> {
  const now = 1_000_000;
  const cadenceKey = statsRefreshCadenceKey(now);
  assert.ok(
    isDeterministicYouTubeConnectorError(
      new DeterministicYouTubeConnectorError("missing", "connector row is absent"),
    ),
  );
  assert.equal(
    isDeterministicYouTubeConnectorError(new Error("transient decrypt/environment lookup failure")),
    false,
    "generic connector failures must not receive terminal evidence",
  );

  /* One immutable page owns one ingestion; replays resume it rather than re-scan. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const args = {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-1",
      scanIsDone: false,
      videoIds: ["video-1"],
      now,
    };
    const acquired = await invoke<{ action: string; plan?: { mode: string; cursor: string | null } }>(
      acquire,
      { ...binding(seeded), cadenceKey, now },
      seeded.db,
    );
    assert.deepEqual(acquired, { action: "plan", plan: { mode: "history", startedAfter: 0, cursor: null } });
    const first = await invoke<{ action: string; batch?: { batchKey: string; generation: number; ingestionId: string } }>(
      admit,
      args,
      seeded.db,
    );
    assert.equal(first.action, "started");
    const replay = await invoke<{ action: string; batch?: { batchKey: string; generation: number; ingestionId: string } }>(
      admit,
      args,
      seeded.db,
    );
    assert.equal(replay.action, "resume");
    assert.equal(replay.batch!.ingestionId, first.batch!.ingestionId);
    assert.equal(seeded.db.rows("analyticsIngestions").length, 1);

    const claimed = await claim(seeded, first.batch!, now + 1);
    assert.equal(claimed.action, "claimed");
    const concurrent = await claim(seeded, first.batch!, now + 2);
    assert.equal(concurrent.action, "busy", "a live worker lease must make a second core a no-op");
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "active");
    await assert.rejects(
      invoke(beginRequest, {
        ...binding(seeded),
        batchKey: first.batch!.batchKey,
        batchGeneration: first.batch!.generation,
        workerToken: "stale-worker-token",
        stage: "video",
        now: now + 3,
      }, seeded.db),
      /worker lease is stale, missing, or expired/,
      "a non-owner cannot start a provider request while the live worker owns the batch",
    );
    const worker = claimed.worker!;

    const videoStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded),
      ...workerFence(worker),
      stage: "video",
      now: now + 4,
    }, seeded.db);
    assert.equal(videoStart.action, "dispatch");
    await invoke(saveVideoStats, {
      ...binding(seeded),
      ...workerFence(worker),
      requestToken: videoStart.token,
      stats: [{ youtubeVideoId: "video-1", channelId: "youtube-channel-1", views: 12, likes: 3, comments: 2 }],
      now: now + 5,
    }, seeded.db);
    const channelStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded),
      ...workerFence(worker),
      stage: "channel",
      now: now + 6,
    }, seeded.db);
    assert.equal(channelStart.action, "dispatch");
    await invoke(saveChannelRollup, {
      ...binding(seeded),
      ...workerFence(worker),
      requestToken: channelStart.token,
      rollup: { found: true, subscriberCount: 100, viewCount: 500, videoCount: 1 },
      now: now + 7,
    }, seeded.db);
    const committed = await invoke<{ action: string; recordsWritten: number }>(commit, {
      ...binding(seeded),
      ...workerFence(worker),
      now: now + 8,
    }, seeded.db);
    assert.deepEqual(committed, { action: "committed", recordsWritten: 2 });
    assert.equal(seeded.db.rows("videoAnalytics").length, 1);
    assert.equal(seeded.db.rows("channelAnalytics").length, 1);
    assert.equal(seeded.db.rows("analyticsIngestions")[0]?.status, "completed");
    const progress = seeded.db.rows("analyticsRefreshCursors")[0]!;
    assert.equal(progress.historyCursor, "history:after-1");
    assert.equal(progress.activeBatch, undefined);
    const fenced = await invoke<{ action: string }>(acquire, {
      ...binding(seeded), cadenceKey, now: now + 9,
    }, seeded.db);
    assert.equal(fenced.action, "cadence_completed", "a lost commit response cannot start another ingestion in-slot");
    const nextCadence = await invoke<{ action: string; plan?: { cursor: string | null } }>(acquire, {
      ...binding(seeded), cadenceKey: statsRefreshCadenceKey(now + 6 * 60 * 60 * 1_000), now: now + 6 * 60 * 60 * 1_000,
    }, seeded.db);
    assert.equal(nextCadence.action, "plan");
    assert.equal(nextCadence.plan?.cursor, "history:after-1");
  }

  /* A request-start marker is a spend fence: no replay gets a second dispatch token. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const first = await invoke<{ action: string; batch?: { batchKey: string; generation: number } }>(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-1",
      scanIsDone: false,
      videoIds: ["video-1"],
      now,
    }, seeded.db);
    const claimed = await claim(seeded, first.batch!, now + 1);
    assert.equal(claimed.action, "claimed");
    const started = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(claimed.worker!), stage: "video", now: now + 2,
    }, seeded.db);
    assert.equal(started.action, "dispatch");
    const replay = await invoke<{ action: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(claimed.worker!), stage: "video", now: now + 3,
    }, seeded.db);
    assert.equal(replay.action, "manual_reconciliation_required");
    const progress = seeded.db.rows("analyticsRefreshCursors")[0]!;
    assert.equal(progress.activeState, "manual_reconciliation_required");
    assert.equal(seeded.db.rows("analyticsIngestions")[0]?.status, "failed");
    const blocked = await invoke<{ action: string }>(acquire, {
      ...binding(seeded), cadenceKey: statsRefreshCadenceKey(now + 6 * 60 * 60 * 1_000), now: now + 6 * 60 * 60 * 1_000,
    }, seeded.db);
    assert.equal(blocked.action, "manual_reconciliation_required");
  }

  /* A live owner is only busy; after its lease expires, the unresolved batch is quarantined. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const first = await invoke<{ action: string; batch?: { batchKey: string; generation: number } }>(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-lease",
      scanIsDone: false,
      videoIds: ["video-lease"],
      now,
    }, seeded.db);
    const owner = await claim(seeded, first.batch!, now + 1);
    assert.equal(owner.action, "claimed");
    const liveReplay = await claim(seeded, first.batch!, now + 2);
    assert.equal(liveReplay.action, "busy");
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "active");
    const expiredReplay = await claim(seeded, first.batch!, now + STATS_REFRESH_WORKER_LEASE_MS + 2);
    assert.equal(expiredReplay.action, "manual_reconciliation_required");
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "manual_reconciliation_required");
  }

  /* Revoked/missing connector state can terminally quarantine an active batch without connector validation. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    await invoke(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-revoked",
      scanIsDone: false,
      videoIds: ["video-revoked"],
      now,
    }, seeded.db);
    await seeded.db.patch(String(seeded.connectorId), { status: "revoked", grantedScopes: [] });
    const quarantined = await invoke<{ action: string }>(quarantineActiveBatch, {
      secret: TEST_SECRET,
      ownerId: seeded.ownerId,
      channelId: seeded.channelId,
      reason: "connector revoked and no longer has readable scopes",
      evidence: "deterministic_invalid" as const,
      now: now + 1,
    }, seeded.db);
    assert.equal(quarantined.action, "manual_reconciliation_required");
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "manual_reconciliation_required");
    assert.equal(seeded.db.rows("analyticsIngestions")[0]?.status, "failed");
  }

  /* B's transient connector/decrypt lookup error must not poison live worker A. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const admitted = await invoke<{ action: string; batch?: { batchKey: string; generation: number } }>(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-transient-connector-error",
      scanIsDone: false,
      videoIds: ["video-transient"],
      now,
    }, seeded.db);
    const workerA = await claim(seeded, admitted.batch!, now + 1);
    assert.equal(workerA.action, "claimed");
    const transientB = await invoke<{ action: string }>(quarantineActiveBatch, {
      secret: TEST_SECRET,
      ownerId: seeded.ownerId,
      channelId: seeded.channelId,
      reason: "YOUTUBE_TOKEN_ENCRYPTION_KEY is temporarily unavailable",
      evidence: "transient" as const,
      now: now + 2,
    }, seeded.db);
    assert.equal(transientB.action, "busy");
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "active");
    const aCanContinue = await invoke<{ action: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(workerA.worker!), stage: "video", now: now + 3,
    }, seeded.db);
    assert.equal(aCanContinue.action, "dispatch");
  }

  /* Expired A may be replaced only after both provider replies are durable; B commits cached facts and fences A. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const admitted = await invoke<{ action: string; batch?: { batchKey: string; generation: number } }>(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-local-only-reclaim",
      scanIsDone: false,
      videoIds: ["video-local-only"],
      now,
    }, seeded.db);
    const workerAClaim = await claim(seeded, admitted.batch!, now + 1);
    assert.equal(workerAClaim.action, "claimed");
    const workerA = workerAClaim.worker!;
    const videoStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(workerA), stage: "video", now: now + 2,
    }, seeded.db);
    await invoke(saveVideoStats, {
      ...binding(seeded),
      ...workerFence(workerA),
      requestToken: videoStart.token,
      stats: [{ youtubeVideoId: "video-local-only", channelId: "youtube-channel-1", views: 9, likes: 2, comments: 1 }],
      now: now + 3,
    }, seeded.db);
    const channelStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(workerA), stage: "channel", now: now + 4,
    }, seeded.db);
    await invoke(saveChannelRollup, {
      ...binding(seeded),
      ...workerFence(workerA),
      requestToken: channelStart.token,
      rollup: { found: true, subscriberCount: 20, viewCount: 200, videoCount: 1 },
      now: now + 5,
    }, seeded.db);
    const workerBClaim = await claim(
      seeded,
      admitted.batch!,
      now + STATS_REFRESH_WORKER_LEASE_MS + 10,
    );
    assert.equal(workerBClaim.action, "claimed");
    const workerB = workerBClaim.worker!;
    assert.ok(workerB.batch.generation > workerA.batch.generation, "local-only recovery must advance the fence generation");
    await assert.rejects(
      invoke(commit, {
        ...binding(seeded), ...workerFence(workerA), now: now + STATS_REFRESH_WORKER_LEASE_MS + 11,
      }, seeded.db),
      /worker lease is stale, missing, or expired/,
    );
    const committed = await invoke<{ action: string; recordsWritten: number }>(commit, {
      ...binding(seeded), ...workerFence(workerB), now: now + STATS_REFRESH_WORKER_LEASE_MS + 12,
    }, seeded.db);
    assert.deepEqual(committed, { action: "committed", recordsWritten: 2 });
    assert.equal(seeded.db.rows("analyticsIngestions")[0]?.status, "completed");
  }

  /* An irreparable local sink failure has a finite retry budget and then visibly stops. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now });
    const admitted = await invoke<{ action: string; batch?: { batchKey: string; generation: number } }>(admit, {
      ...binding(seeded),
      cadenceKey,
      windowDate: "2026-08-21",
      mode: "history" as const,
      scanStartedAfter: 0,
      scanCursorAfter: "history:after-commit-cap",
      scanIsDone: false,
      videoIds: ["video-commit-cap"],
      now,
    }, seeded.db);
    const initialWorker = await claim(seeded, admitted.batch!, now + 1);
    assert.equal(initialWorker.action, "claimed");
    const videoStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(initialWorker.worker!), stage: "video", now: now + 2,
    }, seeded.db);
    await invoke(saveVideoStats, {
      ...binding(seeded),
      ...workerFence(initialWorker.worker!),
      requestToken: videoStart.token,
      stats: [{ youtubeVideoId: "video-commit-cap", channelId: "youtube-channel-1", views: 1, likes: 1, comments: 1 }],
      now: now + 3,
    }, seeded.db);
    const channelStart = await invoke<{ action: string; token?: string }>(beginRequest, {
      ...binding(seeded), ...workerFence(initialWorker.worker!), stage: "channel", now: now + 4,
    }, seeded.db);
    await invoke(saveChannelRollup, {
      ...binding(seeded),
      ...workerFence(initialWorker.worker!),
      requestToken: channelStart.token,
      rollup: { found: true, subscriberCount: 1, viewCount: 1, videoCount: 1 },
      now: now + 5,
    }, seeded.db);
    seeded.db.seed("videoReleaseProvenance", {
      ownerId: seeded.ownerId,
      channelId: "channels:other",
      youtubeVideoId: "video-commit-cap",
    }, "videoReleaseProvenance:wrong-channel");

    let worker = initialWorker.worker!;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await assert.rejects(
        invoke(commit, {
          ...binding(seeded), ...workerFence(worker), now: now + 10 + attempt,
        }, seeded.db),
        /release provenance channel mismatch/,
      );
      const failure = await invoke<{ action: string; commitFailureCount: number }>(recordCommitFailure, {
        ...binding(seeded),
        ...workerFence(worker),
        error: "release provenance channel mismatch",
        now: now + 20 + attempt,
      }, seeded.db);
      assert.equal(failure.commitFailureCount, attempt);
      if (attempt < 3) {
        assert.equal(failure.action, "retry_later");
        const reClaimed = await claim(seeded, admitted.batch!, now + 30 + attempt);
        assert.equal(reClaimed.action, "claimed");
        worker = reClaimed.worker!;
      } else {
        assert.equal(failure.action, "manual_reconciliation_required");
      }
    }
    assert.equal(seeded.db.rows("analyticsRefreshCursors")[0]?.activeState, "manual_reconciliation_required");
    assert.equal(seeded.db.rows("analyticsIngestions")[0]?.status, "failed");
  }

  /* A non-advancing unfinished page is rejected instead of becoming an endless loop. */
  {
    const seeded = seededDb();
    historyProgress({ ...seeded, now, cursor: "same-cursor" });
    await assert.rejects(
      invoke(admit, {
        ...binding(seeded),
        cadenceKey,
        windowDate: "2026-08-21",
        mode: "history" as const,
        scanStartedAfter: 0,
        scanCursorBefore: "same-cursor",
        scanCursorAfter: "same-cursor",
        scanIsDone: false,
        videoIds: [],
        now,
      }, seeded.db),
      /continuation cursor did not advance/,
    );
  }

  const trigger = readFileSync(resolve(process.cwd(), "src/trigger/statsRefresh.ts"), "utf8");
  assert.doesNotMatch(trigger, /listRunHistorySince/);
  assert.match(trigger, /listRunsByChannelSincePage/);
  assert.match(trigger, /retry:\s*\{\s*maxAttempts:\s*1\s*\}/);
  assert.match(trigger, /claimStatsRefreshWorker/);
  assert.match(trigger, /quarantineActiveBatch/);
  assert.match(trigger, /recordCommitFailure/);
  assert.match(trigger, /error instanceof DeterministicYouTubeConnectorError/);
  assert.match(trigger, /connector lookup deferred/);
  assert.ok(
    trigger.indexOf("api.analyticsRefreshCursors.beginRequest") < trigger.indexOf("await fetchVideoStats"),
    "the durable video request marker must precede the Google request",
  );
  assert.ok(
    trigger.lastIndexOf("api.analyticsRefreshCursors.beginRequest") < trigger.indexOf("await fetchChannelStats"),
    "the durable channel request marker must precede the Google request",
  );

  console.log("STATS REFRESH DURABILITY TESTS PASS");
}

run();
