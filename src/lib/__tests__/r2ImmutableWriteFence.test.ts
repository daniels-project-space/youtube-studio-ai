import assert from "node:assert/strict";

import { begin, finish } from "../../../convex/r2ImmutableWrites";
import { recordAsset } from "../../../convex/assets";
import { prepareExpiration } from "../../../convex/r2Retention";

const day = 86_400_000;
const now = Date.now();
const ownerId = "alice";
const runId = "run-one";
const channelId = "channel-one";
const key = `owner/${ownerId}/channel/show/runs/${runId}/quiz-year/quiz-year-${"a".repeat(64)}.mp4`;
const cropKey = `owner/${ownerId}/channel/show/runs/${runId}/novita/atlas-crops/shot-1/c01-${"b".repeat(12)}-${"c".repeat(16)}-A1-${"d".repeat(64)}.png`;
const claimId = "11111111-1111-4111-8111-111111111111";
const rows = new Map<string, Record<string, unknown>>([
  [runId, { _id: runId, ownerId, channelId, status: "running",
    youtubeVideoId: "abcdefghijk", releaseEvidenceStatus: "release_evidence_recorded",
    releaseEvidenceCertificateKey: "cert" }],
  ["another-run", { _id: "another-run", ownerId, channelId, status: "running" }],
  [channelId, { _id: channelId, ownerId, slug: "show", locked: false }],
  ["retention", { _id: "retention", ownerId, channelId, runId, status: "completed",
    certificateKey: "cert", releaseAt: now - 200 * day,
    retainUntil: now - 170 * day, releaseConfirmedAt: now - 199 * day,
    completedAt: now - 169 * day, releaseVideoId: "abcdefghijk",
    releaseYouTubeChannelId: "UC-one" }],
]);
let nextId = 1;
const db = {
  get: async (id: string) => rows.get(id) ?? null,
  normalizeId: (_table: string, id: string) => rows.has(id) ? id : null,
  insert: async (table: string, value: Record<string, unknown>) => {
    const id = `${table}:${nextId++}`;
    rows.set(id, { _id: id, ...value });
    return id;
  },
  patch: async (id: string, value: Record<string, unknown>) => { Object.assign(rows.get(id)!, value); },
  query: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const result = () => [...rows.values()].filter((row) =>
      (table === "runArtifactRetentions" ? row._id === "retention" :
        table === "assets" ? String(row._id).startsWith("assets:") :
          table === "r2ImmutableWrites" ? String(row._id).startsWith("r2ImmutableWrites:") :
            table === "r2AssetExpirations" ? String(row._id).startsWith("r2AssetExpirations:") : false) &&
      filters.every(([field, value]) => row[field] === value));
    const query = {
      withIndex: (_name: string, build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        const q = { eq(field: string, value: unknown) { filters.push([field, value]); return q; } };
        build(q); return query;
      },
      unique: async () => result()[0] ?? null,
      collect: async () => result(),
      take: async (n: number) => result().slice(0, n),
    };
    return query;
  },
};
const ctx = { auth: { getUserIdentity: async () => ({ role: "service", owner_id: ownerId,
  subject: "service:youtube-studio-ai" }) }, db };
const invoke = async <T>(definition: unknown, args: unknown): Promise<T> =>
  (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
const writeArgs = { ownerId, channelId, runId, r2Key: key, claimId };

async function main() {
  assert.deepEqual(await invoke(begin, writeArgs), { status: "active" });
  await assert.rejects(() => invoke(begin, { ...writeArgs,
    claimId: "22222222-2222-4222-8222-222222222222" }), /another active writer/);
  const assetArgs = { ownerId, channelId, runId, kind: "video", r2Key: key };
  await assert.rejects(() => invoke(recordAsset, assetArgs), /unwritten/);
  assert.deepEqual(await invoke(finish, writeArgs), { status: "finished" });
  const assetId = await invoke<string>(recordAsset, assetArgs);
  assert.ok(rows.has(assetId));
  const cropWriteArgs = { ...writeArgs, r2Key: cropKey };
  assert.deepEqual(await invoke(begin, cropWriteArgs), { status: "active" });
  assert.deepEqual(await invoke(finish, cropWriteArgs), { status: "finished" });
  await assert.rejects(() => invoke(recordAsset, { ...assetArgs, runId: "another-run" }), /mismatched/);
  Object.assign(rows.get(runId)!, { status: "ok", finishedAt: now - 200 * day });
  const foreignId = await db.insert("assets", { ownerId, channelId, runId: "another-run", kind: "video", r2Key: key });
  const expirationArgs = { ownerId, runId, r2Key: key, kind: "final_video",
    lastModifiedAt: now - 181 * day, etag: '"fixture-etag"' };
  await assert.rejects(() => invoke(prepareExpiration, expirationArgs), /another asset reference/);
  rows.delete(foreignId);
  const expiration = await invoke<{ status: string }>(prepareExpiration, expirationArgs);
  assert.equal(expiration.status, "pending");
  await assert.rejects(() => invoke(prepareExpiration, { ...expirationArgs, r2Key: cropKey }), /proven create-only asset/);
  const cropExpiration = await invoke<{ status: string }>(prepareExpiration, {
    ...expirationArgs, r2Key: cropKey, kind: "asset", lastModifiedAt: now - 31 * day,
  });
  assert.equal(cropExpiration.status, "pending");
  await assert.rejects(() => invoke(recordAsset, assetArgs), /expired/);
  await assert.rejects(() => invoke(finish, writeArgs), /deletion intent/);
  await assert.rejects(() => invoke(begin, writeArgs), /active owned run|deletion intent/);
  console.log("R2 immutable writer and asset-reference fence tests passed");
}
void main();
