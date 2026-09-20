import assert from "node:assert/strict";
import { test } from "node:test";
import { upsertRunStage, listRunStages } from "../../../convex/runStages";
import { advanceSelfHealGeneration, listOverviewRuns, listRecent } from "../../../convex/runs";
import { summarizeRunStageProgress } from "../runStageProgress";
import { begin, finish } from "../../../convex/remoteChildCosts";
import { deleteChannel } from "../../../convex/channels";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
const scope = { ownerId: "owner-progress", channelId: "channel-progress", runId: "run-progress" };
const fence = { leaseOwner: "worker-progress", executionLeaseToken: 1 };

function fixture(legacy = false) {
  const tables: Record<string, Row[]> = {};
  const reads: string[] = [], writes: string[] = [];
  let counter = 0;
  const seed = (table: string, data: Record<string, unknown>, id = `${table}-${++counter}`) => {
    const row = { ...data, _id: id, _creationTime: ++counter };
    (tables[table] ??= []).push(row); return row;
  };
  seed("channels", { ownerId: scope.ownerId, name: "Progress", slug: "progress" }, scope.channelId);
  const run = seed("runs", { ...scope, ...fence, status: "running", executionAttempts: 1,
    leaseExpiresAt: Date.now() + 120_000, startedAt: Date.now(), selfHealGeneration: 0 }, scope.runId);
  if (legacy) seed("runStages", { ...scope, block: "historic", status: "ok", cost: 0 });
  let role = "service", owner = scope.ownerId;
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => structuredClone(Object.values(tables).flat().find(row => row._id === id) ?? null),
    insert: async (table: string, data: Record<string, unknown>) => { writes.push(table); return seed(table, structuredClone(data))._id; },
    delete: async (id: string) => {
      for (const [table, rows] of Object.entries(tables)) tables[table] = rows.filter(row => row._id !== id);
    },
    patch: async (id: string, data: Record<string, unknown>) => {
      const entry = Object.entries(tables).find(([, rows]) => rows.some(row => row._id === id));
      assert(entry); writes.push(entry[0]);
      const row = entry[1].find(row => row._id === id)!;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
    },
    query: (table: string) => {
      reads.push(table);
      const filters: [string, unknown][] = [];
      let descending = false;
      const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
      const rows = () => structuredClone((tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value)))
        .sort((a, b) => (a._creationTime - b._creationTime) * (descending ? -1 : 1));
      const query = {
        withIndex: (_name: string, build: (r: typeof range) => unknown) => { build(range); return query; },
        order: (direction: string) => { descending = direction === "desc"; return query; },
        collect: async () => rows(), take: async (limit: number) => rows().slice(0, limit),
        unique: async () => { const result = rows(); assert(result.length <= 1); return result[0] ?? null; },
      };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: "progress-service", role, owner_id: owner }) } };
  const invoke = <T = unknown>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
  const stage = (block: string, status: string, extra: Record<string, unknown> = {}) =>
    invoke(upsertRunStage, { ownerId: scope.ownerId, runId: scope.runId, ...fence, block, status, ...extra });
  return { tables, reads, writes, stage, invoke, run, auth: (r: string, o = scope.ownerId) => { role = r; owner = o; } };
}

test("real list and overview read compact state without full stage payloads", async () => {
  const f = fixture();
  await f.stage("script", "ok", { startedAt: 1, inputs: { prompt: "x".repeat(200_000) }, outputs: { script: "y".repeat(200_000) } });
  await f.stage("music", "running", { startedAt: 2 });
  const expected = summarizeRunStageProgress({ stages: f.tables.runStages as never });
  f.reads.length = 0;
  const recent = await f.invoke<Array<{ stageProgress: unknown }>>(listRecent, { ownerId: scope.ownerId, limit: 10 });
  const overview = await f.invoke<{ recent: Array<{ stageProgress: unknown }> }>(listOverviewRuns, { ownerId: scope.ownerId });
  assert.deepEqual(recent[0].stageProgress, expected);
  assert.deepEqual(overview.recent[0].stageProgress, expected);
  assert.equal(f.reads.includes("runStages"), false);
  assert(JSON.stringify(f.tables.runStageProgress).length < 1000);
  assert(JSON.stringify(f.tables.runStages).length > 400_000);
  const full = await f.invoke<Row[]>(listRunStages, { runId: scope.runId });
  assert.equal((full[0].inputs as { prompt: string }).prompt.length, 200_000, "resume/detail data is untouched");
});

