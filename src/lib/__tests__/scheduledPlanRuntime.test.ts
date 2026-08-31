import assert from "node:assert/strict";
import {
  claimNextPlanRun,
  completeClaimedPlanRun,
  failClaimedPlanRun,
  getClaimedPlanItemForRun,
  listPlanByOwner,
} from "../../../convex/contentPlan";
import { createNarrativeSeriesRunSelector } from "@/lib/narrativeSeriesRunAdmission";
import { topicSelect } from "@/trigger/blocks/lofiBlocks";
import {
  assertScheduledPlanPayloadMatches,
  assertScheduledPublishIsFuture,
  DEFAULT_PLAN_GENERATION_LEAD_MS,
  parsePlanGenerationLeadMs,
  resolveScheduledPublishAtMs,
  scheduledPlanSeed,
  selectDueScheduledPlanItem,
  selectUnpinnedPlanItem,
  type ScheduledPlanRunPayload,
} from "@/lib/scheduledPlanRuntime";
import { markLeaseRecoveryDispatched, reapExpiredRunLeases } from "../../../convex/runs";
import {
  MAX_AUTOMATIC_LEASE_RECOVERIES,
  RUN_EXECUTION_LEASE_MS,
  RUN_QUEUE_LEASE_MS,
} from "@/lib/runLease";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; op: "eq" | "gt" | "lte"; value: unknown };

class MemoryQuery {
  private readonly filters: Filter[] = [];
  private direction: "asc" | "desc" = "asc";
  private indexName = "";

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(name: string, build: (q: unknown) => unknown): this {
    this.indexName = name;
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, op: "eq", value });
        return range;
      },
      lte: (field: string, value: unknown) => {
        this.filters.push({ field, op: "lte", value });
        return range;
      },
      gt: (field: string, value: unknown) => {
        this.filters.push({ field, op: "gt", value });
        return range;
      },
    };
    build(range);
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.direction = direction;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(({ field, op, value }) => {
      if (op === "eq") return row[field] === value;
      const actual = row[field];
      if (op === "lte") {
        return typeof actual === "number" && typeof value === "number" && actual <= value;
      }
      // Convex index ordering places undefined before every concrete value.
      if (value === undefined) return actual !== undefined;
      return typeof actual === "number" && typeof value === "number" && actual > value;
    });
  }

  async collect(): Promise<Row[]> {
    const rows = this.db.rows(this.table).filter((row) => this.matches(row));
    const field = this.indexName.includes("lease_expires")
      ? "leaseExpiresAt"
      : this.indexName.includes("schedule")
      ? "scheduledAt"
      : this.indexName.includes("order")
        ? "order"
        : "_creationTime";
    rows.sort((left, right) => Number(left[field] ?? 0) - Number(right[field] ?? 0));
    if (this.direction === "desc") rows.reverse();
    return rows;
  }

  async first(): Promise<Row | null> {
    return (await this.collect())[0] ?? null;
  }

  async take(count: number): Promise<Row[]> {
    return (await this.collect()).slice(0, count);
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
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
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

async function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  const runtime = definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  };
  return runtime._handler(ctx, args);
}

function seedChannel(db: MemoryDb, schedule: Record<string, unknown>, id = "channels:test") {
  db.seed("channels", {
    ownerId: "owner-test",
    name: "Test Channel",
    slug: "test-channel",
    status: "active",
    identity: { cadence: "daily" },
    schedule,
  }, id);
  return id;
}

function seedReadyPlan(db: MemoryDb, channelId: string, args: {
  id: string;
  order: number;
  scheduledAt?: number;
  topic?: string;
}) {
  db.seed("contentPlan", {
    ownerId: "owner-test",
    channelId,
    order: args.order,
    topic: args.topic ?? `Topic ${args.order}`,
    title: `Title ${args.order}`,
    thumbnailKey: `owner/owner-test/channel/test/plan/${args.id}.jpg`,
    status: "ready",
    generationState: "complete",
    createdAt: Date.now() - 1_000,
    ...(args.scheduledAt !== undefined ? { scheduledAt: args.scheduledAt } : {}),
  }, args.id);
}

