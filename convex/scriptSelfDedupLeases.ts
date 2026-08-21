import { mutation } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * This lease serializes the short R2 read → lexical comparison → write window
 * for one channel. Convex mutations are serializable, so two contenders that
 * both observe an empty channel cannot both become the holder.
 *
 * It is intentionally a lease rather than a permanent lock: a crashed Trigger
 * worker cannot indefinitely prevent future scripts from being measured. The
 * gate renews immediately before its R2 write and treats a lost lease as a
 * failed admission, never as an originality pass.
 */
export const SCRIPT_SELF_DEDUP_LEASE_MS = 120_000;

const leaseArgs = {
  ownerId: v.string(),
  channelId: v.id("channels"),
  runId: v.string(),
  leaseToken: v.string(),
};

function assertLeaseArgs(args: { runId: string; leaseToken: string }): void {
  if (!args.runId.trim() || args.runId.length > 500) {
    throw new Error("script self-dedup lease runId must contain 1-500 characters");
  }
  if (!args.leaseToken.trim() || args.leaseToken.length > 600) {
    throw new Error("script self-dedup lease token must contain 1-600 characters");
  }
}

async function assertChannelOwner(
  ctx: Pick<MutationCtx, "db">,
  channelId: Id<"channels">,
  ownerId: string,
): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error("script self-dedup lease channel owner mismatch");
  }
}

export const acquire = mutation({
  args: leaseArgs,
  returns: v.union(
    v.object({ kind: v.literal("acquired"), leaseExpiresAt: v.number() }),
    v.object({ kind: v.literal("busy"), retryAfterMs: v.number() }),
  ),
  handler: async (ctx, args) => {
    assertLeaseArgs(args);
    await assertChannelOwner(ctx, args.channelId, args.ownerId);
    const now = Date.now();
    const existing = await ctx.db
      .query("scriptSelfDedupLeases")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    const leaseExpiresAt = now + SCRIPT_SELF_DEDUP_LEASE_MS;

    if (!existing) {
      await ctx.db.insert("scriptSelfDedupLeases", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        leaseToken: args.leaseToken,
        acquiredAt: now,
        updatedAt: now,
        leaseExpiresAt,
      });
      return { kind: "acquired" as const, leaseExpiresAt };
    }

    if (
      existing.ownerId === args.ownerId
      && existing.runId === args.runId
      && existing.leaseToken === args.leaseToken
    ) {
      await ctx.db.patch(existing._id, {
        runId: args.runId,
        updatedAt: now,
        leaseExpiresAt,
      });
      return { kind: "acquired" as const, leaseExpiresAt };
    }

    if (existing.leaseExpiresAt <= now) {
      await ctx.db.patch(existing._id, {
        ownerId: args.ownerId,
        runId: args.runId,
        leaseToken: args.leaseToken,
        acquiredAt: now,
        updatedAt: now,
        leaseExpiresAt,
      });
      return { kind: "acquired" as const, leaseExpiresAt };
    }

    return {
      kind: "busy" as const,
      retryAfterMs: Math.max(20, Math.min(existing.leaseExpiresAt - now, 1_000)),
    };
  },
});

export const renew = mutation({
  args: leaseArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertLeaseArgs(args);
    await assertChannelOwner(ctx, args.channelId, args.ownerId);
    const existing = await ctx.db
      .query("scriptSelfDedupLeases")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    const now = Date.now();
    if (
      !existing
      || existing.ownerId !== args.ownerId
      || existing.runId !== args.runId
      || existing.leaseToken !== args.leaseToken
      || existing.leaseExpiresAt <= now
    ) {
      return false;
    }
    await ctx.db.patch(existing._id, {
      updatedAt: now,
      leaseExpiresAt: now + SCRIPT_SELF_DEDUP_LEASE_MS,
    });
    return true;
  },
});

export const release = mutation({
  args: leaseArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertLeaseArgs(args);
    await assertChannelOwner(ctx, args.channelId, args.ownerId);
    const existing = await ctx.db
      .query("scriptSelfDedupLeases")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (
      !existing
      || existing.ownerId !== args.ownerId
      || existing.runId !== args.runId
      || existing.leaseToken !== args.leaseToken
    ) {
      return false;
    }
    await ctx.db.delete(existing._id);
    return true;
  },
});
