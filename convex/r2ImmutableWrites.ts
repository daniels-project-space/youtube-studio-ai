import { v } from "convex/values";

import { isManagedRetentionKey } from "../src/lib/r2AssetRetention";
import { mutation, requireStudioServiceIdentity } from "./studioFunctions";

const args = { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"),
  r2Key: v.string(), claimId: v.string() };

/** Reserve an exact, content-addressed key before any R2 upload starts. */
export const begin = mutation({
  args,
  handler: async (ctx, input) => {
    await requireStudioServiceIdentity(ctx, input.ownerId, "R2 immutable write reservation");
    if (!isManagedRetentionKey(input.r2Key) || !/^[a-f0-9-]{36}$/iu.test(input.claimId)) {
      throw new Error("R2 immutable write key or claim is invalid");
    }
    const [run, channel] = await Promise.all([ctx.db.get(input.runId), ctx.db.get(input.channelId)]);
    if (!run || !channel || run.ownerId !== input.ownerId || run.channelId !== input.channelId ||
        channel.ownerId !== input.ownerId || ["ok", "failed", "canceled"].includes(run.status) ||
        !input.r2Key.startsWith(`owner/${input.ownerId}/channel/${channel.slug}/runs/${input.runId}/`)) {
      throw new Error("R2 immutable write is outside its active owned run");
    }
    const prior = await ctx.db.query("r2ImmutableWrites")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", input.ownerId).eq("r2Key", input.r2Key)).unique();
    if (prior) {
      if (prior.runId !== input.runId || prior.channelId !== input.channelId ||
          (prior.status === "active" && prior.claimId !== input.claimId)) {
        throw new Error("R2 immutable key has another active writer");
      }
      return { status: prior.status };
    }
    await ctx.db.insert("r2ImmutableWrites", { ...input, status: "active", startedAt: Date.now() });
    return { status: "active" as const };
  },
});

/** Acknowledged upload or full-byte idempotent replay closes the write fence. */
export const finish = mutation({
  args: { ...args, etag: v.string(), lastModifiedAt: v.number(), byteLength: v.number() },
  handler: async (ctx, input) => {
    await requireStudioServiceIdentity(ctx, input.ownerId, "R2 immutable write completion");
    const row = await ctx.db.query("r2ImmutableWrites")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", input.ownerId).eq("r2Key", input.r2Key)).unique();
    if (!row || row.runId !== input.runId || row.channelId !== input.channelId ||
        row.claimId !== input.claimId) throw new Error("R2 immutable write claim changed");
    if (!/^"?[a-f0-9]{32}(?:-[0-9]+)?"?$/iu.test(input.etag) ||
        !Number.isSafeInteger(input.lastModifiedAt) || input.lastModifiedAt < row.startedAt - 1_000 ||
        input.lastModifiedAt > Date.now() + 1_000 ||
        !Number.isSafeInteger(input.byteLength) || input.byteLength < 1) {
      throw new Error("R2 immutable write lacks exact stored object identity");
    }
    if (row.status === "finished") {
      if (row.etag !== input.etag || row.lastModifiedAt !== input.lastModifiedAt ||
          row.byteLength !== input.byteLength) throw new Error("R2 immutable write object identity changed");
    } else await ctx.db.patch(row._id, {
      status: "finished", finishedAt: Date.now(), etag: input.etag,
      lastModifiedAt: input.lastModifiedAt, byteLength: input.byteLength,
    });
    return { status: "finished" as const };
  },
});
