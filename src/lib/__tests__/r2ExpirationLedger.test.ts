import assert from "node:assert/strict";

import { confirmExpiration, prepareExpiration } from "../../../convex/r2Retention";

const day = 86_400_000;
const now = Date.now();
const runId = "run-fixture";
const channelId = "channel-fixture";
const key = `owner/alice/channel/show/runs/${runId}/final.mp4`;
const rows = new Map<string, Record<string, unknown>>([
  [runId, { _id: runId, ownerId: "alice", channelId, status: "ok", finishedAt: now - 200 * day, videoAssetId: "asset-fixture" }],
  [channelId, { _id: channelId, ownerId: "alice", slug: "show", locked: false }],
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
      withIndex: (_name: string, _fn: unknown) => ({
        unique: async () => table === "r2AssetExpirations" ? rows.get("expiration-fixture") ?? null : null,
        collect: async () => table === "assets" ? [...rows.values()].filter((row) => row.kind === "video") : [],
      }),
    }),
  },
};
const prepare = (prepareExpiration as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ id: string; status: string }> })._handler;
const confirm = (confirmExpiration as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;

async function main() {
  const prepared = await prepare(ctx, { ownerId: "alice", runId, r2Key: key,
    kind: "final_video", lastModifiedAt: now - 181 * day });
  assert.deepEqual(prepared, { id: "expiration-fixture", status: "pending" });
  assert.ok(rows.has("asset-fixture"), "preparation cannot remove playback metadata before R2 deletion");
  const confirmed = await confirm(ctx, { ownerId: "alice", expirationId: prepared.id }) as { status: string };
  assert.equal(confirmed.status, "expired");
  assert.equal(rows.has("asset-fixture"), false);
  assert.equal(rows.get(runId)?.videoAssetId, undefined);
  assert.equal((await confirm(ctx, { ownerId: "alice", expirationId: prepared.id }) as { status: string }).status, "expired");
  console.log("R2 expiration ledger tests passed");
}
void main();
