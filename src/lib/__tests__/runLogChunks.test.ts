import assert from "node:assert/strict";
import { test } from "node:test";
import { compareValues, type Value } from "convex/values";
import { appendRunLogs, listRunLogs } from "../../../convex/runLogs";
import { deleteChannel } from "../../../convex/channels";
import { makeRunLogSink } from "../../engine/runLogSink";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Line = { at: number; seq?: number; message: string; level: string; block?: string };
const ownerId = "log-owner", runId = "run-logs", channelId = "channel-logs";

function fixture() {
  let tables: Record<string, Row[]> = {}, next = 0, role = "service", owner = ownerId;
  const reads: Record<string, number> = {}, writes: string[] = [];
  const seed = (table: string, fields: Record<string, unknown>, id = `${table}-${++next}`) => {
    const row = { ...fields, _id: id, _creationTime: ++next };
    (tables[table] ??= []).push(row); return row;
  };
  seed("channels", { ownerId, name: "Logs", slug: "logs" }, channelId);
  seed("runs", { ownerId, channelId }, runId);
  const compare = (a: unknown, b: unknown): number => compareValues(a as Value | undefined, b as Value | undefined);
  const output = (table: string, rows: Row[]) => { reads[table] = (reads[table] ?? 0) + rows.length; return structuredClone(rows); };
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => structuredClone(Object.values(tables).flat().find(row => row._id === id) ?? null),
    insert: async (table: string, fields: Record<string, unknown>) => { writes.push(table); return seed(table, structuredClone(fields))._id; },
    patch: async (id: string, fields: Record<string, unknown>) => {
      const entry = Object.entries(tables).find(([, rows]) => rows.some(row => row._id === id));
      assert(entry); writes.push(entry[0]); Object.assign(entry[1].find(row => row._id === id)!, structuredClone(fields));
    },
    delete: async (id: string) => { for (const [table, rows] of Object.entries(tables)) tables[table] = rows.filter(row => row._id !== id); },
    query: (table: string) => {
      const filters: [string, unknown][] = [];
      let index = "", desc = false;
      const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
      const rows = () => {
        const keys = index === "by_run_seq" ? ["at", "seq", "_creationTime", "_id"]
          : index === "by_run_end" ? ["endAt", "endSeq", "_creationTime", "_id"] : ["_creationTime", "_id"];
        return (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
          .sort((a, b) => {
            for (const key of keys) { const result = compare(a[key], b[key]); if (result) return result * (desc ? -1 : 1); }
            return 0;
          });
      };
      const query = {
        withIndex: (name: string, build: (q: typeof range) => unknown) => { index = name; build(range); return query; },
        order: (order: string) => { desc = order === "desc"; return query; },
        take: async (limit: number) => output(table, rows().slice(0, limit)),
        collect: async () => output(table, rows()),
        unique: async () => { const found = rows(); assert(found.length <= 1); return output(table, found)[0] ?? null; },
        async *[Symbol.asyncIterator]() { for (const row of rows()) yield output(table, [row])[0]; },
      };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({
    role, owner_id: owner, subject: role === "viewer" ? `viewer:${owner}` : owner,
  }) } };
  const invoke = async <T = unknown>(definition: unknown, args: unknown): Promise<T> => {
    const before = structuredClone(tables);
    try { return await (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args); }
    catch (error) { tables = before; throw error; }
  };
  return { invoke, seed, reads, writes, rows: (table: string) => tables[table] ?? [],
    resetReads: () => { for (const key of Object.keys(reads)) delete reads[key]; },
    auth: (r: string, o = ownerId) => { role = r; owner = o; },
    append: (lines: Line[], target = runId) => invoke<number>(appendRunLogs, { ownerId, runId: target, lines }),
    tail: (limit = 500, target = runId) => invoke<Array<Row & Line>>(listRunLogs, { runId: target, limit }) };
}

const lines = (count: number, offset = 0): Line[] => Array.from({ length: count }, (_, index) => ({
  at: 1000 + Math.floor((offset + index) / 10), seq: offset + index,
  level: index % 7 === 0 ? "error" : index % 3 === 0 ? "warn" : "info",
  message: `Complete module evidence ${offset + index}`, block: "music",
}));
const content = ({ at, seq, level, message, block }: Line) => ({ at, seq, level, message, block });
const oracle = (input: Line[], limit: number) => input.map((line, order) => ({ ...line, order }))
  .sort((a, b) => a.at - b.at ||
    (a.seq === b.seq ? 0 : a.seq === undefined ? -1 : b.seq === undefined ? 1 : a.seq - b.seq) || a.order - b.order)
  .slice(-limit).map(content);

test("1000-line actual sink burst retains every line using 40 immutable chunks and one head", async () => {
  const f = fixture(); let calls = 0;
  const sink = makeRunLogSink({ mutation: async (_fn: unknown, args: unknown) => {
    calls++; return f.invoke(appendRunLogs, args);
  } } as never, ownerId, runId);
  for (let index = 0; index < 1000; index++) sink.log(index % 2 ? "warn" : "error", `evidence ${index}`, "music");
  await sink.flush();
  assert.equal(calls, 1, "transport remains batched; no claim of fewer HTTP calls than the old sink");
  assert.equal(f.rows("runLogs").length, 0);
  assert.equal(f.rows("runLogChunks").length, 40);
  assert.equal(f.writes.length, 41);
  const tail = await f.tail(5000);
  assert.equal(tail.length, 1000);
  assert.deepEqual(tail.map(row => row.message), Array.from({ length: 1000 }, (_, i) => `evidence ${i}`));
  const oldRows = tail.map((row, i) => ({ ...row, _id: `legacy-row-${i}` }));
  const packed = [...f.rows("runLogChunks"), ...f.rows("runLogChunkHeads")];
  assert(Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(oldRows)) * 0.8,
    "short-line fixture removes repeated document/owner/run metadata, not message content");
  f.resetReads();
  const recent = await f.tail(500);
  assert.equal(recent.length, 500); assert.equal(recent[0].message, "evidence 500");
  assert.equal(f.reads.runLogChunks, 20, "500 recent lines read exactly 20 full chunks");
});

