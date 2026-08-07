import assert from "node:assert/strict";
import {
  claimNextPlanRun,
  completeClaimedPlanRun,
  failClaimedPlanRun,
  getClaimedPlanItemForRun,
  listPlanByOwner,
} from "../../../convex/contentPlan";
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
    const field = this.indexName.includes("schedule")
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

  console.log("scheduled plan runtime tests passed");
}

void main();
