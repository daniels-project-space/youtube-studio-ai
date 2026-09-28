import assert from "node:assert/strict";
import test from "node:test";

import { recordAsset } from "../../../convex/assets";
import { authorizeDeletion, claimDue, complete } from "../../../convex/studioR2AssetRetentions";
import {
  classifyStudioR2Asset, FINAL_VIDEO_RETENTION_MS, ORDINARY_ASSET_RETENTION_MS,
} from "../studioR2AssetRetention";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
class MemoryDb {
  private count = 0;
  tables = new Map<string, Row[]>();
  rows(name: string): Row[] { return this.tables.get(name) ?? []; }
  async insert(name: string, data: Record<string, unknown>): Promise<string> {
    const id = `${name}-${++this.count}`;
    this.tables.set(name, [...this.rows(name), { ...data, _id: id, _creationTime: this.count }]);
    return id;
  }
  async get(id: string): Promise<Row | null> {
    return [...this.tables.values()].flat().find((row) => row._id === id) ?? null;
  }
  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id); if (!row) throw new Error("missing row"); Object.assign(row, patch);
  }
  async delete(id: string): Promise<void> {
    for (const [name, rows] of this.tables) this.tables.set(name, rows.filter((row) => row._id !== id));
  }
  normalizeId(_table: string, id: string): string { return id; }
  query(name: string) {
    const conditions: Array<(row: Row) => boolean> = [];
    const query = {
      withIndex: (_index: string, callback: (q: unknown) => unknown) => {
        const q = {
          eq: (field: string, value: unknown) => { conditions.push((row: Row) => row[field] === value); return q; },
          lte: (field: string, value: number) => { conditions.push((row: Row) => typeof row[field] === "number" && row[field] <= value); return q; },
        }; callback(q); return query;
      },
      take: async (limit: number) => this.rows(name).filter((row) => conditions.every((test) => test(row))).slice(0, limit),
      first: async () => (await query.take(1))[0] ?? null,
    };
    return query;
  }
}

function fixture() {
  const db = new MemoryDb();
  const ownerId = "owner-a";
  const invoke = async <T>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler: (ctx: unknown, value: unknown) => Promise<T> })._handler({
      db, auth: { getUserIdentity: async () => ({ role: "service", owner_id: ownerId, subject: "service:studio" }) },
    }, args);
  const seed = async () => {
    const channelId = await db.insert("channels", { ownerId, slug: "birds" });
    const runId = await db.insert("runs", { ownerId, channelId, status: "ok", finishedAt: Date.now() });
    return { channelId, runId };
  };
  return { db, ownerId, invoke, seed };
}

test("only exact indexed run-local media receives a 30 or 180 day ledger", async () => {
  const f = fixture(); const { channelId, runId } = await f.seed();
  const prefix = `owner/${f.ownerId}/channel/birds/runs/${runId}/`;
  const ordinary = await f.invoke<string>(recordAsset, { ownerId: f.ownerId, channelId, runId,
    kind: "music", r2Key: `${prefix}score.wav` });
  assert.equal(await f.invoke<string>(recordAsset, { ownerId: f.ownerId, channelId, runId,
    kind: "music", r2Key: `${prefix}score.wav` }), ordinary);
  const final = await f.invoke<string>(recordAsset, { ownerId: f.ownerId, channelId, runId,
    kind: "video", r2Key: `${prefix}final.mp4` });
  await f.invoke<string>(recordAsset, { ownerId: f.ownerId, channelId, runId,
    kind: "image", r2Key: `owner/${f.ownerId}/channel/birds/library/reusable.png` });
  const ledger = f.db.rows("studioR2AssetRetentions");
  assert.equal(ledger.length, 2);
  assert.equal(ledger.find((row) => row.assetId === ordinary)!.expiresAt,
    Number(ledger.find((row) => row.assetId === ordinary)!.createdAt) + ORDINARY_ASSET_RETENTION_MS);
  assert.equal(ledger.find((row) => row.assetId === final)!.expiresAt,
    Number(ledger.find((row) => row.assetId === final)!.createdAt) + FINAL_VIDEO_RETENTION_MS);
  assert.equal(classifyStudioR2Asset({ ownerId: f.ownerId, channelSlug: "birds", runId,
    kind: "video", r2Key: `${prefix}final.json` }), null);
});

test("reusable references hold deletion and a fenced lease requires R2 acknowledgement", async () => {
  const f = fixture(); const { channelId, runId } = await f.seed();
  const key = `owner/${f.ownerId}/channel/birds/runs/${runId}/frame.png`;
  const assetId = await f.invoke<string>(recordAsset, { ownerId: f.ownerId, channelId, runId,
    kind: "image", r2Key: key });
  const row = f.db.rows("studioR2AssetRetentions")[0];
  const due = Number(row.expiresAt) + 1;
  const token = "a".repeat(64);
  await f.db.insert("studioAssetLibraryEntries", { ownerId: f.ownerId, entry: { resource: { r2Key: key } } });
  assert.equal(await f.invoke(claimDue, { ownerId: f.ownerId, now: due, leaseToken: token }), null);
  f.db.tables.set("studioAssetLibraryEntries", []);
  const retry = due + 24 * 60 * 60 * 1_000;
  const claim = await f.invoke<{ retentionId: string }>(claimDue, { ownerId: f.ownerId, now: retry, leaseToken: token });
  assert.equal(claim.retentionId, row._id);
  await assert.rejects(f.invoke(authorizeDeletion, { ownerId: f.ownerId, retentionId: row._id,
    now: retry, leaseToken: "b".repeat(64) }), /authority/);
  await assert.rejects(f.invoke(complete, { ownerId: f.ownerId, retentionId: row._id,
    now: retry, leaseToken: token, deletedKey: key, acknowledged: false }), /acknowledgement/);
  assert.ok(await f.db.get(assetId));
  const grant = await f.invoke<{ expiresAt: number }>(authorizeDeletion, { ownerId: f.ownerId,
    retentionId: row._id, now: retry, leaseToken: token });
  assert.ok(grant.expiresAt > retry && grant.expiresAt <= retry + 20_000);
  await f.invoke(complete, { ownerId: f.ownerId, retentionId: row._id,
    now: retry, leaseToken: token, deletedKey: key, acknowledged: true });
  assert.equal(await f.db.get(assetId), null);
  assert.equal(row.status, "deleted");
});

test("a newly promoted reusable resource revokes an existing deletion lease", async () => {
  const f = fixture(); const { channelId, runId } = await f.seed();
  const key = `owner/${f.ownerId}/channel/birds/runs/${runId}/still.png`;
  await f.invoke(recordAsset, { ownerId: f.ownerId, channelId, runId, kind: "image", r2Key: key });
  const row = f.db.rows("studioR2AssetRetentions")[0];
  const due = Number(row.expiresAt) + 1;
  const token = "c".repeat(64);
  await f.invoke(claimDue, { ownerId: f.ownerId, now: due, leaseToken: token });
  await f.db.insert("studioAssetLibraryEntries", { ownerId: f.ownerId, entry: { resource: { r2Key: key } } });
  await assert.rejects(f.invoke(authorizeDeletion, { ownerId: f.ownerId,
    retentionId: row._id, now: due, leaseToken: token }), /authority/);
});