test("legacy, late workers, clock rollback, equal timestamps and absent sequences match an independent tail oracle", async () => {
  const f = fixture(); const accepted: Line[] = [];
  const batches = [lines(25), lines(25, 25), lines(10, 3).reverse(),
    Array.from({ length: 30 }, (_, i) => ({ at: 1004, seq: 49, level: "error", message: `duplicate clock ${i}` })),
    Array.from({ length: 8 }, (_, i) => ({ at: 1005, level: "warn", message: `no seq ${i}` })),
    lines(25, 100), [{ at: 500, level: "warn", message: "Late clock" }], lines(3, 300)];
  f.seed("runLogs", { ownerId, runId, at: 1, level: "info", message: "Historic log" });
  accepted.push({ at: 1, level: "info", message: "Historic log" });
  for (const batch of batches) {
    accepted.push(...batch);
    assert.equal(await f.append(batch), batch.length);
    for (const limit of [1, 7, 25, 26, 50, 5000]) {
      assert.deepEqual((await f.tail(limit)).map(content), oracle(accepted, limit));
    }
  }
  const first = await f.tail(5000), again = await f.tail(5000);
  assert.deepEqual(first.map(row => row._id), again.map(row => row._id), "synthetic chunk-line IDs remain stable");
  assert.equal(new Set(first.map(row => row._id)).size, accepted.length);
  assert(f.rows("runLogs").length > 30, "overlapping ranges stay individually indexed");
});

test("UTF-8 byte and line ceilings split chunks without truncating oversized messages", async () => {
  const f = fixture();
  const input = lines(100).map((line, i) => ({ ...line, message: `${i}:` + "\u00e9".repeat(i === 50 ? 50_000 : 2000) }));
  await f.append(input);
  for (const row of f.rows("runLogChunks")) {
    const packet = row.lines as Line[];
    assert(packet.length >= 4 && packet.length <= 25);
    assert(Buffer.byteLength(JSON.stringify(packet)) <= 64 * 1024);
  }
  assert(f.rows("runLogs").some(row => row.message === input[50].message));
  assert.deepEqual((await f.tail(5000)).map(content), oracle(input, 5000));
});

test("empty and tiny batches avoid the chunk head, while identical replays preserve existing append semantics", async () => {
  const f = fixture();
  await f.append([]); await f.append(lines(3));
  assert.equal(f.reads.runLogChunkHeads, undefined);
  assert.equal(f.rows("runLogChunks").length, 0);
  await f.append(lines(25, 25)); await f.append(lines(25, 25));
  assert.deepEqual((await f.tail(5000)).map(content), oracle([...lines(3), ...lines(25, 25), ...lines(25, 25)], 5000));
  assert.equal(f.rows("runLogChunks").length, 1, "a redelivered overlapping batch uses the legacy path, not a conflicting chunk");
});

test("owner authorization and channel deletion cover chunks, legacy lines and heads without crossing runs", async () => {
  const f = fixture();
  f.seed("channels", { ownerId: "foreign", name: "Other", slug: "other" }, "other-channel");
  f.seed("runs", { ownerId: "foreign", channelId: "other-channel" }, "other-run");
  f.seed("runLogChunks", { ownerId: "foreign", runId: "other-run", endAt: 99, lines: lines(4) });
  await f.append(lines(25)); await f.append(lines(2, 1));
  f.auth("viewer");
  assert.equal((await f.tail()).length, 27);
  await assert.rejects(f.append(lines(25)), /viewer mutations/);
  await assert.rejects(f.tail(500, "other-run"), /resource access denied/);
  f.auth("service");
  await assert.rejects(f.append(lines(25), "other-run"), /resource access denied/);
  await f.invoke(deleteChannel, { channelId });
  assert.equal(f.rows("runLogs").length, 0);
  assert.equal(f.rows("runLogChunkHeads").length, 0);
  assert.deepEqual(f.rows("runLogChunks").map(row => row.runId), ["other-run"]);
});

test("mixed tails preserve Convex ordering for legacy non-finite numbers and signed zero", async () => {
  const f = fixture();
  await f.append(lines(4));
  await f.append([
    { at: Infinity, level: "warn", message: "positive infinity" },
    { at: NaN, level: "warn", message: "positive NaN" },
    { at: 0, level: "info", message: "positive zero" },
    { at: -0, level: "info", message: "negative zero" },
    { at: -Infinity, level: "warn", message: "negative infinity" },
  ]);
  assert.deepEqual((await f.tail()).map(row => row.message), [
    "negative infinity", "negative zero", "positive zero", ...lines(4).map(row => row.message), "positive infinity", "positive NaN",
  ]);
});
