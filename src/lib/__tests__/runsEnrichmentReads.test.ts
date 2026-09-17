import assert from "node:assert/strict";

import { listActive, listRecent } from "../../../convex/runs";

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
      { _id: "runs:recent-a-1", _creationTime: 1, ownerId: OWNER, channelId: CHANNEL_A, status: "completed", startedAt: 30 },
      { _id: "runs:recent-a-2", _creationTime: 2, ownerId: OWNER, channelId: CHANNEL_A, status: "completed", startedAt: 20 },
      { _id: "runs:recent-b-1", _creationTime: 3, ownerId: OWNER, channelId: CHANNEL_B, status: "completed", startedAt: 10 },
      { _id: "runs:active-a-1", _creationTime: 4, ownerId: OWNER, channelId: CHANNEL_A, status: "running", startedAt: 40, leaseExpiresAt: Date.now() + 60_000 },
      { _id: "runs:active-a-2", _creationTime: 5, ownerId: OWNER, channelId: CHANNEL_A, status: "queued", startedAt: 35, leaseExpiresAt: Date.now() + 60_000 },
      { _id: "runs:active-b-1", _creationTime: 6, ownerId: OWNER, channelId: CHANNEL_B, status: "running", startedAt: 25, leaseExpiresAt: Date.now() + 60_000 },
    ],
    runStages: [],
  };
  let channelGets = 0;
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
    resetReads() {
      channelGets = 0;
    },
    channelGets() {
      return channelGets;
    },
  };
}

async function invoke<T>(definition: unknown, handlerContext: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (ctx: unknown, input: unknown) => Promise<T>;
  })._handler(handlerContext, args);
}

async function main(): Promise<void> {
  const fixture = context();
  const recent = await invoke<Array<{ _id: string; channelName: string }>>(listRecent, fixture.handlerContext, {
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

  console.log("run enrichment read-cache tests passed");
}

void main();