async function main() {
  const now = Date.now();
  assert.equal(parsePlanGenerationLeadMs(), DEFAULT_PLAN_GENERATION_LEAD_MS);
  assert.equal(parsePlanGenerationLeadMs("36"), 36 * 60 * 60 * 1_000);
  assert.throws(() => parsePlanGenerationLeadMs("0"), /between 1 and 168/);

  const candidates = [
    {
      planItemId: "late",
      topic: "Later",
      title: "Later title",
      thumbnailKey: "late.jpg",
      status: "ready",
      order: 0,
      scheduledAt: now + 25 * 60 * 60 * 1_000,
    },
    {
      planItemId: "due",
      topic: "Exact due topic",
      title: "Exact due title",
      thumbnailKey: "due.jpg",
      status: "ready",
      order: 1,
      scheduledAt: now + 23 * 60 * 60 * 1_000,
    },
  ];
  assert.equal(
    selectDueScheduledPlanItem(candidates, now + DEFAULT_PLAN_GENERATION_LEAD_MS)?.planItemId,
    "due",
  );
  assert.equal(selectDueScheduledPlanItem(candidates, now + 22 * 60 * 60 * 1_000), undefined);
  assert.equal(
    selectUnpinnedPlanItem([
      ...candidates,
      { ...candidates[0], planItemId: "unpinned", scheduledAt: undefined, order: 3 },
    ])?.planItemId,
    "unpinned",
  );

  // Optional fields sort before numbers in Convex indexes. The pinned query's
  // explicit lower bound must stop >32 unpinned rows from filling its bounded
  // read and hiding the genuinely due pin.
  const crowdedDb = new MemoryDb();
  const crowdedChannel = seedChannel(crowdedDb, { enabled: false, timezone: "UTC", localTime: "00:00" });
  for (let order = 0; order < 40; order++) {
    seedReadyPlan(crowdedDb, crowdedChannel, {
      id: `contentPlan:crowded-${order}`,
      order,
    });
  }
  const crowdedScheduledAt = Date.now() + 3 * 60 * 60 * 1_000;
  seedReadyPlan(crowdedDb, crowdedChannel, {
    id: "contentPlan:crowded-due",
    order: 40,
    scheduledAt: crowdedScheduledAt,
    topic: "Pinned item must not be hidden",
  });
  const crowdedClaim = await invoke<{ state: string; planItemId: string; scheduledAt: number }>(
    claimNextPlanRun,
    testContext(crowdedDb),
    {
      ownerId: "owner-test",
      channelId: crowdedChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(crowdedClaim.state, "claimed");
  assert.equal(crowdedClaim.planItemId, "contentPlan:crowded-due");
  assert.equal(crowdedClaim.scheduledAt, crowdedScheduledAt);
  assert.equal(crowdedDb.rows("runs").length, 1);

  // A future native publish timestamp is claimed inside the lead window, not
  // at the deadline. Replaying the scheduler mutation returns the same queued
  // run and never inserts a second run.
  const db = new MemoryDb();
  const channelId = seedChannel(db, { enabled: false, timezone: "UTC", localTime: "00:00" });
  seedReadyPlan(db, channelId, {
    id: "contentPlan:later",
    order: 0,
    scheduledAt: now + 25 * 60 * 60 * 1_000,
  });
  seedReadyPlan(db, channelId, {
    id: "contentPlan:due",
    order: 1,
    scheduledAt: now + 23 * 60 * 60 * 1_000,
    topic: "Exact due topic",
  });
  const ctx = testContext(db);
  const claimArgs = {
    ownerId: "owner-test",
    channelId,
    dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
  };
  await assert.rejects(
    invoke(claimNextPlanRun, testContext(db, "owner-test", "owner"), claimArgs),
    /service identity/,
  );
  const first = await invoke<{
    state: string;
    reused: boolean;
    runId: string;
    planItemId: string;
    topic: string;
    title: string;
    thumbnailKey: string;
    scheduledAt: number;
  }>(claimNextPlanRun, ctx, claimArgs);
  assert.equal(first.state, "claimed");
  assert.equal(first.reused, false);
  assert.equal(first.planItemId, "contentPlan:due");
  assert.equal(first.topic, "Exact due topic");
  assert.equal(first.scheduledAt, candidates[1].scheduledAt);
  const replay = await invoke<typeof first>(claimNextPlanRun, ctx, claimArgs);
  assert.equal(replay.state, "claimed");
  assert.equal(replay.reused, true);
  assert.equal(replay.runId, first.runId);
  assert.equal(db.rows("runs").length, 1);

  const durable = await invoke<ScheduledPlanRunPayload>(getClaimedPlanItemForRun, ctx, {
    ownerId: "owner-test",
    channelId,
    itemId: first.planItemId,
    runId: first.runId,
  });
  assert.deepEqual(assertScheduledPlanPayloadMatches(first, durable), durable);
  const seed = scheduledPlanSeed(durable);
  assert.deepEqual(seed, {
    planItemId: first.planItemId,
    plannedTopic: first.topic,
    plannedTitle: first.title,
    plannedThumbnailKey: first.thumbnailKey,
    scheduledPublishAt: first.scheduledAt,
  });
  const topicOutput = await topicSelect.run({
    store: seed,
    log: () => {},
  } as never);
  assert.equal(topicOutput.topic, first.topic);

  const nativePublishAt = resolveScheduledPublishAtMs({
    publishMode: "scheduled",
    pinnedScheduledAt: first.scheduledAt,
    runStartedAt: now,
    runId: first.runId,
    publishOffsetHours: 99,
    publishJitterHours: 99,
  });
  assert.equal(nativePublishAt, first.scheduledAt);
  assertScheduledPublishIsFuture(nativePublishAt!, now);
  assert.throws(() => assertScheduledPublishIsFuture(now, now), /no longer safely in the future/);

  db.seed("runStages", {
    ownerId: "owner-test",
    runId: first.runId,
    block: "final_output",
    status: "ok",
    cost: 1.25,
    outputs: { videoKey: "owner/test/final.mp4" },
  }, "runStages:ok");
  const completed = await invoke<{ state: string; reused: boolean }>(completeClaimedPlanRun, ctx, {
    ownerId: "owner-test",
    channelId,
    itemId: first.planItemId,
    runId: first.runId,
    finishedAt: now + 2_000,
    costTotal: 1.25,
  });
  assert.deepEqual(completed, { state: "used", reused: false });
  assert.equal((await db.get(first.planItemId))?.status, "used");
  assert.equal((await db.get(first.runId))?.status, "ok");
  assert.equal(db.rows("topicMemory").length, 1);
  const completionReplay = await invoke<{ state: string; reused: boolean }>(completeClaimedPlanRun, ctx, {
    ownerId: "owner-test",
    channelId,
    itemId: first.planItemId,
    runId: first.runId,
    finishedAt: now + 3_000,
    costTotal: 1.25,
  });
  assert.deepEqual(completionReplay, { state: "used", reused: true });
  assert.equal(db.rows("topicMemory").length, 1);
  const calendarRows = await invoke<Row[]>(listPlanByOwner, ctx, { ownerId: "owner-test" });
  assert.equal(calendarRows.some((row) => row._id === first.planItemId), false);

  // An unpinned ready row remains connected to normal cadence and carries the
  // same exact content contract, but no native publish override.
  const cadenceDb = new MemoryDb();
  const cadenceChannel = seedChannel(cadenceDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  seedReadyPlan(cadenceDb, cadenceChannel, { id: "contentPlan:unpinned", order: 0 });
  const cadenceClaim = await invoke<{ state: string; planItemId: string; scheduledAt?: number }>(
    claimNextPlanRun,
    testContext(cadenceDb),
    {
      ownerId: "owner-test",
      channelId: cadenceChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(cadenceClaim.state, "claimed");
  assert.equal(cadenceClaim.planItemId, "contentPlan:unpinned");
  assert.equal(cadenceClaim.scheduledAt, undefined);

  // A ready item with an incomplete planner artifact is visible and blocks
  // cadence admission. It must never be silently bypassed by a free-topic run.
  const incompleteDb = new MemoryDb();
  const incompleteChannel = seedChannel(incompleteDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  incompleteDb.seed("contentPlan", {
    ownerId: "owner-test",
    channelId: incompleteChannel,
    order: 0,
    topic: "Planner output missing its thumbnail",
    title: "Incomplete planner output",
    status: "ready",
    generationState: "complete",
    createdAt: Date.now() - 1_000,
  }, "contentPlan:incomplete");
  const incompleteClaim = await invoke<{ state: string; planItemId: string; reason: string }>(
    claimNextPlanRun,
    testContext(incompleteDb),
    {
      ownerId: "owner-test",
      channelId: incompleteChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(incompleteClaim.state, "blocked");
  assert.equal(incompleteClaim.planItemId, "contentPlan:incomplete");
  assert.match(incompleteClaim.reason, /no admitted thumbnail/);
  assert.match(String((await incompleteDb.get("contentPlan:incomplete"))?.scheduledFailure), /no admitted thumbnail/);
  assert.equal(incompleteDb.rows("runs").length, 0);

  // A stale or too-near pin fails before a run exists, so no pipeline or paid
  // provider can start; the plan row retains a visible repair instruction.
  const staleDb = new MemoryDb();
  const staleChannel = seedChannel(staleDb, { enabled: false, timezone: "UTC", localTime: "00:00" });
  seedReadyPlan(staleDb, staleChannel, {
    id: "contentPlan:stale",
    order: 0,
    scheduledAt: Date.now() + 60 * 60 * 1_000,
  });
  const staleClaim = await invoke<{ state: string; planItemId: string; reason: string }>(
    claimNextPlanRun,
    testContext(staleDb),
    {
      ownerId: "owner-test",
      channelId: staleChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(staleClaim.state, "blocked");
  assert.equal(staleClaim.planItemId, "contentPlan:stale");
  assert.match(staleClaim.reason, /at least 2 hours ahead/);
  assert.match(String((await staleDb.get("contentPlan:stale"))?.scheduledFailure), /at least 2 hours ahead/);
  assert.equal(staleDb.rows("runs").length, 0);

  // A ready queue containing only a future pin remains authoritative even
  // when ordinary cadence is due. Free-topic generation is not a bypass.
  const futureDb = new MemoryDb();
  const futureChannel = seedChannel(futureDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  const futureScheduledAt = Date.now() + 48 * 60 * 60 * 1_000;
  seedReadyPlan(futureDb, futureChannel, {
    id: "contentPlan:future",
    order: 0,
    scheduledAt: futureScheduledAt,
  });
  const futureClaim = await invoke<{ state: string; nextScheduledAt: number }>(
    claimNextPlanRun,
    testContext(futureDb),
    {
      ownerId: "owner-test",
      channelId: futureChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(futureClaim.state, "not_due");
  assert.equal(futureClaim.nextScheduledAt, futureScheduledAt);
  assert.equal(futureDb.rows("runs").length, 0);

  // Legacy free-topic cadence remains available only when the ready queue is
  // actually empty, and its queued run is replayed exactly once.
  const emptyDb = new MemoryDb();
  const emptyChannel = seedChannel(emptyDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  const emptyArgs = {
    ownerId: "owner-test",
    channelId: emptyChannel,
    dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
  };
  const emptyClaim = await invoke<{ state: string; reused: boolean; runId: string }>(
    claimNextPlanRun,
    testContext(emptyDb),
    emptyArgs,
  );
  const emptyReplay = await invoke<typeof emptyClaim>(
    claimNextPlanRun,
    testContext(emptyDb),
    emptyArgs,
  );
  assert.equal(emptyClaim.state, "cadence");
  assert.equal(emptyClaim.reused, false);
  assert.equal(emptyReplay.state, "cadence");
  assert.equal(emptyReplay.reused, true);
  assert.equal(emptyReplay.runId, emptyClaim.runId);
  assert.equal(emptyDb.rows("runs").length, 1);

  // A serialized horizon gets a run with its exact selector persisted. It
  // cannot be converted into a generic plan run on replay, and a generic
  // ready-plan queue explicitly blocks rather than silently taking authority.
  const serialDb = new MemoryDb();
  const serialChannel = seedChannel(serialDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  const serialSelector = createNarrativeSeriesRunSelector({
    version: "narrative-series-run-selector/v1",
    seriesPlanFingerprint: "d".repeat(64),
    seriesIdentity: "serialized_program_episode/v1/serial-route/signals/8",
    routeFingerprint: "e".repeat(64),
    routeRunSeedFingerprint: "f".repeat(64),
    programBriefFingerprint: "1".repeat(64),
    acceptedCharacterAdapters: [],
  });
  await serialDb.patch(serialChannel, {
    identity: {
      cadence: "daily",
      narrativeSeriesPlan: {
        fingerprint: serialSelector.seriesPlanFingerprint,
      },
    },
  });
  const serialArgs = {
    ownerId: "owner-test",
    channelId: serialChannel,
    dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    narrativeSeriesSelector: serialSelector,
  };
  const serialClaim = await invoke<{
    state: string;
    reused: boolean;
    runId: string;
    narrativeSeriesSelector: typeof serialSelector;
  }>(claimNextPlanRun, testContext(serialDb), serialArgs);
  assert.equal(serialClaim.state, "cadence");
  assert.equal(serialClaim.reused, false);
  assert.equal(serialClaim.narrativeSeriesSelector.fingerprint, serialSelector.fingerprint);
  const persistedSerialRun = await serialDb.get(serialClaim.runId) as {
    narrativeSeriesSelector?: { fingerprint?: string };
  } | undefined;
  assert.equal(persistedSerialRun?.narrativeSeriesSelector?.fingerprint, serialSelector.fingerprint);
  const serialReplay = await invoke<typeof serialClaim>(claimNextPlanRun, testContext(serialDb), serialArgs);
  assert.equal(serialReplay.reused, true);
  assert.equal(serialReplay.runId, serialClaim.runId);

  const serialPlanDb = new MemoryDb();
  const serialPlanChannel = seedChannel(serialPlanDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  await serialPlanDb.patch(serialPlanChannel, {
    identity: {
      cadence: "daily",
      narrativeSeriesPlan: { fingerprint: serialSelector.seriesPlanFingerprint },
    },
  });
  seedReadyPlan(serialPlanDb, serialPlanChannel, { id: "contentPlan:serial-conflict", order: 0 });
  const serialPlanClaim = await invoke<{ state: string; reason: string }>(claimNextPlanRun, testContext(serialPlanDb), {
    ...serialArgs,
    channelId: serialPlanChannel,
  });
  assert.equal(serialPlanClaim.state, "blocked");
  assert.match(serialPlanClaim.reason, /generic ready content plan/);
  assert.equal(serialPlanDb.rows("runs").length, 0);

  // Failure is durable but never marks used or releases the item to a new run.
  const failureDb = new MemoryDb();
  const failureChannel = seedChannel(failureDb, { enabled: false, timezone: "UTC", localTime: "00:00" });
  seedReadyPlan(failureDb, failureChannel, {
    id: "contentPlan:failure",
    order: 0,
    scheduledAt: Date.now() + 3 * 60 * 60 * 1_000,
  });
  const failureCtx = testContext(failureDb);
  const failureArgs = {
    ownerId: "owner-test",
    channelId: failureChannel,
    dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
  };
  const failureClaim = await invoke<{ state: string; runId: string; planItemId: string }>(
    claimNextPlanRun,
    failureCtx,
    failureArgs,
  );
  failureDb.seed("runStages", {
    ownerId: "owner-test",
    runId: failureClaim.runId,
    block: "render",
    status: "failed",
    cost: 0.4,
  }, "runStages:failed");
  await invoke(failClaimedPlanRun, failureCtx, {
    ownerId: "owner-test",
    channelId: failureChannel,
    itemId: failureClaim.planItemId,
    runId: failureClaim.runId,
    failedAt: Date.now(),
    error: "render failed after provider admission",
    costTotal: 0.4,
  });
  assert.equal((await failureDb.get(failureClaim.planItemId))?.status, "ready");
  await assert.rejects(
    invoke(completeClaimedPlanRun, failureCtx, {
      ownerId: "owner-test",
      channelId: failureChannel,
      itemId: failureClaim.planItemId,
      runId: failureClaim.runId,
      finishedAt: Date.now(),
      costTotal: 0.4,
    }),
    /before durable pipeline stages succeed/,
  );
  const blocked = await invoke<{ state: string; runId: string }>(claimNextPlanRun, failureCtx, failureArgs);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.runId, failureClaim.runId);
  assert.equal(failureDb.rows("runs").length, 1);

  // A queued run that never froze an invocation is replaced and its exact
  // scheduled fence is atomically released by the provider-free lease reaper.
  const queuedRecoveryDb = new MemoryDb();
  const queuedRecoveryChannel = seedChannel(queuedRecoveryDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  const queuedRecoveryItem = "contentPlan:queued-recovery";
  const queuedRecoveryRun = "runs:queued-recovery";
  const queuedPublishAt = Date.now() + 4 * 60 * 60_000;
  seedReadyPlan(queuedRecoveryDb, queuedRecoveryChannel, {
    id: queuedRecoveryItem,
    order: 0,
    scheduledAt: queuedPublishAt,
  });
  await queuedRecoveryDb.patch(queuedRecoveryItem, {
    scheduledRunId: queuedRecoveryRun,
    scheduledClaimedAt: Date.now() - RUN_QUEUE_LEASE_MS,
  });
  queuedRecoveryDb.seed("runs", {
    ownerId: "owner-test",
    channelId: queuedRecoveryChannel,
    status: "queued",
    startedAt: Date.now() - RUN_QUEUE_LEASE_MS - 5_000,
    heartbeatAt: Date.now() - RUN_QUEUE_LEASE_MS - 5_000,
    leaseExpiresAt: Date.now() - 5_000,
    costTotal: 0,
    planItemId: queuedRecoveryItem,
    plannedTopic: "Topic 0",
    plannedTitle: "Title 0",
    plannedThumbnailKey: `owner/owner-test/channel/test/plan/${queuedRecoveryItem}.jpg`,
    plannedPublishAt: queuedPublishAt,
  }, queuedRecoveryRun);
  await invoke(reapExpiredRunLeases, testContext(queuedRecoveryDb), {});
  assert.equal((await queuedRecoveryDb.get(queuedRecoveryRun))?.status, "failed");
  assert.equal((await queuedRecoveryDb.get(queuedRecoveryItem))?.scheduledRunId, undefined);
  const queuedReplacement = await invoke<{ state: string; reused: boolean; runId: string }>(
    claimNextPlanRun,
    testContext(queuedRecoveryDb),
    {
      ownerId: "owner-test",
      channelId: queuedRecoveryChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(queuedReplacement.state, "claimed");
  assert.equal(queuedReplacement.reused, false);
  assert.notEqual(queuedReplacement.runId, queuedRecoveryRun);

  // A dead worker that did freeze a hash-bound invocation keeps the scheduled
  // fence and is re-dispatched with the same run id so completed paid stages
  // remain resumable.
  const resumeDb = new MemoryDb();
  const resumeChannel = seedChannel(resumeDb, {
    enabled: true,
    frequency: "daily",
    timezone: "UTC",
    localTime: "00:00",
  });
  const resumeItem = "contentPlan:resume";
  const resumeRun = "runs:resume";
  const resumePublishAt = Date.now() + 4 * 60 * 60_000;
  seedReadyPlan(resumeDb, resumeChannel, {
    id: resumeItem,
    order: 0,
    scheduledAt: resumePublishAt,
  });
  await resumeDb.patch(resumeItem, {
    scheduledRunId: resumeRun,
    scheduledClaimedAt: Date.now() - RUN_EXECUTION_LEASE_MS,
  });
  resumeDb.seed("runs", {
    ownerId: "owner-test",
    channelId: resumeChannel,
    status: "running",
    startedAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    heartbeatAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    leaseExpiresAt: Date.now() - 5_000,
    leaseOwner: "dead-trigger",
    costTotal: 0.7,
    pipelineInvocationSnapshot: { runId: resumeRun },
    pipelineInvocationSha256: "a".repeat(64),
    planItemId: resumeItem,
    plannedTopic: "Topic 0",
    plannedTitle: "Title 0",
    plannedThumbnailKey: `owner/owner-test/channel/test/plan/${resumeItem}.jpg`,
    plannedPublishAt: resumePublishAt,
  }, resumeRun);
  await invoke(reapExpiredRunLeases, testContext(resumeDb), {});
  assert.equal((await resumeDb.get(resumeRun))?.leaseRecoveryPending, true);
  assert.equal((await resumeDb.get(resumeItem))?.scheduledRunId, resumeRun);
  const resumed = await invoke<{ state: string; reused: boolean; recoveryDispatch: boolean; runId: string }>(
    claimNextPlanRun,
    testContext(resumeDb),
    {
      ownerId: "owner-test",
      channelId: resumeChannel,
      dueBefore: Date.now() + DEFAULT_PLAN_GENERATION_LEAD_MS,
    },
  );
  assert.equal(resumed.state, "claimed");
  assert.equal(resumed.reused, true);
  assert.equal(resumed.recoveryDispatch, true);
  assert.equal(resumed.runId, resumeRun);
  assert.equal(
    await invoke<boolean>(markLeaseRecoveryDispatched, testContext(resumeDb), {
      ownerId: "owner-test",
      channelId: resumeChannel,
      runId: resumeRun,
    }),
    true,
  );
  assert.equal((await resumeDb.get(resumeRun))?.leaseRecoveryPending, undefined);

  // Recovery can re-enter a frozen invocation twice, then remains visibly
  // failed for manual reconciliation instead of repeatedly purchasing the
  // same run forever.
  const cappedRecoveryDb = new MemoryDb();
  const cappedRecoveryRun = "runs:recovery-cap";
  cappedRecoveryDb.seed("runs", {
    ownerId: "owner-test",
    channelId: "channel:recovery-cap",
    status: "running",
    startedAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    heartbeatAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    leaseExpiresAt: Date.now() - 5_000,
    leaseOwner: "dead-trigger",
    costTotal: 0,
    pipelineInvocationSnapshot: { runId: cappedRecoveryRun },
    pipelineInvocationSha256: "c".repeat(64),
  }, cappedRecoveryRun);
  await invoke(reapExpiredRunLeases, testContext(cappedRecoveryDb), {});
  assert.equal((await cappedRecoveryDb.get(cappedRecoveryRun))?.leaseRecoveryAttempts, 1);
  await cappedRecoveryDb.patch(cappedRecoveryRun, {
    status: "running",
    heartbeatAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    leaseExpiresAt: Date.now() - 5_000,
    leaseOwner: "dead-trigger-2",
    leaseRecoveryPending: undefined,
  });
  await invoke(reapExpiredRunLeases, testContext(cappedRecoveryDb), {});
  assert.equal(
    (await cappedRecoveryDb.get(cappedRecoveryRun))?.leaseRecoveryAttempts,
    MAX_AUTOMATIC_LEASE_RECOVERIES,
  );
  await cappedRecoveryDb.patch(cappedRecoveryRun, {
    status: "running",
    heartbeatAt: Date.now() - RUN_EXECUTION_LEASE_MS - 5_000,
    leaseExpiresAt: Date.now() - 5_000,
    leaseOwner: "dead-trigger-3",
    leaseRecoveryPending: undefined,
  });
  await invoke(reapExpiredRunLeases, testContext(cappedRecoveryDb), {});
  const cappedRun = await cappedRecoveryDb.get(cappedRecoveryRun);
  assert.equal(cappedRun?.status, "failed");
  assert.equal(cappedRun?.leaseRecoveryPending, undefined);
  assert.equal(cappedRun?.leaseRecoveryAttempts, MAX_AUTOMATIC_LEASE_RECOVERIES);
  assert.match(String(cappedRun?.error), /manual reconciliation/);

  // Deadline-indexed reaping reaches an actually expired worker even when the
  // oldest 100 rows are healthy workers that merely started long ago.
  const fairReaperDb = new MemoryDb();
  const fairNow = Date.now();
  for (let index = 0; index < 100; index++) {
    fairReaperDb.seed("runs", {
      ownerId: "owner-test",
      channelId: "channel:fair-reaper",
      status: "running",
      startedAt: fairNow - RUN_EXECUTION_LEASE_MS - 10_000 - index,
      heartbeatAt: fairNow,
      leaseExpiresAt: fairNow + RUN_EXECUTION_LEASE_MS,
      leaseOwner: `live-${index}`,
      costTotal: 0,
    }, `runs:live-${index}`);
  }
  fairReaperDb.seed("runs", {
    ownerId: "owner-test",
    channelId: "channel:fair-reaper",
    status: "running",
    startedAt: fairNow - RUN_EXECUTION_LEASE_MS - 1,
    heartbeatAt: fairNow - RUN_EXECUTION_LEASE_MS - 1,
    leaseExpiresAt: fairNow - 1,
    leaseOwner: "dead-fair-worker",
    costTotal: 0,
  }, "runs:dead-fair-worker");
  const fairResult = await invoke<{ checked: number; reaped: number }>(
    reapExpiredRunLeases,
    testContext(fairReaperDb),
    {},
  );
  assert.equal(fairResult.reaped, 1);
  assert.equal((await fairReaperDb.get("runs:dead-fair-worker"))?.status, "failed");
  assert.equal((await fairReaperDb.get("runs:live-0"))?.status, "running");

  // Pre-index legacy rows get their deterministic deadline materialized in a
  // bounded pass, so only the migration slice ever needs a startedAt fallback.
  const legacyLeaseDb = new MemoryDb();
  const legacyNow = Date.now();
  legacyLeaseDb.seed("runs", {
    ownerId: "owner-test",
    channelId: "channel:legacy-lease",
    status: "queued",
    startedAt: legacyNow,
    heartbeatAt: legacyNow,
    costTotal: 0,
  }, "runs:legacy-lease");
  await invoke(reapExpiredRunLeases, testContext(legacyLeaseDb), {});
  const legacyLease = await legacyLeaseDb.get("runs:legacy-lease");
  assert.equal(legacyLease?.status, "queued");
  assert.equal(legacyLease?.leaseExpiresAt, legacyNow + RUN_QUEUE_LEASE_MS);

  console.log("scheduled plan runtime tests passed");
}

void main();
