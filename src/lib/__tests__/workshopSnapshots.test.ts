import assert from "node:assert/strict";
import { removeSnapshot, snapshot } from "../../../convex/workshopPipelineDrafts";
import { canonicalJson } from "../canonicalJson";
import { sha256Hex } from "../sha256";

const draft = { _id: "draft-a", ownerId: "owner-a", revision: 1, name: "One", family: "narrated_stock", entries: [{ block: "script_gen", params: { maxSeconds: 300 } }] };
const rows: Array<Record<string, unknown>> = [];
let identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
const ctx = {
  auth: { getUserIdentity: async () => identity },
  db: {
    get: async (id: string) => id === draft._id ? draft : rows.find(row => row._id === id) ?? null,
    query: () => ({ withIndex: (_name: string, build: (q: { eq: (key: string, value: unknown) => unknown }) => unknown) => {
      const filters: Record<string, unknown> = {};
      const q = { eq: (key: string, value: unknown) => { filters[key] = value; return q; } };
      build(q);
      return { unique: async () => rows.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null };
    } }),
    insert: async (_table: string, value: Record<string, unknown>) => { const id = `snapshot-${rows.length + 1}`; rows.push({ ...structuredClone(value), _id: id }); return id; },
    delete: async (id: string) => { const index = rows.findIndex(row => row._id === id); if (index >= 0) rows.splice(index, 1); },
  },
};
const handler = (snapshot as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ snapshotId: string; reused: boolean }> })._handler;
async function main() {
  const args = { ownerId: "owner-a", draftId: "draft-a", expectedRevision: 1 };
  const first = await handler(ctx, args);
  assert.equal(first.reused, false);
  assert.deepEqual(await handler(ctx, args), { snapshotId: first.snapshotId, reused: true });
  assert.equal(rows.length, 1);
  const expected = { version: "workshop-design-snapshot/v1", name: draft.name, family: draft.family, entries: draft.entries };
  assert.equal(rows[0]?.fingerprint, sha256Hex(canonicalJson(expected)));
  draft.entries[0]!.params.maxSeconds = 600; draft.revision = 2;
  assert.equal((rows[0]?.entries as typeof draft.entries)[0]?.params.maxSeconds, 300, "later draft edits must not change a snapshot");
  await assert.rejects(handler(ctx, args), /changed elsewhere/);
  assert.equal((await handler(ctx, { ...args, expectedRevision: 2 })).reused, false);
  identity = { role: "owner", owner_id: "owner-b", subject: "owner-b" };
  await assert.rejects(handler(ctx, { ...args, ownerId: "owner-b", expectedRevision: 2 }), /Draft not found/);
  assert.equal(rows.length, 2);
  const remove = (removeSnapshot as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<void> })._handler;
  await assert.rejects(remove(ctx, { ownerId: "owner-b", snapshotId: first.snapshotId, fingerprint: rows[0]!.fingerprint }), /Snapshot not found/);
  identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
  await assert.rejects(remove(ctx, { ownerId: "owner-a", snapshotId: first.snapshotId, fingerprint: "wrong" }), /identity changed/);
  await remove(ctx, { ownerId: "owner-a", snapshotId: first.snapshotId, fingerprint: rows[0]!.fingerprint });
  assert.equal(rows.length, 1);
  console.log("Workshop design snapshots are immutable, owner-scoped and revision-idempotent");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
