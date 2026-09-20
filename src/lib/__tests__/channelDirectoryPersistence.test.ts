import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillChannelDirectory, createChannel, deleteChannel, invalidateChannelDirectory,
  listChannelDirectory, listChannels, updateChannel,
} from "../../../convex/channels";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
const ownerId = "directory-owner";
const identity = { persona: "Private personality".repeat(10_000), palette: ["#123456"], niche: "History" };

function fixture() {
  let tables: Record<string, Row[]> = {}, counter = 0, role = "service", owner = ownerId;
  const reads: string[] = [], writes: string[] = [];
  let bytesRead = 0;
  const seed = (table: string, data: Record<string, unknown>, id = `${table}-${++counter}`) => {
    const row = { ...data, _id: id, _creationTime: ++counter };
    (tables[table] ??= []).push(row); return row;
  };
  const output = <T>(value: T): T => { bytesRead += Buffer.byteLength(JSON.stringify(value)); return structuredClone(value); };
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => output(Object.values(tables).flat().find(row => row._id === id) ?? null),
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
      const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
      const rows = () => (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
        .sort((a, b) => a._creationTime - b._creationTime);
      const query = {
        withIndex: (_name: string, build: (r: typeof range) => unknown) => { build(range); return query; },
        collect: async () => output(rows()),
        unique: async () => { const result = rows(); assert(result.length <= 1); return output(result[0] ?? null); },
        paginate: async ({ numItems, cursor }: { numItems: number; cursor: string | null }) => {
          assert.equal(numItems, 4, "maintenance must remain bounded");
          const remaining = rows().filter(row => row._creationTime > Number(cursor ?? 0));
          const page = remaining.slice(0, numItems);
          return { page: output(page), isDone: remaining.length <= numItems,
            continueCursor: String(page.at(-1)?._creationTime ?? cursor ?? 0) };
        },
      };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({
    subject: role === "viewer" ? `viewer:${owner}` : owner, role, owner_id: owner,
  }) } };
  const invoke = async <T = unknown>(definition: unknown, args: unknown): Promise<T> => {
    const snapshot = structuredClone(tables);
    try {
      return await (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
    } catch (error) { tables = snapshot; throw error; }
  };
  const channel = (name: string, extra = {}) => seed("channels", {
    ownerId, name, slug: name.toLowerCase(), identity, template: "fixture", pipeline: [],
    architectReport: { notes: "large report".repeat(10_000) }, ...extra,
  });
  return { invoke, db, channel, seed, rows: (table: string) => tables[table] ?? [], reads, writes,
    resetReads: () => { reads.length = 0; bytesRead = 0; }, bytesRead: () => bytesRead,
    auth: (r: string, o = ownerId) => { role = r; owner = o; } };
}

const project = (row: Row) => {
  const value = row.identity as typeof identity & { imageKey?: string };
  return { _id: row._id, name: row.name, slug: row.slug,
    identity: { imageKey: value.imageKey, niche: value.niche, palette: value.palette } };
};

test("bounded backfill retains full fallback until complete, then avoids all full-channel reads", async () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) f.channel(`Channel ${i}`);
  f.channel("Foreign", { ownerId: "another-owner" });
  const expected = f.rows("channels").filter(row => row.ownerId === ownerId).map(project);
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), expected);
  const oldBytes = f.bytesRead();
  assert.deepEqual(await f.invoke(backfillChannelDirectory, { ownerId }), { processed: 4, isDone: false, generation: 1 });
  f.resetReads();
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), expected);
  assert(f.reads.includes("channels"), "partial directories never hide old channels");
  assert.deepEqual(await f.invoke(backfillChannelDirectory, { ownerId }), { processed: 2, isDone: true, generation: 1 });
  f.resetReads();
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), expected);
  assert.deepEqual(f.reads, ["channelDirectoryStates", "channelDirectory"]);
  assert(f.bytesRead() < oldBytes / 100, "measure serialized fixture read bytes, not production bills");
  assert.equal(f.rows("channelDirectory").some(row => row.ownerId !== ownerId), false);
  const full = await f.invoke<Row[]>(listChannels, { ownerId });
  assert.equal((full[0].identity as typeof identity).persona, identity.persona);
  f.resetReads();
  assert.deepEqual(await f.invoke(backfillChannelDirectory, { ownerId }), { processed: 0, isDone: true, generation: 1 });
  assert.deepEqual(f.reads, ["channelDirectoryStates"]);
});

