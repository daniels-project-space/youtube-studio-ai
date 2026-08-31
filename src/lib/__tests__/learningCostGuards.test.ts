import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  admitLearningBatch,
  claimLearningBatchWorker,
  consumeLearningItemRequestDispatchCapability,
  markLearningItemAmbiguous,
  markLearningItemRequestDispatchStarted,
  prepareLearningLedgerWrite,
  recordLearningItemFetched,
  startLearningItemRequest,
} from "../../../convex/analyticsIngestions";
import {
  claimShowBibleProposal,
  listShowBibleClaims,
  markShowBibleProviderDispatchStarted,
  markShowBibleProviderStarted,
  resolveShowBibleProviderStartedNoDispatch,
} from "../../../convex/learningGovernance";
import {
  LEARNING_ANALYTICS_BATCH_LIMIT,
  LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
  LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
  LEARNING_ANALYTICS_METRIC_DEFINITION_V1,
  LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
  LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS,
  LEARNING_ANALYTICS_FRESHNESS_CADENCE_MS,
  assertLearningAnalyticsHttpDispatchWindow,
  planLearningAnalyticsScan,
  SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP,
  SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS,
} from "@/lib/learningRefreshCheckpoint";
import {
  hasYouTubeAnalyticsReportScopes,
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_FULL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "@/lib/publishingPolicy";
import { sha256Hex } from "@/lib/sha256";
import { fetchVideoAnalytics } from "@/lib/youtubeAnalytics";

const TEST_SECRET = "learning-cost-guards-test-secret";
process.env.INTERNAL_QUERY_SECRET = TEST_SECRET;

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private readonly filters: Array<{ field: string; value: unknown }> = [];
  private direction: "asc" | "desc" = "asc";

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(_name: string, build: (range: { eq: (field: string, value: unknown) => unknown }) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, value });
        return range;
      },
    };
    build(range);
    return this;
  }

  async unique(): Promise<Row | null> {
    const rows = this.db.rows(this.table).filter((row) =>
      this.filters.every(({ field, value }) => row[field] === value),
    );
    if (rows.length > 1) throw new Error(`non-unique ${this.table} test query`);
    return rows[0] ?? null;
  }

  order(direction: "asc" | "desc"): this {
    this.direction = direction;
    return this;
  }

  async take(limit: number): Promise<Row[]> {
    const rows = this.db.rows(this.table).filter((row) =>
      this.filters.every(({ field, value }) => row[field] === value),
    );
    rows.sort((left, right) => this.direction === "desc"
      ? right._creationTime - left._creationTime
      : left._creationTime - right._creationTime);
    return rows.slice(0, limit);
  }

  async collect(): Promise<Row[]> {
    return this.take(Number.MAX_SAFE_INTEGER);
  }
}

