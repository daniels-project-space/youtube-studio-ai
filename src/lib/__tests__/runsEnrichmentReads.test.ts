import assert from "node:assert/strict";

import { listActive, listOverviewRuns, listRecent } from "../../../convex/runs";

const OWNER = "owner-run-enrichment";
const CHANNEL_A = "channels:run-enrichment-a";
const CHANNEL_B = "channels:run-enrichment-b";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

function context() {
  const rows: Record<string, Row[]> = {
    channels: [
      { _id: CHANNEL_A, _creationTime: 1, ownerId: OWNER, name: "Alpha", slug: "alpha" },
      { _id: CHANNEL_B, _creationTime: 2, ownerId: OWNER, name: "Beta", slug: "beta" },
    ],
    runs: [
      {
        _id: "runs:recent-a-1", _creationTime: 1, ownerId: OWNER, channelId: CHANNEL_A, status: "completed", startedAt: 30,
        pipelineInvocationSnapshot: { entries: [] }, pipelineInvocationSha256: "frozen-route-hash",
      },
      { _id: "runs:recent-a-2", _creationTime: 2, ownerId: OWNER, channelId: CHANNEL_A, status: "completed", startedAt: 20 },
      { _id: "runs:recent-b-1", _creationTime: 3, ownerId: OWNER, channelId: CHANNEL_B, status: "completed", startedAt: 10 },
      { _id: "runs:active-a-1", _creationTime: 4, ownerId: OWNER, channelId: CHANNEL_A, status: "running", startedAt: 40, leaseExpiresAt: Date.now() + 60_000 },
      { _id: "runs:active-a-2", _creationTime: 5, ownerId: OWNER, channelId: CHANNEL_A, status: "queued", startedAt: 35, leaseExpiresAt: Date.now() + 60_000 },
      { _id: "runs:active-b-1", _creationTime: 6, ownerId: OWNER, channelId: CHANNEL_B, status: "running", startedAt: 25, leaseExpiresAt: Date.now() + 60_000 },
    ],
    runStages: [],
  };
  let channelGets = 0;
  let runIndexReads = 0;
  const db = {
    async get(id: string) {
      if (id.startsWith("channels:")) channelGets += 1;
      return Object.values(rows).flat().find((row) => row._id === id) ?? null;
    },
    normalizeId: (_table: string, id: string) => id,
    query(table: string) {
      const filters: Array<readonly [string, unknown]> = [];
      let direction: "asc" | "desc" = "asc";
      const query = {
        withIndex(_name: string, select: (range: { eq: (field: string, value: unknown) => unknown }) => unknown) {
          const range = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return range;
            },
          };
          select(range);
          return query;
        },
        order(value: "asc" | "desc") {
          direction = value;
          return query;
        },
        async take(limit: number) {
          if (table === "runs") runIndexReads += 1;
          return rows[table]!
            .filter((row) => filters.every(([field, value]) => row[field] === value))
            .sort((left, right) => (left._creationTime - right._creationTime) * (direction === "desc" ? -1 : 1))
            .slice(0, limit);
        },
        async collect() {
          return rows[table]!.filter((row) => filters.every(([field, value]) => row[field] === value));
        },
      };
      return query;
    },
  };
  const handlerContext = {
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: `viewer:${OWNER}`,
        issuer: "https://youtube-studio-ai.local",
        tokenIdentifier: "test|viewer",
        role: "viewer",
        owner_id: OWNER,
      }),
    },
  };
  return {
    handlerContext,
    addRun(row: Row) { rows.runs.push(row); },
    resetReads() {
      channelGets = 0;
      runIndexReads = 0;
    },
    channelGets() {
      return channelGets;
    },
    runIndexReads() { return runIndexReads; },
  };
}

async function invoke<T>(definition: unknown, handlerContext: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (ctx: unknown, input: unknown) => Promise<T>;
  })._handler(handlerContext, args);
}

