import assert from "node:assert/strict";

import { assertNoPendingChannelExpiration, assertR2KeyMayBePromoted } from "../../../convex/r2ExpirationFence";

const key = "owner/alice/channel/show/runs/run-fixture/final.mp4";
let expirationStatus: "pending" | "expired" | "canceled" | null = null;
let cleanupStatus: "processing" | "completed" | null = null;
const ctx = { db: {
  normalizeId: (_table: string, id: string) => id === "run-fixture" ? id : null,
  query: (table: string) => ({ withIndex: (_index: string, _filter: unknown) => ({
    take: async () => table === "r2AssetExpirations" && expirationStatus ? [{ status: expirationStatus }] : [],
    collect: async () => table === "r2AssetExpirations" && expirationStatus ? [{ status: expirationStatus }] : [],
    unique: async () => table === "runArtifactRetentions" && cleanupStatus
      ? { ownerId: "alice", status: cleanupStatus } : null,
    first: async () => table === "r2AssetExpirations" && expirationStatus === "pending"
      ? { status: "pending" } : table === "runArtifactRetentions" && cleanupStatus === "processing"
        ? { status: "processing" } : null,
  }) }),
} };

async function main() {
  await assertR2KeyMayBePromoted(ctx as never, "alice", key);
  for (const releaseKey of [
    `released-ordinary/v2/owner/alice/channel/show/runs/run-fixture/lofi-keyframe/1-${"a".repeat(64)}.png`,
    `released-final/v2/owner/alice/channel/show/runs/run-fixture/1-${"a".repeat(64)}.mp4`,
  ]) {
    await assert.rejects(() => assertR2KeyMayBePromoted(ctx as never, "alice", releaseKey), /classed release copies expire/);
  }
  expirationStatus = "pending";
  await assert.rejects(() => assertR2KeyMayBePromoted(ctx as never, "alice", key), /pending deletion/);
  await assert.rejects(() => assertNoPendingChannelExpiration(ctx as never, "channel-fixture" as never), /in-flight/);
  expirationStatus = "canceled";
  cleanupStatus = "processing";
  await assert.rejects(() => assertR2KeyMayBePromoted(ctx as never, "alice", key), /processing/);
  await assert.rejects(() => assertNoPendingChannelExpiration(ctx as never, "channel-fixture" as never), /in-flight/);
  cleanupStatus = "completed";
  await assertR2KeyMayBePromoted(ctx as never, "alice", key);
  await assertNoPendingChannelExpiration(ctx as never, "channel-fixture" as never);
  console.log("R2 expiration fence tests passed");
}
void main();
