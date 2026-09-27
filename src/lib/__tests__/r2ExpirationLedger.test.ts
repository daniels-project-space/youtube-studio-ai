import assert from "node:assert/strict";

import { authorizeExpirationDelete, confirmExpiration, prepareExpiration } from "../../../convex/r2Retention";

const day = 86_400_000;
const now = Date.now();
const releaseAt = now - 200 * day;
const runId = "run-fixture";
const channelId = "channel-fixture";
const key = `owner/alice/channel/show/runs/${runId}/final.mp4`;
const rows = new Map<string, Record<string, unknown>>([
  [runId, { _id: runId, ownerId: "alice", channelId, status: "ok", finishedAt: now - 200 * day,
    youtubeVideoId: "abcdefghijk", videoAssetId: "asset-fixture",
    releaseEvidenceStatus: "release_evidence_recorded", releaseEvidenceCertificateKey: "cert-fixture" }],
  [channelId, { _id: channelId, ownerId: "alice", slug: "show", locked: false }],
  ["retention-fixture", { _id: "retention-fixture", ownerId: "alice", runId,
    channelId, certificateKey: "cert-fixture",
    status: "completed", releaseAt, retainUntil: now - 170 * day,
    releaseConfirmedAt: now - 199 * day, completedAt: now - 169 * day,
    releaseVideoId: "abcdefghijk", releaseYouTubeChannelId: "UC-fixture" }],
  ["connector-fixture", { _id: "connector-fixture", ownerId: "alice", channelId,
    status: "active", tokenVersion: 1, ytChannelId: "UC-fixture" }],
  ["asset-fixture", { _id: "asset-fixture", ownerId: "alice", channelId, runId, kind: "video", r2Key: key }],
]);
const ctx = {
  auth: { getUserIdentity: async () => ({ role: "service", owner_id: "alice", subject: "service:youtube-studio-ai" }) },
  db: {
    get: async (id: string) => rows.get(id) ?? null,
    normalizeId: (_table: string, id: string) => rows.has(id) ? id : null,
    insert: async (_table: string, value: Record<string, unknown>) => {
      rows.set("expiration-fixture", { _id: "expiration-fixture", ...value });
      return "expiration-fixture";
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      Object.assign(rows.get(id)!, patch);
    },
    delete: async (id: string) => { rows.delete(id); },
    query: (table: string) => ({
      take: async () => [],
      withIndex: (_name: string, _fn: unknown) => ({
        unique: async () => table === "r2AssetExpirations" ? rows.get("expiration-fixture") ?? null
          : table === "runArtifactRetentions" ? rows.get("retention-fixture") ?? null : null,
        collect: async () => table === "assets" ? [...rows.values()].filter((row) => row.kind === "video") : [],
        take: async () => [],
      }),
    }),
  },
};
const prepare = (prepareExpiration as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ id: string; status: string }> })._handler;
const confirm = (confirmExpiration as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
const authorize = (authorizeExpirationDelete as unknown as {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;

async function main() {
  rows.get("retention-fixture")!.status = "pending";
  await assert.rejects(() => prepare(ctx, { ownerId: "alice", runId, r2Key: key,
    kind: "final_video", lastModifiedAt: now - 181 * day, etag: '"fixture-etag"' }), /completed/);
  rows.get("retention-fixture")!.status = "completed";
  const prepared = await prepare(ctx, { ownerId: "alice", runId, r2Key: key,
    kind: "final_video", lastModifiedAt: now - 181 * day, etag: '"fixture-etag"' });
  assert.deepEqual(prepared, { id: "expiration-fixture", status: "pending" });
  assert.ok(rows.has("asset-fixture"), "preparation cannot remove playback metadata before R2 deletion");
  const authority = { ownerId: "alice", expirationId: prepared.id, connectorId: "connector-fixture",
    connectorVersion: 1, observedAt: Date.now(),
    observation: { videoId: "abcdefghijk", channelId: "UC-fixture",
      publishedAt: new Date(releaseAt).toISOString(), privacyStatus: "private", uploadStatus: "processed" } };
  await assert.rejects(() => authorize(ctx, authority), /not currently public/);
  await authorize(ctx, { ...authority, observation: { ...authority.observation, privacyStatus: "public" } });
  const confirmed = await confirm(ctx, { ownerId: "alice", expirationId: prepared.id }) as { status: string };
  assert.equal(confirmed.status, "expired");
  assert.equal(rows.has("asset-fixture"), false);
  assert.equal(rows.get(runId)?.videoAssetId, undefined);
  assert.equal((await confirm(ctx, { ownerId: "alice", expirationId: prepared.id }) as { status: string }).status, "expired");
  console.log("R2 expiration ledger tests passed");
}
void main();