async function main(): Promise<void> {
  const fixture = context();
  const recent = await invoke<Array<{
    _id: string;
    channelName: string;
    pipelineSource: "frozen" | "legacy_inferred";
  }>>(listRecent, fixture.handlerContext, {
    ownerId: OWNER,
    limit: 6,
  });
  assert.deepEqual(recent.map((run) => [run._id, run.channelName]), [
    ["runs:active-a-1", "Alpha"],
    ["runs:active-a-2", "Alpha"],
    ["runs:recent-a-1", "Alpha"],
    ["runs:active-b-1", "Beta"],
    ["runs:recent-a-2", "Alpha"],
    ["runs:recent-b-1", "Beta"],
  ]);
  assert.equal(fixture.channelGets(), 2, "recent enrichment should read each channel once, even when runs repeat it");
  assert.equal(
    recent.find((run) => run._id === "runs:recent-a-1")?.pipelineSource,
    "frozen",
    "run history exposes a durable frozen route to distinguish current operations from historic evidence",
  );
  assert.equal(
    recent.find((run) => run._id === "runs:recent-a-2")?.pipelineSource,
    "legacy_inferred",
    "run history explicitly marks a route-less record as legacy instead of letting the UI infer recovery authority",
  );

  fixture.resetReads();
  const active = await invoke<Array<{ _id: string; channelName: string }>>(listActive, fixture.handlerContext, {
    ownerId: OWNER,
  });
  assert.deepEqual(active.map((run) => [run._id, run.channelName]), [
    ["runs:active-a-1", "Alpha"],
    ["runs:active-a-2", "Alpha"],
    ["runs:active-b-1", "Beta"],
  ]);
  assert.equal(fixture.channelGets(), 2, "active enrichment should read each channel once, even when runs repeat it");

  fixture.resetReads();
  const overview = await invoke<{
    recent: Array<{ _id: string; channelName: string; pipelineSource: "frozen" | "legacy_inferred" }>;
    active: Array<{ _id: string; channelName: string; pipelineSource: "frozen" | "legacy_inferred" }>;
  }>(listOverviewRuns, fixture.handlerContext, { ownerId: OWNER });
  assert.deepEqual(overview.recent.map((run) => run._id), recent.map((run) => run._id));
  assert.deepEqual(overview.active.map((run) => run._id), active.map((run) => run._id));
  assert.equal(
    overview.recent.find((run) => run._id === "runs:recent-a-1")?.pipelineSource,
    "frozen",
    "a complete invocation record is returned as a recoverable, frozen route",
  );
  assert.equal(
    overview.recent.find((run) => run._id === "runs:recent-a-2")?.pipelineSource,
    "legacy_inferred",
    "a route-less historical record is explicitly identified for the dashboard",
  );
  assert.equal(fixture.runIndexReads(), 1, "overview must read the owner run window once");
  assert.equal(fixture.channelGets(), 2, "recent and active share channel point reads");

  // The first 50 may be all terminal while a live run still lies inside the
  // active board's 200-row window. It must remain visible after consolidation.
  const olderActive = context();
  olderActive.addRun({
    _id: "runs:older-active", _creationTime: 0, ownerId: OWNER,
    channelId: CHANNEL_A, status: "running", startedAt: 1,
    leaseExpiresAt: Date.now() + 60_000,
  });
  for (let index = 0; index < 55; index++) {
    olderActive.addRun({
      _id: `runs:filler-${index}`, _creationTime: 100 + index, ownerId: OWNER,
      channelId: CHANNEL_A, status: "ok", startedAt: 100 + index,
    });
  }
  const mixed = await invoke<{ recent: Array<{ _id: string }>; active: Array<{ _id: string }> }>(
    listOverviewRuns, olderActive.handlerContext, { ownerId: OWNER },
  );
  assert.equal(mixed.recent.length, 50);
  assert.equal(mixed.recent.some((run) => run._id === "runs:older-active"), false);
  assert.equal(mixed.active.some((run) => run._id === "runs:older-active"), true);
  assert.equal(olderActive.runIndexReads(), 1);

  console.log("run enrichment read-cache tests passed");
}

void main();