test("real create, reseed, edit and delete keep the directory current between migration pages", async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.channel(`Existing ${i}`);
  await f.invoke(backfillChannelDirectory, { ownerId });
  const first = f.rows("channels")[0];
  await f.invoke(updateChannel, { channelId: first._id, name: "Renamed", identity: { ...identity, imageKey: "owner/art.png" } });
  await f.invoke(deleteChannel, { channelId: f.rows("channels")[1]._id });
  const args = { ownerId, slug: "new", name: "New", identity, pipeline: [], template: "fixture", budget: 1 };
  const added = await f.invoke<string>(createChannel, args);
  assert.equal(await f.invoke(createChannel, { ...args, name: "Reseeded" }), added);
  await f.invoke(backfillChannelDirectory, { ownerId });
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), f.rows("channels").map(project));
  await f.invoke(deleteChannel, { channelId: first._id });
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), f.rows("channels").map(project));
  assert.equal(f.rows("channelDirectory").some(row => row.channelId === first._id), false);
});

test("personality/pipeline/status-only updates do not write or read the navigation index", async () => {
  const f = fixture(); const channel = f.channel("Stable");
  await f.invoke(backfillChannelDirectory, { ownerId });
  f.resetReads(); f.writes.length = 0;
  await f.invoke(updateChannel, { channelId: channel._id, identity: { ...identity, persona: "New full personality" }, status: "active" });
  assert.equal(f.reads.includes("channelDirectoryStates"), false);
  assert.equal(f.reads.includes("channelDirectory"), false);
  assert.equal(f.writes.includes("channelDirectory"), false);
  assert.equal((f.rows("channels")[0].identity as typeof identity).persona, "New full personality");
});

test("rollback invalidation hides old generations, including stale rows deleted by old writers", async () => {
  const f = fixture(); const keep = f.channel("Keep"), remove = f.channel("Remove");
  await f.invoke(backfillChannelDirectory, { ownerId });
  await f.invoke(invalidateChannelDirectory, { ownerId });
  await f.db.delete(remove._id); // Simulate a rollback writer that does not maintain the projection.
  await f.db.patch(keep._id, { name: "Changed by old writer" });
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), f.rows("channels").map(project));
  await f.invoke(backfillChannelDirectory, { ownerId });
  f.resetReads();
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), f.rows("channels").map(project));
  assert.equal(f.reads.includes("channels"), false);
  assert.equal(f.rows("channelDirectory").find(row => row.channelId === remove._id)?.generation, 1);
});

test("authorization, channel locks and rejected mutations preserve projection integrity", async () => {
  const f = fixture(); const channel = f.channel("Locked", { locked: true });
  await f.invoke(backfillChannelDirectory, { ownerId });
  const before = structuredClone(f.rows("channelDirectory"));
  assert.deepEqual(await f.invoke(updateChannel, { channelId: channel._id, name: "Forbidden" }), { forked: false, state: "channel_locked" });
  await assert.rejects(f.invoke(deleteChannel, { channelId: channel._id }), /locked/);
  assert.deepEqual(f.rows("channelDirectory"), before);
  for (const role of ["owner", "viewer"]) {
    f.auth(role); f.resetReads();
    await assert.rejects(f.invoke(backfillChannelDirectory, { ownerId }), /service identity|viewer mutations/);
    await assert.rejects(f.invoke(invalidateChannelDirectory, { ownerId }), /service identity|viewer mutations/);
    assert.equal(f.reads.length, 0);
    assert.equal((await f.invoke<Row[]>(listChannelDirectory, { ownerId })).length, 1);
    f.resetReads();
    await assert.rejects(f.invoke(listChannelDirectory, { ownerId: "another-owner" }), /owner access denied/);
    assert.equal(f.reads.length, 0);
  }
});

test("a ready empty owner stays current on the first creation, and replay does not rewrite the index", async () => {
  const f = fixture();
  await f.invoke(backfillChannelDirectory, { ownerId });
  const args = { ownerId, slug: "first", name: "First", identity, pipeline: [], template: "fixture", budget: 1 };
  await f.invoke(createChannel, args);
  f.resetReads();
  assert.deepEqual(await f.invoke(listChannelDirectory, { ownerId }), f.rows("channels").map(project));
  assert.equal(f.reads.includes("channels"), false);
  f.writes.length = 0;
  await f.invoke(createChannel, args);
  assert.equal(f.writes.includes("channelDirectory"), false);
});

test("a conflicting projection owner aborts a source edit instead of publishing split state", async () => {
  const f = fixture(); const channel = f.channel("Unchanged");
  await f.invoke(backfillChannelDirectory, { ownerId });
  await f.db.patch(f.rows("channelDirectory")[0]._id, { ownerId: "another-owner" });
  await assert.rejects(f.invoke(updateChannel, { channelId: channel._id, name: "Must not persist" }), /owner mismatch/);
  assert.equal(f.rows("channels")[0].name, "Unchanged");
});