class MemoryDb {
  private readonly tables = new Map<string, Map<string, Row>>();
  private counter = 0;

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, value: Record<string, unknown>, id: string): string {
    const tableRows = this.tables.get(table) ?? new Map<string, Row>();
    this.tables.set(table, tableRows);
    tableRows.set(id, { ...value, _id: id, _creationTime: ++this.counter });
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
    const id = `${table}:${++this.counter}`;
    return this.seed(table, value, id);
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
  const ownerId = (args as { ownerId?: string }).ownerId ?? "owner-learning-test";
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

function seededDb(): {
  db: MemoryDb;
  ownerId: string;
  channelId: Id<"channels">;
  connectorId: Id<"youtubeAuth">;
  runId: Id<"runs">;
} {
  const db = new MemoryDb();
  const ownerId = "owner-learning-test";
  const channelId = "channels:learning" as Id<"channels">;
  const connectorId = "youtubeAuth:learning" as Id<"youtubeAuth">;
  const runId = "runs:learning" as Id<"runs">;
  db.seed("channels", { ownerId, learningPolicyVersion: 0 }, String(channelId));
  db.seed("youtubeAuth", {
    ownerId,
    channelId,
    tokenVersion: 1,
    status: "active",
    grantedScopes: [YOUTUBE_ANALYTICS_SCOPE, YOUTUBE_READONLY_SCOPE],
  }, String(connectorId));
  db.seed("runs", {
    ownerId,
    channelId,
    youtubeVideoId: "video-learning-1",
    finishedAt: 1_000,
    costTotal: 0,
    status: "ok",
  }, String(runId));
  return { db, ownerId, channelId, connectorId, runId };
}

async function run(): Promise<void> {
  const now = 1_000_000;
  const admissionDay = new Date(now).toISOString().slice(0, 10);

  /* Targeted reports need Analytics plus a read scope; broader youtube is valid. */
  assert.equal(
    hasYouTubeAnalyticsReportScopes([YOUTUBE_ANALYTICS_SCOPE]),
    false,
    "Analytics alone cannot admit an engaged-views report",
  );
  assert.equal(
    hasYouTubeAnalyticsReportScopes([YOUTUBE_ANALYTICS_SCOPE, YOUTUBE_READONLY_SCOPE]),
    true,
  );
  assert.equal(
    hasYouTubeAnalyticsReportScopes([YOUTUBE_ANALYTICS_SCOPE, YOUTUBE_FULL_SCOPE]),
    true,
  );
  assert.equal(
    hasYouTubeAnalyticsReportScopes([YOUTUBE_READONLY_SCOPE]),
    false,
  );

  /* An immutable Show Bible claim is obtained before the model boundary. */
  {
    const { db, ownerId, channelId, connectorId } = seededDb();
    const args = {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      recommendationKey: `show-bible:${String(channelId)}:v1`,
      basePolicyVersion: 0,
      request: { role: "showrunner" as const, system: "system", prompt: "prompt", maxTokens: 600 },
      baseBrief: { positioning: "test" },
      sourceVideoIds: ["video-learning-1"],
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-01-02",
      offlineEvaluation: {
        method: "historical_evidence_sufficiency_v1",
        sampleSize: 4,
        passed: true,
        notes: "enough",
      },
      admissionDay,
      fairnessKey: String(channelId),
      claimToken: "claim-a",
      now,
    };
    const first = await invoke<{ action: string; claim?: { claimToken: string } }>(claimShowBibleProposal, args, db);
    assert.equal(first.action, "generate");
    const concurrent = await invoke<{ action: string }>(claimShowBibleProposal, {
      ...args,
      claimToken: "claim-b",
      now: now + 1,
    }, db);
    assert.equal(concurrent.action, "blocked_pre_provider_claim", "a concurrent schedule cannot gain a second model permission");
    const started = await invoke<{ started: boolean }>(markShowBibleProviderStarted, {
      secret: args.secret,
      ownerId,
      channelId,
      recommendationKey: args.recommendationKey,
      claimToken: "claim-a",
      now: now + 2,
    }, db);
    assert.equal(started.started, true);
    const dispatchStarted = await invoke<{ started: boolean }>(markShowBibleProviderDispatchStarted, {
      secret: args.secret,
      ownerId,
      channelId,
      recommendationKey: args.recommendationKey,
      claimToken: "claim-a",
      now: now + 3,
    }, db);
    assert.equal(dispatchStarted.started, true, "the exact dispatch marker must be durable before agentJson");
    const postDispatch = await invoke<{ action: string }>(claimShowBibleProposal, {
      ...args,
      claimToken: "claim-c",
      now: now + SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS + 10,
    }, db);
    assert.equal(postDispatch.action, "manual_reconciliation_required", "provider-dispatch claims never expire into another generation");
  }

  /* A policy advance after provider-start must stop the exact paid dispatch. */
  {
    const { db, ownerId, channelId, connectorId } = seededDb();
    const args = {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      recommendationKey: `show-bible:${String(channelId)}:v1`,
      basePolicyVersion: 0,
      request: { role: "showrunner" as const, system: "system", prompt: "prompt", maxTokens: 600 },
      baseBrief: { positioning: "test" },
      sourceVideoIds: ["video-learning-1"],
      dataWindowStart: admissionDay,
      dataWindowEnd: admissionDay,
      offlineEvaluation: { method: "historical", sampleSize: 4, passed: true, notes: "enough" },
      admissionDay,
      fairnessKey: String(channelId),
      claimToken: "policy-race-a",
      now,
    };
    assert.equal((await invoke<{ action: string }>(claimShowBibleProposal, args, db)).action, "generate");
    assert.equal((await invoke<{ started: boolean }>(markShowBibleProviderStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      recommendationKey: args.recommendationKey,
      claimToken: args.claimToken,
      now: now + 1,
    }, db)).started, true);
    await db.patch(String(channelId), { learningPolicyVersion: 1 });
    const blockedDispatch = await invoke<{ started: boolean; status?: string }>(
      markShowBibleProviderDispatchStarted,
      {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        recommendationKey: args.recommendationKey,
        claimToken: args.claimToken,
        now: now + 2,
      },
      db,
    );
    assert.equal(blockedDispatch.started, false);
    assert.equal(blockedDispatch.status, "policy_changed", "a stale policy receives zero model permission");
    const claim = db.rows("showBibleProposalClaims")[0] as unknown as {
      status: string;
      providerDispatchStartedAt?: number;
    };
    assert.equal(claim.status, "provider_started", "the stale provider-start remains visible for reconciliation");
    assert.equal(claim.providerDispatchStartedAt, undefined);
  }

  /* The no-dispatch gap is visible and can be rearmed only by an audited owner session. */
  {
    const { db, ownerId, channelId, connectorId } = seededDb();
    const args = {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      recommendationKey: `show-bible:${String(channelId)}:v1`,
      basePolicyVersion: 0,
      request: { role: "showrunner" as const, system: "system", prompt: "prompt", maxTokens: 600 },
      baseBrief: { positioning: "test" },
      sourceVideoIds: ["video-learning-1"],
      dataWindowStart: admissionDay,
      dataWindowEnd: admissionDay,
      offlineEvaluation: {
        method: "historical_evidence_sufficiency_v1",
        sampleSize: 4,
        passed: true,
        notes: "enough",
      },
      admissionDay,
      fairnessKey: String(channelId),
      claimToken: "no-dispatch-a",
      now,
    };
    const claim = await invoke<{
      action: string;
      claim?: { _id: Id<"showBibleProposalClaims"> };
    }>(claimShowBibleProposal, args, db);
    assert.equal(claim.action, "generate");
    await invoke(markShowBibleProviderStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      recommendationKey: args.recommendationKey,
      claimToken: args.claimToken,
      now: now + 1,
    }, db);
    const visibleClaims = await invoke<Array<{
      claimId: Id<"showBibleProposalClaims">;
      status: string;
      rearmAllowed: boolean;
    }>>(listShowBibleClaims, {
      secret: TEST_SECRET,
      ownerId,
    }, db);
    assert.equal(visibleClaims[0]?.claimId, claim.claim!._id, "the owner can discover the unresolved claim");
    assert.equal(visibleClaims[0]?.rearmAllowed, true, "only the proven no-dispatch gap is visibly rearmable");
    await assert.rejects(
      () => invoke(resolveShowBibleProviderStartedNoDispatch, {
        secret: TEST_SECRET,
        ownerId,
        claimId: claim.claim!._id,
        actor: `service:${ownerId}`,
        reason: "The worker stopped before dispatch.",
        evidence: "Trace confirms no provider request was attempted.",
        verifiedNoDispatch: true,
        attestedAt: now + 2,
        now: now + 2,
      }, db),
      /owner session actor/,
      "a service caller cannot silently rearm a provider-started claim",
    );
    const rearmed = await invoke<{
      status: string;
      operatorResolutionAudit?: Array<{ actor: string }>;
    }>(resolveShowBibleProviderStartedNoDispatch, {
      secret: TEST_SECRET,
      ownerId,
      claimId: claim.claim!._id,
      actor: `session:${ownerId}`,
      reason: "The worker stopped before dispatch.",
      evidence: "Trace confirms no provider request was attempted.",
      verifiedNoDispatch: true,
      attestedAt: now + 2,
      now: now + 2,
    }, db);
    assert.equal(rearmed.status, "claimed");
    assert.equal(rearmed.operatorResolutionAudit?.[0]?.actor, `session:${ownerId}`);
    const retried = await invoke<{ action: string }>(claimShowBibleProposal, {
      ...args,
      claimToken: "no-dispatch-b",
      now: now + 3,
    }, db);
    assert.equal(retried.action, "generate", "a rearmed claim must obtain a fresh exact token before dispatch");
    assert.equal(db.rows("showBibleGenerationAdmissions").length, 1, "rearming cannot reserve or bill a second owner admission");
  }

  /* A provider-start pause crossing midnight must consume today's dispatch envelope. */
  {
    const { db, ownerId, channelId, connectorId } = seededDb();
    const secondChannelId = "channels:midnight-2" as Id<"channels">;
    const thirdChannelId = "channels:midnight-3" as Id<"channels">;
    const secondConnectorId = "youtubeAuth:midnight-2" as Id<"youtubeAuth">;
    const thirdConnectorId = "youtubeAuth:midnight-3" as Id<"youtubeAuth">;
    for (const [id, connector] of [
      [secondChannelId, secondConnectorId],
      [thirdChannelId, thirdConnectorId],
    ] as const) {
      db.seed("channels", { ownerId, learningPolicyVersion: 0 }, String(id));
      db.seed("youtubeAuth", {
        ownerId,
        channelId: id,
        tokenVersion: 1,
        status: "active",
        grantedScopes: [YOUTUBE_ANALYTICS_SCOPE],
      }, String(connector));
    }
    const late = Date.UTC(2026, 0, 1, 23, 59, 0);
    const nextDay = late + 2 * 60_000;
    const lateDay = new Date(late).toISOString().slice(0, 10);
    const nextDayText = new Date(nextDay).toISOString().slice(0, 10);
    const claimFor = (id: Id<"channels">, connector: Id<"youtubeAuth">, token: string) =>
      invoke<{ action: string }>(claimShowBibleProposal, {
        secret: TEST_SECRET,
        ownerId,
        channelId: id,
        connectorId: connector,
        connectorVersion: 1,
        recommendationKey: `show-bible:${String(id)}:v1`,
        basePolicyVersion: 0,
        request: { role: "showrunner", system: "system", prompt: "prompt", maxTokens: 600 },
        baseBrief: { positioning: "test" },
        sourceVideoIds: ["video-learning-1"],
        dataWindowStart: lateDay,
        dataWindowEnd: lateDay,
        offlineEvaluation: { method: "historical", sampleSize: 4, passed: true, notes: "enough" },
        admissionDay: lateDay,
        fairnessKey: String(id),
        claimToken: token,
        now: late,
      }, db);
    assert.equal((await claimFor(channelId, connectorId, "midnight-a")).action, "generate");
    assert.equal((await claimFor(secondChannelId, secondConnectorId, "midnight-b")).action, "generate");
    assert.equal((await invoke<{ started: boolean }>(markShowBibleProviderStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      recommendationKey: `show-bible:${String(channelId)}:v1`,
      claimToken: "midnight-a",
      now: late + 10_000,
    }, db)).started, true);
    assert.equal((await invoke<{ started: boolean }>(markShowBibleProviderStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId: secondChannelId,
      recommendationKey: `show-bible:${String(secondChannelId)}:v1`,
      claimToken: "midnight-b",
      now: late + 10_000,
    }, db)).started, true);
    assert.equal((await invoke<{ started: boolean }>(markShowBibleProviderDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      recommendationKey: `show-bible:${String(channelId)}:v1`,
      claimToken: "midnight-a",
      now: nextDay,
    }, db)).started, true);
    assert.equal((await invoke<{ started: boolean }>(markShowBibleProviderDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId: secondChannelId,
      recommendationKey: `show-bible:${String(secondChannelId)}:v1`,
      claimToken: "midnight-b",
      now: nextDay,
    }, db)).started, true);
    const third = await invoke<{ action: string }>(claimShowBibleProposal, {
      secret: TEST_SECRET,
      ownerId,
      channelId: thirdChannelId,
      connectorId: thirdConnectorId,
      connectorVersion: 1,
      recommendationKey: `show-bible:${String(thirdChannelId)}:v1`,
      basePolicyVersion: 0,
      request: { role: "showrunner", system: "system", prompt: "prompt", maxTokens: 600 },
      baseBrief: { positioning: "test" },
      sourceVideoIds: ["video-learning-1"],
      dataWindowStart: nextDayText,
      dataWindowEnd: nextDayText,
      offlineEvaluation: { method: "historical", sampleSize: 4, passed: true, notes: "enough" },
      admissionDay: nextDayText,
      fairnessKey: String(thirdChannelId),
      claimToken: "midnight-c",
      now: nextDay,
    }, db);
    assert.equal(third.action, "deferred_owner_budget", "yesterday's provider-start reservations cannot bypass today's dispatch cap");
  }

  /* Owner-wide model admission is capped and deferred work receives a future turn. */
  {
    const { db, ownerId, channelId, connectorId } = seededDb();
    const secondChannelId = "channels:learning-2" as Id<"channels">;
    const thirdChannelId = "channels:learning-3" as Id<"channels">;
    const secondConnectorId = "youtubeAuth:learning-2" as Id<"youtubeAuth">;
    const thirdConnectorId = "youtubeAuth:learning-3" as Id<"youtubeAuth">;
    for (const [id, connector] of [
      [secondChannelId, secondConnectorId],
      [thirdChannelId, thirdConnectorId],
    ] as const) {
      db.seed("channels", { ownerId, learningPolicyVersion: 0 }, String(id));
      db.seed("youtubeAuth", {
        ownerId,
        channelId: id,
        tokenVersion: 1,
        status: "active",
        grantedScopes: [YOUTUBE_ANALYTICS_SCOPE],
      }, String(connector));
    }
    const claimFor = (id: Id<"channels">, connector: Id<"youtubeAuth">, token: string, at: number) =>
      invoke<{ action: string }>(claimShowBibleProposal, {
        secret: TEST_SECRET,
        ownerId,
        channelId: id,
        connectorId: connector,
        connectorVersion: 1,
        recommendationKey: `show-bible:${String(id)}:v1`,
        basePolicyVersion: 0,
        request: { role: "showrunner", system: "system", prompt: "prompt", maxTokens: 600 },
        baseBrief: { positioning: "test" },
        sourceVideoIds: ["video-learning-1"],
        dataWindowStart: new Date(at).toISOString().slice(0, 10),
        dataWindowEnd: new Date(at).toISOString().slice(0, 10),
        offlineEvaluation: { method: "historical", sampleSize: 4, passed: true, notes: "enough" },
        admissionDay: new Date(at).toISOString().slice(0, 10),
        fairnessKey: String(id),
        claimToken: token,
        now: at,
      }, db);
    assert.equal((await claimFor(channelId, connectorId, "owner-cap-a", now)).action, "generate");
    assert.equal((await claimFor(secondChannelId, secondConnectorId, "owner-cap-b", now + 1)).action, "generate");
    const deferred = await claimFor(thirdChannelId, thirdConnectorId, "owner-cap-c", now + 2);
    assert.equal(deferred.action, "deferred_owner_budget");
    assert.equal(db.rows("showBibleGenerationAdmissions").length, SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP);
    const tomorrow = now + 24 * 3_600_000;
    assert.equal(
      (await claimFor(thirdChannelId, thirdConnectorId, "owner-cap-d", tomorrow)).action,
      "generate",
      "a deferred channel can receive a bounded future admission without recreating its immutable proposal",
    );
    assert.equal(
      (db.rows("showBibleOwnerAdmissionState")[0] as { roundRobinCursor?: string }).roundRobinCursor,
      String(thirdChannelId),
      "the durable cursor advances after the most recently admitted channel",
    );
  }

  /* Missing YouTube read scope fails before durable Analytics batch admission. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    await db.patch(String(connectorId), {
      grantedScopes: [YOUTUBE_ANALYTICS_SCOPE],
    });
    await assert.rejects(
      () => invoke(admitLearningBatch, {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        connectorId,
        connectorVersion: 1,
        mode: "history",
        scanStartedAfter: 0,
        scanCursorAfter: "scope-preflight",
        scanIsDone: false,
        settledBefore: now,
        candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
        now,
      }, db),
      /scope mismatch/,
      "a partial legacy connector gets no active batch or provider permission",
    );
    assert.equal(db.rows("analyticsIngestions").length, 0);
    assert.equal(db.rows("learningAnalyticsProgress").length, 0);
  }

  /* A single active analytics page bounds work and a restart does not re-fetch. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    {
      const args = {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        connectorId,
        connectorVersion: 1,
        mode: "history" as const,
        scanStartedAfter: 0,
        scanCursorAfter: "cursor-after-page-1",
        scanIsDone: false,
        settledBefore: now,
        candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
        now,
      };
      const connectorBinding = {
        connectorId,
        connectorVersion: 1,
      };
      const admitted = await invoke<{ action: string; batch?: { batchKey: string } }>(admitLearningBatch, args, db);
      assert.equal(admitted.action, "admitted");
      const replay = await invoke<{ action: string; batch?: { batchKey: string } }>(admitLearningBatch, args, db);
      assert.equal(replay.action, "resume", "a retry resumes the same bounded page instead of creating a second ingestion");
      const batchKey = admitted.batch!.batchKey;
      const workerA = await invoke<{
        action: string;
        workerLeaseGeneration?: number;
      }>(claimLearningBatchWorker, {
        secret: args.secret,
        ownerId,
        channelId,
        batchKey,
        workerLeaseToken: "worker-a",
        now: now + 1,
      }, db);
      assert.equal(workerA.action, "claimed");
      const workerBWhileLive = await invoke<{ action: string }>(claimLearningBatchWorker, {
        secret: args.secret,
        ownerId,
        channelId,
        batchKey,
        workerLeaseToken: "worker-b",
        now: now + 2,
      }, db);
      assert.equal(workerBWhileLive.action, "busy", "a live worker is never converted to ambiguous by a concurrent refresh");
      const workerALease = {
        workerLeaseToken: "worker-a",
        workerLeaseGeneration: workerA.workerLeaseGeneration!,
      };
      const first = await invoke<{ action: string }>(startLearningItemRequest, {
        secret: args.secret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        runId,
        ...workerALease,
        now: now + 1,
      }, db);
      assert.equal(first.action, "dispatch", "the early marker alone cannot authorize an Analytics GET");
      await assert.rejects(
        () => invoke(startLearningItemRequest, {
          secret: args.secret,
          ownerId,
          channelId,
          ...connectorBinding,
          batchKey,
          runId,
          workerLeaseToken: "worker-b",
          workerLeaseGeneration: workerALease.workerLeaseGeneration + 1,
          now: now + 2,
        }, db),
        /worker lease is no longer owned/,
        "a concurrent worker cannot alter a live request_started item",
      );
      const recoveredWorkerB = await invoke<{
        action: string;
        workerLeaseGeneration?: number;
      }>(claimLearningBatchWorker, {
        secret: args.secret,
        ownerId,
        channelId,
        batchKey,
        workerLeaseToken: "worker-b",
        now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 2,
      }, db);
      assert.equal(recoveredWorkerB.action, "claimed", "only an expired worker lease may be recovered");
      const workerBLease = {
        workerLeaseToken: "worker-b",
        workerLeaseGeneration: recoveredWorkerB.workerLeaseGeneration!,
      };
      await assert.rejects(
        () => invoke(markLearningItemRequestDispatchStarted, {
          secret: args.secret,
          ownerId,
          channelId,
          ...connectorBinding,
          batchKey,
          runId,
          ...workerALease,
          now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 3,
        }, db),
        /worker lease is no longer owned/,
        "a paused stale worker receives no pre-GET permission and therefore makes zero Analytics GETs",
      );
      const recovered = await invoke<{ action: string }>(startLearningItemRequest, {
        secret: args.secret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        runId,
        ...workerBLease,
        now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 3,
      }, db);
      assert.equal(recovered.action, "ambiguous", "an expired worker's post-marker API response is not fetched twice");
      await invoke(markLearningItemAmbiguous, {
        secret: args.secret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        runId,
        ...workerBLease,
        error: "expired worker did not save a response",
        now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 4,
      }, db);
      await assert.rejects(
        () => invoke(prepareLearningLedgerWrite, {
          secret: args.secret,
          ownerId,
          channelId,
          ...connectorBinding,
          batchKey,
          ...workerALease,
          now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 5,
        }, db),
        /worker lease is no longer owned/,
        "a stale worker cannot advance the cursor or discard the recovered worker's batch",
      );
      const prepared = await invoke<{ action: string }>(prepareLearningLedgerWrite, {
        secret: args.secret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        ...workerBLease,
        now: now + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 6,
      }, db);
      assert.equal(prepared.action, "completed_without_ledger_write");
    }
  }

  /* Connector rotation/revocation after request-start has no Analytics GET permission. */
  for (const [scenario, connectorPatch] of [
    ["rotation", { tokenVersion: 2 }],
    ["revocation", { status: "revoked" }],
  ] as const) {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    const connectorBinding = { connectorId, connectorVersion: 1 };
    const admitted = await invoke<{
      action: string;
      batch?: { batchKey: string; ingestionId: string; metricDefinitionVersion?: string };
    }>(admitLearningBatch, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      mode: "history",
      scanStartedAfter: 0,
      scanCursorAfter: "connector-fence-page",
      scanIsDone: false,
      settledBefore: now,
      candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
      now,
    }, db);
    assert.equal(admitted.action, "admitted");
    const batchKey = admitted.batch!.batchKey;
    const worker = await invoke<{
      action: string;
      workerLeaseGeneration?: number;
    }>(claimLearningBatchWorker, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      batchKey,
      workerLeaseToken: `connector-fence-${scenario}`,
      now: now + 1,
    }, db);
    assert.equal(worker.action, "claimed");
    const workerLease = {
      workerLeaseToken: `connector-fence-${scenario}`,
      workerLeaseGeneration: worker.workerLeaseGeneration!,
    };
    const started = await invoke<{ action: string }>(startLearningItemRequest, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 2,
    }, db);
    assert.equal(started.action, "dispatch");
    await db.patch(String(connectorId), connectorPatch);
    const blocked = await invoke<{ action: string; reason?: string }>(markLearningItemRequestDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 3,
    }, db);
    assert.equal(
      blocked.action,
      "manual_reconciliation_required",
      `${scenario} between request-start and the exact dispatch fence must issue zero Analytics GET permission`,
    );
    const progress = db.rows("learningAnalyticsProgress")[0] as unknown as {
      activeBatch?: {
        status: string;
        items: Array<{ requestStatus: string; requestDispatchStartedAt?: number }>;
      };
    };
    assert.equal(progress.activeBatch?.status, "manual_reconciliation_required");
    assert.equal(progress.activeBatch?.items[0]?.requestStatus, "request_started");
    assert.equal(progress.activeBatch?.items[0]?.requestDispatchStartedAt, undefined);
  }

  /* A marker is not reusable permission: a post-marker pause cannot issue a GET. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    const connectorBinding = { connectorId, connectorVersion: 1 };
    const admitted = await invoke<{
      action: string;
      batch?: { batchKey: string; ingestionId: string; metricDefinitionVersion?: string };
    }>(admitLearningBatch, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      mode: "history",
      scanStartedAfter: 0,
      scanCursorAfter: "post-marker-pause",
      scanIsDone: false,
      settledBefore: now,
      candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
      now,
    }, db);
    assert.equal(admitted.batch?.metricDefinitionVersion, LEARNING_ANALYTICS_METRIC_DEFINITION_V2);
    assert.equal(
      (db.rows("analyticsIngestions")[0] as { metricDefinitionVersion?: string }).metricDefinitionVersion,
      LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      "new batches bind their ingestion to the raw engaged-views contract",
    );
    const batchKey = admitted.batch!.batchKey;
    const workerA = await invoke<{ action: string; workerLeaseGeneration?: number }>(claimLearningBatchWorker, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      batchKey,
      workerLeaseToken: "post-marker-a",
      now: now + 1,
    }, db);
    const workerALease = {
      workerLeaseToken: "post-marker-a",
      workerLeaseGeneration: workerA.workerLeaseGeneration!,
    };
    await invoke(startLearningItemRequest, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerALease,
      now: now + 2,
    }, db);
    const marked = await invoke<{
      action: string;
      dispatchCapabilityToken?: string;
    }>(markLearningItemRequestDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerALease,
      now: now + 3,
    }, db);
    assert.equal(marked.action, "fetch");
    assert.ok(marked.dispatchCapabilityToken);

    const reclaimed = await invoke<{ action: string; workerLeaseGeneration?: number }>(claimLearningBatchWorker, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      batchKey,
      workerLeaseToken: "post-marker-b",
      now: now + 3 + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 1,
    }, db);
    assert.equal(reclaimed.action, "claimed");
    let analyticsGets = 0;
    const attemptPostMarkerDispatch = async () => {
      const capability = await invoke<{ action: string }>(consumeLearningItemRequestDispatchCapability, {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        runId,
        ...workerALease,
        dispatchCapabilityToken: marked.dispatchCapabilityToken,
        now: now + 3 + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS + 2,
      }, db);
      if (capability.action === "fetch") analyticsGets++;
    };
    await assert.rejects(
      attemptPostMarkerDispatch,
      /worker lease is no longer owned/,
      "a worker paused after its first marker cannot consume a GET capability after recovery",
    );
    assert.equal(analyticsGets, 0, "an expired post-marker worker issues zero Analytics GETs");
  }

  /* Connector rotation after the first marker blocks the final capability, before any GET. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    const connectorBinding = { connectorId, connectorVersion: 1 };
    const admitted = await invoke<{ action: string; batch?: { batchKey: string } }>(admitLearningBatch, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      mode: "history",
      scanStartedAfter: 0,
      scanCursorAfter: "post-marker-rotation",
      scanIsDone: false,
      settledBefore: now,
      candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
      now,
    }, db);
    const batchKey = admitted.batch!.batchKey;
    const worker = await invoke<{ action: string; workerLeaseGeneration?: number }>(claimLearningBatchWorker, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      batchKey,
      workerLeaseToken: "post-marker-rotation",
      now: now + 1,
    }, db);
    const workerLease = {
      workerLeaseToken: "post-marker-rotation",
      workerLeaseGeneration: worker.workerLeaseGeneration!,
    };
    await invoke(startLearningItemRequest, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 2,
    }, db);
    const marked = await invoke<{
      action: string;
      dispatchCapabilityToken?: string;
    }>(markLearningItemRequestDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 3,
    }, db);
    await db.patch(String(connectorId), { tokenVersion: 2 });
    let analyticsGets = 0;
    const consumed = await invoke<{ action: string }>(consumeLearningItemRequestDispatchCapability, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      dispatchCapabilityToken: marked.dispatchCapabilityToken,
      now: now + 4,
    }, db);
    if (consumed.action === "fetch") analyticsGets++;
    assert.equal(consumed.action, "manual_reconciliation_required");
    assert.equal(analyticsGets, 0, "a rotated connector receives zero post-marker Analytics GET permission");
  }

  /* The normal path consumes once, persists the response, and starts within its short window. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    const connectorBinding = { connectorId, connectorVersion: 1 };
    const admitted = await invoke<{
      action: string;
      batch?: { batchKey: string; ingestionId: string; metricDefinitionVersion?: string };
    }>(admitLearningBatch, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      mode: "history",
      scanStartedAfter: 0,
      scanCursorAfter: "post-marker-normal",
      scanIsDone: false,
      settledBefore: now,
      candidates: [{ runId, youtubeVideoId: "video-learning-1", publishedAt: 1_000 }],
      now,
    }, db);
    assert.equal(admitted.batch?.metricDefinitionVersion, LEARNING_ANALYTICS_METRIC_DEFINITION_V2);
    assert.equal(
      (db.rows("analyticsIngestions")[0] as { metricDefinitionVersion?: string }).metricDefinitionVersion,
      LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      "new batches bind their ingestion to the raw engaged-views contract",
    );
    const batchKey = admitted.batch!.batchKey;
    const worker = await invoke<{ action: string; workerLeaseGeneration?: number }>(claimLearningBatchWorker, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      batchKey,
      workerLeaseToken: "post-marker-normal",
      now: now + 1,
    }, db);
    const workerLease = {
      workerLeaseToken: "post-marker-normal",
      workerLeaseGeneration: worker.workerLeaseGeneration!,
    };
    await invoke(startLearningItemRequest, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 2,
    }, db);
    const marked = await invoke<{
      action: string;
      dispatchCapabilityToken?: string;
    }>(markLearningItemRequestDispatchStarted, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      now: now + 3,
    }, db);
    const consumed = await invoke<{
      action: string;
      httpDispatchDeadlineAt?: number;
    }>(consumeLearningItemRequestDispatchCapability, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      dispatchCapabilityToken: marked.dispatchCapabilityToken,
      now: now + 4,
    }, db);
    assert.equal(consumed.action, "fetch");
    assertLearningAnalyticsHttpDispatchWindow({ deadlineAt: consumed.httpDispatchDeadlineAt! }, now + 4);
    await assert.rejects(
      () => invoke(recordLearningItemFetched, {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey,
        runId,
        ...workerLease,
        views: 42,
        avgViewPct: 57,
        title: "normal exact flow",
        topic: "safety",
        now: now + 5,
      }, db),
      /v2 response is missing engaged views/,
      "v2 cannot silently turn a missing provider field into zero",
    );
    const persisted = await invoke<{ item?: { requestStatus?: string; engagedViews?: number } }>(recordLearningItemFetched, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      views: 42,
      engagedViews: 31,
      avgViewPct: 57,
      title: "normal exact flow",
      topic: "safety",
      now: now + 5,
    }, db);
    assert.equal(persisted.item?.requestStatus, "fetched");
    assert.equal(persisted.item?.engagedViews, 31);
    const replay = await invoke<{ action: string }>(consumeLearningItemRequestDispatchCapability, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      runId,
      ...workerLease,
      dispatchCapabilityToken: marked.dispatchCapabilityToken,
      now: now + 6,
    }, db);
    assert.equal(replay.action, "ambiguous", "a consumed capability cannot authorize a second GET");
    const prepared = await invoke<{
      action: string;
      ledgerFingerprint?: string;
      batch?: { ingestionId: string; metricDefinitionVersion?: string };
      items?: Array<{ engagedViews?: number }>;
    }>(prepareLearningLedgerWrite, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey,
      ...workerLease,
      now: now + 7,
    }, db);
    assert.equal(prepared.action, "write");
    assert.equal(prepared.items?.[0]?.engagedViews, 31);
    const v2Fingerprint = sha256Hex(JSON.stringify([{
      videoId: "video-learning-1",
      publishedAt: 1_000,
      views: 42,
      engagedViews: 31,
      avgViewPct: 57,
      ctr: undefined,
      title: "normal exact flow",
      topic: "safety",
      thumbnailStrategy: undefined,
      metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      ingestionId: prepared.batch!.ingestionId,
    }]));
    assert.equal(prepared.ledgerFingerprint, v2Fingerprint, "engaged views bind the ledger write receipt");
    const changedEngagementFingerprint = sha256Hex(JSON.stringify([{
      videoId: "video-learning-1",
      publishedAt: 1_000,
      views: 42,
      engagedViews: 30,
      avgViewPct: 57,
      ctr: undefined,
      title: "normal exact flow",
      topic: "safety",
      thumbnailStrategy: undefined,
      metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
      ingestionId: prepared.batch!.ingestionId,
    }]));
    assert.notEqual(prepared.ledgerFingerprint, changedEngagementFingerprint);
  }

  /* An unversioned in-flight batch is legacy v1 and remains ledger-compatible. */
  {
    const { db, ownerId, channelId, connectorId, runId } = seededDb();
    const ingestionId = db.seed("analyticsIngestions", {
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      source: "youtube_analytics_api",
      metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V1,
      status: "running",
      recordsWritten: 0,
      startedAt: now,
    }, "analyticsIngestions:legacy-v1") as Id<"analyticsIngestions">;
    const batchKey = "legacy-v1-active-batch";
    db.seed("learningAnalyticsProgress", {
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      processedVideoIds: [],
      activeBatch: {
        batchKey,
        mode: "history",
        scanStartedAfter: 0,
        scanIsDone: true,
        ingestionId,
        connectorId,
        connectorVersion: 1,
        status: "collecting",
        items: [{
          runId,
          youtubeVideoId: "video-learning-1",
          publishedAt: 1_000,
          requestStatus: "fetched",
          views: 42,
          avgViewPct: 57,
          title: "legacy exact flow",
          topic: "compatibility",
        }],
        createdAt: now,
        updatedAt: now,
      },
    }, "learningAnalyticsProgress:legacy-v1");
    const worker = await invoke<{ action: string; workerLeaseGeneration?: number }>(
      claimLearningBatchWorker,
      {
        secret: TEST_SECRET,
        ownerId,
        channelId,
        batchKey,
        workerLeaseToken: "legacy-v1-worker",
        now: now + 1,
      },
      db,
    );
    assert.equal(worker.action, "claimed");
    const prepared = await invoke<{
      action: string;
      ledgerFingerprint?: string;
      batch?: { ingestionId: string; metricDefinitionVersion?: string };
      items?: Array<{ engagedViews?: number }>;
    }>(prepareLearningLedgerWrite, {
      secret: TEST_SECRET,
      ownerId,
      channelId,
      connectorId,
      connectorVersion: 1,
      batchKey,
      workerLeaseToken: "legacy-v1-worker",
      workerLeaseGeneration: worker.workerLeaseGeneration!,
      now: now + 2,
    }, db);
    assert.equal(prepared.action, "write");
    assert.equal(prepared.batch?.metricDefinitionVersion, undefined);
    assert.equal(prepared.items?.[0]?.engagedViews, undefined);
    assert.equal(
      prepared.ledgerFingerprint,
      sha256Hex(JSON.stringify([{
        videoId: "video-learning-1",
        publishedAt: 1_000,
        views: 42,
        engagedViews: undefined,
        avgViewPct: 57,
        ctr: undefined,
        title: "legacy exact flow",
        topic: "compatibility",
        thumbnailStrategy: undefined,
        metricDefinitionVersion: LEARNING_ANALYTICS_METRIC_DEFINITION_V1,
        ingestionId,
      }])),
      "legacy receipt keeps the original v1 metric definition and no engaged field",
    );
  }

  /* The actual HTTP helper checks its capability before touching its transport. */
  {
    const originalFetch = globalThis.fetch;
    let outboundRequests = 0;
    const outboundMetrics: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      outboundRequests++;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const metrics = new URL(url).searchParams.get("metrics") ?? "";
      outboundMetrics.push(metrics);
      if (metrics === "videoThumbnailImpressionsClickRate") {
        return new Response(JSON.stringify({
          columnHeaders: [{ name: "videoThumbnailImpressionsClickRate" }],
          rows: [[4.5]],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        columnHeaders: [
          { name: "views" },
          ...(metrics.includes("engagedViews") ? [{ name: "engagedViews" }] : []),
          { name: "averageViewPercentage" },
          { name: "averageViewDuration" },
          { name: "estimatedMinutesWatched" },
        ],
        rows: [
          metrics.includes("engagedViews")
            ? [42, 31, 57, 12, 8]
            : [42, 57, 12, 8],
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => fetchVideoAnalytics({
          videoId: "video-learning-1",
          startDate: "2026-01-01",
          endDate: "2026-01-02",
          refreshToken: "unused-with-access-token",
          accessToken: "test-access-token",
          includeEngagedViews: true,
          beforeRequest: () => assertLearningAnalyticsHttpDispatchWindow({ deadlineAt: Date.now() - 1 }),
        }),
        /dispatch capability expired/,
      );
      assert.equal(outboundRequests, 0, "an expired local window reaches zero provider GETs");
      const v1 = await fetchVideoAnalytics({
        videoId: "video-learning-1",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        refreshToken: "unused-with-access-token",
        accessToken: "test-access-token",
        beforeRequest: () => assertLearningAnalyticsHttpDispatchWindow({
          deadlineAt: Date.now() + LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
        }),
      });
      assert.equal(v1?.views, 42);
      assert.equal(v1?.engagedViews, undefined, "legacy v1 requests preserve their original shape");
      assert.equal(outboundRequests, 2, "a legacy flow performs only its bounded core and CTR GETs");
      assert.equal(outboundMetrics.filter((metric) => metric.includes("engagedViews")).length, 0);

      outboundRequests = 0;
      outboundMetrics.length = 0;
      const v2 = await fetchVideoAnalytics({
        videoId: "video-learning-1",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        refreshToken: "unused-with-access-token",
        accessToken: "test-access-token",
        includeEngagedViews: true,
        beforeRequest: () => assertLearningAnalyticsHttpDispatchWindow({
          deadlineAt: Date.now() + LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
        }),
      });
      assert.equal(v2?.engagedViews, 31);
      assert.equal(outboundRequests, 2, "v2 adds engaged views to the core GET instead of making an extra GET");
      assert.equal(outboundMetrics.filter((metric) => metric.includes("engagedViews")).length, 1);
      assert.equal(outboundMetrics.some((metric) => metric.includes("swiped")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const firstPlan = planLearningAnalyticsScan(null, now);
  assert.deepEqual(firstPlan, { kind: "history", startedAfter: 0 });
  const frozenFreshness = planLearningAnalyticsScan({
    historyCompletedAt: now - 1,
    freshnessWindowStartedAfter: 123,
    freshnessCursor: "cursor-1",
  }, now);
  assert.deepEqual(frozenFreshness, { kind: "freshness", startedAfter: 123, cursor: "cursor-1" });
  const idle = planLearningAnalyticsScan({
    historyCompletedAt: now - 1,
    freshnessNextAt: now + LEARNING_ANALYTICS_FRESHNESS_CADENCE_MS,
  }, now);
  assert.equal(idle.kind, "idle");

  const learn = readFileSync(resolve(process.cwd(), "src/trigger/learn.ts"), "utf8");
  assert.ok(
    learn.indexOf("claimShowBibleProposal") < learn.indexOf("await agentJson"),
    "Show Bible proposal claim must be admitted before agentJson can cross the model boundary",
  );
  assert.ok(
    learn.indexOf("markShowBibleProviderStarted") < learn.indexOf("await agentJson"),
    "the durable provider-start marker must precede agentJson",
  );
  assert.ok(
    learn.indexOf("markShowBibleProviderDispatchStarted") < learn.indexOf("await agentJson"),
    "the durable dispatch-start marker must precede agentJson",
  );
  assert.match(learn, /claimLearningBatchWorker/, "a batch worker lease is acquired before external Analytics work");
  assert.ok(
    learn.indexOf("markLearningItemRequestDispatchStarted") < learn.indexOf("await fetchVideoAnalytics"),
    "the exact leased Analytics dispatch marker must precede every Analytics GET",
  );
  assert.ok(
    learn.indexOf("consumeLearningItemRequestDispatchCapability") < learn.indexOf("await fetchVideoAnalytics"),
    "a short-lived, connector- and lease-bound capability is consumed immediately before every Analytics GET",
  );
  assert.match(
    learn,
    /timeoutMs: LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS/,
    "the lease-fenced Analytics GET is passed its bounded timeout",
  );
  assert.doesNotMatch(learn, /listRunHistorySince\(convex, ch\._id, 0\)/, "daily learning no longer restarts its full historical scan");
  assert.match(learn, /numItems: LEARNING_ANALYTICS_BATCH_LIMIT/, "the run-history page is bounded before any external Analytics request");
  const learningRoute = readFileSync(resolve(process.cwd(), "src/app/api/learning-recommendations/route.ts"), "utf8");
  assert.match(learningRoute, /rearm_show_bible_no_dispatch/, "the owner-facing API exposes the no-dispatch recovery action");
  assert.match(learningRoute, /resolveShowBibleProviderStartedNoDispatch/, "the owner-facing API is connected to the audited recovery mutation");
  assert.equal(LEARNING_ANALYTICS_BATCH_LIMIT, 12, "the daily external request envelope is explicitly small");
  assert.ok(
    LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS < LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
    "an Analytics GET timeout remains shorter than its worker lease",
  );

  console.log("learning cost guard tests passed");
}

run();
