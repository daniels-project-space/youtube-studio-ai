import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as contracts from "@/engine/yue2Audition";
import * as canonical from "@/lib/canonicalJson";

type Row = Record<string, unknown>;
function fixture() {
  const rows: Row[] = [];
  let authenticated = true, owner = "owner-a", reads = 0;
  const ctx = { db: {
    get: async (id: string) => { reads++; return id === "run-a" ? { ownerId: owner, channelId: "channel-a" } : { ownerId: owner }; },
    query: (table: string) => {
      assert.equal(table, "yue2Auditions"); reads++;
      return { withIndex: (index: string, build: (q: unknown) => unknown) => {
        assert.equal(index, "by_owner_run_candidate");
        const filters: Row = {};
        const q = { eq: (key: string, value: unknown) => { filters[key] = value; return q; } }; build(q);
        return { order: (direction: string) => { assert.equal(direction, "desc"); return {
          first: async () => [...rows].reverse().find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null,
        }; } };
      } };
    },
    insert: async (table: string, value: Row) => { assert.equal(table, "yue2Auditions"); rows.push(structuredClone(value)); },
  } };
  const loaded = { exports: {} as Record<string, { handler: (ctx: unknown, args: Row) => Promise<Row | null> }> };
  const requireFixture = (name: string): unknown => {
    if (name === "convex/values") return { v: new Proxy({}, { get: () => () => ({}) }) };
    if (name === "./studioFunctions") return { query: (value: unknown) => value, mutation: (value: unknown) => value,
      requireStudioServiceIdentity: async (_ctx: unknown, id: string) => { if (!authenticated || id !== "owner-a") throw new Error("forbidden"); } };
    if (name.endsWith("/yue2Audition")) return contracts;
    if (name.endsWith("/canonicalJson")) return canonical;
    throw new Error(`Unexpected import ${name}`);
  };
  const compiled = ts.transpileModule(readFileSync("convex/yue2Auditions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", compiled)(requireFixture, loaded, loaded.exports);
  const args = { ownerId: "owner-a", channelId: "channel-a", runId: "run-a", candidateSha256: "a".repeat(64) };
  return { rows, args, call: (name: string, extra: Row = {}) => loaded.exports[name].handler(ctx, { ...args, ...extra }),
    forbid: () => { authenticated = false; }, foreign: () => { owner = "foreign"; }, reads: () => reads };
}
const submission = { candidateSha256: "a".repeat(64), verdict: "needs_work", listenedEntireSource: false,
  checks: Object.fromEntries(contracts.YUE2_AUDITION_CHECKS.map(key => [key, "unreviewed"])),
  sections: [{ id: "opening", judgment: "unreviewed", notes: "" }], notes: "Needs careful full-source listening." };
test("real handlers append revisions, deduplicate latest retries, and isolate candidates", async () => {
  const f = fixture(); assert.equal(await f.call("latest"), null);
  const first = await f.call("record", { submission });
  assert.equal(first?.productionApproved, false);
  assert.equal(first?.reviewerId, "owner-a");
  assert.deepEqual(await f.call("record", { submission }), first);
  assert.equal(f.rows.length, 1);
  await f.call("record", { submission: { ...submission, verdict: "rejected", notes: "Audible artifacts throughout the ending." } });
  assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows.map(row => row.revision), [1, 2], "ordering does not depend on wall-clock uniqueness");
  assert.deepEqual(f.rows[0].submission, submission, "earlier judgment remains intact");
  assert.equal((await f.call("latest"))?.verdict, "rejected");
  assert.equal(await f.call("latest", { candidateSha256: "b".repeat(64) }), null);
  await assert.rejects(f.call("record", { submission, candidateSha256: "b".repeat(64) }));
  assert.equal(f.rows.length, 2);
});
test("service identity and owner/run scope are checked before writing", async () => {
  const f = fixture(); f.forbid();
  await assert.rejects(f.call("record", { submission }), /forbidden/);
  assert.equal(f.reads(), 0); assert.equal(f.rows.length, 0);
  const g = fixture(); g.foreign();
  await assert.rejects(g.call("record", { submission }), /ownership/);
  assert.equal(g.rows.length, 0);
});