test("payload/cost-only writes do not invalidate progress; status and timing changes do", async () => {
  const f = fixture();
  await f.stage("script", "running", { startedAt: 1 });
  f.writes.length = 0;
  await f.stage("script", "running", { cost: 0.5, outputs: { receipt: "saved" } });
  assert.equal(f.writes.includes("runStageProgress"), false);
  await f.stage("script", "ok", { startedAt: 2 });
  assert.equal(f.writes.includes("runStageProgress"), true);
  assert.deepEqual((f.tables.runStageProgress[0].stages as Row[]).map(({ block, status, startedAt }) => ({ block, status, startedAt })),
    [{ block: "script", status: "ok", startedAt: 2 }]);
});

test("self-heal updates existing stages and inserts missing stages into the same projection", async () => {
  const f = fixture();
  await f.stage("script", "ok", { startedAt: 1 });
  await f.invoke(advanceSelfHealGeneration, { ...scope, ...fence, expectedGeneration: 0,
    rerunBlocks: ["script", "music"], reason: "Fixture repair" });
  const projection = f.tables.runStageProgress[0].stages as Row[];
  assert.deepEqual(projection.map(row => [row.block, row.status]), [["script", "superseded"], ["music", "superseded"]]);
  await f.stage("music", "running", { startedAt: 2 });
  assert.equal((f.tables.runStageProgress[0].stages as Row[])[1].status, "running");
  assert.deepEqual(summarizeRunStageProgress({ stages: f.tables.runStageProgress[0].stages as never }),
    summarizeRunStageProgress({ stages: f.tables.runStages as never }));
});

test("legacy runs never acquire a partial projection or lose historical progress", async () => {
  const f = fixture(true);
  await f.stage("music", "running");
  assert.equal(f.tables.runStageProgress[0].stages, undefined);
  f.reads.length = 0;
  const rows = await f.invoke<Array<{ stageProgress: { total: number; completed: number } }>>(listRecent, { ownerId: scope.ownerId });
  assert.equal(rows[0].stageProgress.total, 2);
  assert.equal(rows[0].stageProgress.completed, 1);
  assert(f.reads.includes("runStages"));
});

test("remote child accounting preserves progress and does not add projection invalidations", async () => {
  const f = fixture();
  await f.stage("music", "running", { startedAt: 1, cost: 0 });
  Object.assign(f.run, { remoteChildWaitDispatchKey: "dispatch", remoteChildWaitBlockId: "music",
    remoteChildWaitLeaseOwner: fence.leaseOwner, remoteChildWaitExecutionLeaseToken: 1,
    remoteChildWaitUntil: Date.now() + 60_000 });
  const before = structuredClone(f.tables.runStageProgress);
  f.writes.length = 0;
  const args = { ...scope, ...fence, blockId: "music", dispatchKey: "dispatch", taskRunId: "child", attemptNumber: 1 };
  await f.invoke(begin, args);
  await f.invoke(finish, { ...args, status: "succeeded", costUsd: 0.25, complete: true, checkpointCostReceipts: [] });
  assert.equal(f.tables.runStages[0].cost, 0.25);
  assert.deepEqual(f.tables.runStageProgress, before);
  assert.equal(f.writes.includes("runStageProgress"), false);
});

test("stale workers and foreign/viewer writes cannot change either ledger", async () => {
  const f = fixture();
  await f.stage("music", "running");
  const before = structuredClone(f.tables);
  await assert.rejects(f.stage("music", "ok", { executionLeaseToken: 2 }));
  for (const role of ["owner", "viewer"]) {
    f.auth(role); await assert.rejects(f.stage("music", "ok"));
  }
  f.auth("service", "foreign");
  await assert.rejects(f.stage("music", "ok"));
  await assert.rejects(f.invoke(listRecent, { ownerId: scope.ownerId }));
  assert.deepEqual(f.tables, before);
});

test("channel cleanup removes its projection without deleting another run's record", async () => {
  const f = fixture();
  await f.stage("music", "running");
  const other = { _id: "other-progress", _creationTime: 999, ownerId: "other-owner", runId: "other-run", stages: [] };
  f.tables.runStageProgress.push(other);
  await f.invoke(deleteChannel, { channelId: scope.channelId });
  assert.deepEqual(f.tables.runStageProgress, [other]);
  assert.deepEqual(f.tables.runStages, []);
  assert.deepEqual(f.tables.runs, []);
  assert.equal(f.tables.channelArchives.length, 1);
});
