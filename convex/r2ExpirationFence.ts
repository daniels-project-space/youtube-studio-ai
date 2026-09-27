import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

import { assertStudioAssetLibraryEntry } from "../src/engine/studioAssetLibrary";
import { assertStudioReusableMediaEntry } from "../src/engine/studioReusableMedia";

type FenceCtx = Pick<QueryCtx | MutationCtx, "db">;
const MAX_REFERENCE_ROWS = 2_000;

/** Every revision counts; a large/unreadable inventory aborts deletion. */
export async function assertNoReusableReference(ctx: FenceCtx, ownerId: string, r2Key: string): Promise<void> {
  if (!ownerId) throw new Error("R2 retention owner is missing");
  const [library, media] = await Promise.all([
    ctx.db.query("studioAssetLibraryEntries")
      .take(MAX_REFERENCE_ROWS + 1),
    ctx.db.query("studioReusableMediaAssets")
      .take(MAX_REFERENCE_ROWS + 1),
  ]);
  if (library.length > MAX_REFERENCE_ROWS || media.length > MAX_REFERENCE_ROWS) {
    throw new Error("R2 retention reference inventory exceeds the verified bound");
  }
  if (library.some((row) => assertStudioAssetLibraryEntry(row.entry).resource?.r2Key === r2Key) ||
      media.some((row) => assertStudioReusableMediaEntry(row.entry).resource.r2Key === r2Key)) {
    throw new Error("R2 retention key is referenced by the reusable asset library");
  }
}

/** Promotions after a deletion intent must copy bytes to a new unique key. */
export async function assertR2KeyMayBePromoted(ctx: FenceCtx, ownerId: string, r2Key: string): Promise<void> {
  const keyOwner = /^owner\/([^/]+)\//u.exec(r2Key)?.[1];
  if (keyOwner && keyOwner !== ownerId) throw new Error("R2 library resource belongs to another owner");
  const rows = await ctx.db.query("r2AssetExpirations")
    .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("r2Key", r2Key))
    .collect();
  if (rows.some((row) => row.status === "pending" || row.status === "expired")) {
    throw new Error("R2 object is pending deletion or already expired; promote a unique copied key");
  }
  const runIdPart = /^owner\/[^/]+\/channel\/[^/]+\/runs\/([^/]+)\//u.exec(r2Key)?.[1];
  const runId = runIdPart ? ctx.db.normalizeId("runs", runIdPart) : null;
  if (runId) {
    const retention = await ctx.db.query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", runId)).unique();
    if (retention?.ownerId === ownerId && retention.status === "processing") {
      throw new Error("R2 run cleanup is processing; promote a unique copied key after it finishes");
    }
  }
}

/** Owner lock waits until an in-flight R2 delete reaches a durable outcome. */
export async function assertNoPendingChannelExpiration(ctx: FenceCtx, channelId: Id<"channels">): Promise<void> {
  const [pending, processing] = await Promise.all([
    ctx.db.query("r2AssetExpirations")
      .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "pending"))
      .first(),
    ctx.db.query("runArtifactRetentions")
      .withIndex("by_channel_status", (q) => q.eq("channelId", channelId).eq("status", "processing"))
      .first(),
  ]);
  if (pending || processing) throw new Error("channel has an in-flight R2 cleanup; retry locking after reconciliation");
}
