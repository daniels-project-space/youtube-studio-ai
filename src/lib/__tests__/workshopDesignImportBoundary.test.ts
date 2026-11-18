import assert from "node:assert/strict";
import { channelBySlug, channelOptions, importDesign, list, remove } from "../../../convex/workshopDesignImports";
import { canonicalJson } from "../canonicalJson";
import { sha256Hex } from "../sha256";

type Row = { _id: string; ownerId: string; fingerprint: string; design: unknown; importedAt: number };
type Handler<T> = (ctx: unknown, args: unknown) => Promise<T>;
const handler = <T = unknown>(fn: unknown): Handler<T> => (fn as { _handler: Handler<T> })._handler;
type IndexBuilder = { eq: (key: string, value: unknown) => IndexBuilder };
const rows: Row[] = [];
const channelRows = [{ _id: "channel-a", ownerId: "owner-a", name: "Alpha", slug: "alpha" }, { _id: "channel-b", ownerId: "owner-b", name: "Beta", slug: "beta" }];
let identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
const ctx = {
  auth: { getUserIdentity: async () => identity },
  db: {
    get: async (id: string) => rows.find(row => row._id === id) ?? null,
    query: (table: string) => {
      if (table === "channels") return { withIndex: (_index: string, build: (q: IndexBuilder) => unknown) => {
        const filters: Record<string, unknown> = {};
        const q: IndexBuilder = { eq: (key, value) => { filters[key] = value; return q; } };
        build(q);
        return { take: async (limit: number) => channelRows.filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)).slice(0, limit) };
      } };
      assert.equal(table, "importedWorkshopDesigns");
      return { withIndex: (_index: string, build: (q: IndexBuilder) => unknown) => {
        const filters: Record<string, unknown> = {};
        const q = { eq: (key: string, value: unknown) => { filters[key] = value; return q; } };
        build(q);
        const matched = () => rows.filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof Row] === value));
        return { unique: async () => matched()[0] ?? null, order: () => ({ take: async (limit: number) => matched().slice(0, limit) }) };
      } };
    },
    insert: async (table: string, value: Omit<Row, "_id">) => {
      assert.equal(table, "importedWorkshopDesigns");
      const id = `import-${rows.length + 1}`;
      rows.push({ ...structuredClone(value), _id: id });
      return id;
    },
    delete: async (id: string) => { rows.splice(rows.findIndex(row => row._id === id), 1); },
  },
};

async function main() {
  const content = { version: "workshop-design-snapshot/v1", name: "Draft", family: "narrated_stock", entries: [{ block: "script_gen", params: { seconds: 300 } }] };
  const design = { ...content, fingerprint: sha256Hex(canonicalJson(content)) };
  const args = { ownerId: "owner-a", design };
  const first = await handler<{ id: string; reused: boolean }>(importDesign)(ctx, args);
  assert.equal(first.reused, false);
  assert.deepEqual(await handler(importDesign)(ctx, args), { id: first.id, reused: true });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["_id", "design", "fingerprint", "importedAt", "ownerId"]);
  assert.equal((await handler<unknown[]>(list)(ctx, { ownerId: "owner-a" })).length, 1);
  assert.deepEqual(await handler(channelOptions)(ctx, { ownerId: "owner-a" }), { channels: [{ id: "channel-a", name: "Alpha", slug: "alpha" }], truncated: false });
  assert.deepEqual(await handler(channelBySlug)(ctx, { ownerId: "owner-a", slug: "alpha" }), { channel: { id: "channel-a", name: "Alpha", slug: "alpha" }, ambiguous: false });
  assert.deepEqual(await handler(channelBySlug)(ctx, { ownerId: "owner-a", slug: "beta" }), { channel: null, ambiguous: false });
  channelRows.push({ _id: "channel-c", ownerId: "owner-a", name: "Duplicate", slug: "alpha" });
  assert.deepEqual(await handler(channelBySlug)(ctx, { ownerId: "owner-a", slug: "alpha" }), { channel: null, ambiguous: true });
  await assert.rejects(handler(channelBySlug)(ctx, { ownerId: "owner-a", slug: " alpha " }), /Invalid channel slug/);
  const contentV2 = { ...content, version: "workshop-design-snapshot/v2", channelDesign: { revision: 1, name: "Concept", niche: "History", persona: "Curious", palette: ["#123456"] } };
  const v2 = { ...contentV2, fingerprint: sha256Hex(canonicalJson(contentV2)) };
  const importedV2 = await handler<{ id: string }>(importDesign)(ctx, { ownerId: "owner-a", design: v2 });
  assert.deepEqual(rows.find(row => row._id === importedV2.id)?.design, v2);
  await assert.rejects(handler(importDesign)(ctx, { ownerId: "owner-a", design: { ...v2, channelDesign: { ...v2.channelDesign, niche: "Changed" } } }), /fingerprint/);

  await assert.rejects(handler(importDesign)(ctx, { ...args, design: { ...design, name: "Changed" } }), /fingerprint/);
  await assert.rejects(handler(importDesign)(ctx, { ...args, design: { ...design, approved: true } }));
  await assert.rejects(handler(importDesign)(ctx, { ...args, design: { ...design, release: { approved: true } } }));
  assert.equal(rows.length, 2);

  identity = { role: "owner", owner_id: "owner-b", subject: "owner-b" };
  await assert.rejects(handler(importDesign)(ctx, args), /owner access denied/);
  await assert.rejects(handler(remove)(ctx, { ownerId: "owner-b", designId: first.id, fingerprint: design.fingerprint }), /not found/);
  assert.equal((await handler<unknown[]>(list)(ctx, { ownerId: "owner-b" })).length, 0);
  identity = { role: "viewer", owner_id: "owner-a", subject: "viewer:owner-a" };
  await assert.rejects(handler(importDesign)(ctx, args), /viewer mutations/);
  await assert.rejects(handler(list)(ctx, { ownerId: "owner-a" }), /Owner verification/);
  await assert.rejects(handler(channelOptions)(ctx, { ownerId: "owner-a" }), /Owner verification/);
  await assert.rejects(handler(channelBySlug)(ctx, { ownerId: "owner-a", slug: "alpha" }), /Owner verification/);
  identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
  await assert.rejects(handler(remove)(ctx, { ownerId: "owner-a", designId: first.id, fingerprint: "wrong" }), /changed/);
  await handler(remove)(ctx, { ownerId: "owner-a", designId: first.id, fingerprint: design.fingerprint });
  await handler(remove)(ctx, { ownerId: "owner-a", designId: importedV2.id, fingerprint: v2.fingerprint });
  assert.equal(rows.length, 0);
  console.log("Workshop design import boundary passed");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
