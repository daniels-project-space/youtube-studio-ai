/**
 * OWNER MODULE LOCKS — "no AI worker may change this module's source."
 *
 * Fleet-wide and keyed by the module's GOLDEN_MODULES key, which is what the
 * catalog page already renders, so the badge needs no second mapping to drift
 * against. This is deliberately NOT channelModuleLocks: that freezes one
 * module's configuration for a single channel, while this freezes the module's
 * code for everyone.
 *
 * State lives here rather than on a filesystem because the studio runs on
 * Vercel, where the filesystem is read-only — the first version of this feature
 * wrote marker files from an API route and failed on every click in production.
 * The workstation guard still reads marker files; a small sync mirrors this
 * table onto that disk.
 *
 * Locking and unlocking are owner-only, matching channels.lockChannel: an
 * automated caller authenticates as "service" and is refused, so a worker
 * cannot unlock itself even with a valid studio identity.
 */
import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { mutation, query } from "./studioFunctions";

async function requireOwnerActor(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
  purpose: string,
): Promise<string> {
  const identity = (await ctx.auth.getUserIdentity()) as
    | { role?: unknown; subject?: unknown }
    | null;
  if (!identity || identity.role !== "owner" || typeof identity.subject !== "string") {
    throw new Error(`${purpose} requires an interactive studio owner identity`);
  }
  return identity.subject;
}

/** Locked modules only. An absent row means unlocked, which is the default. */
export const list = query({
  args: { ownerId: v.string() },
  returns: v.array(
    v.object({
      moduleKey: v.string(),
      lockedAt: v.number(),
      lockedBy: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ownerModuleLocks")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows
      .filter((row) => row.locked)
      .map((row) => ({
        moduleKey: row.moduleKey,
        lockedAt: row.lockedAt,
        lockedBy: row.lockedBy,
      }));
  },
});

/**
 * The workstation mirror's read path.
 *
 * Internal, not public: the sync runs on the owner's machine with Convex admin
 * credentials, and the token-signing key the studio identities need exists only
 * in the Vercel environment. An internal function is reachable by the CLI and
 * never by a browser, which is a tighter boundary than a public query would be,
 * not a looser one.
 */
export const listForSync = internalQuery({
  args: { ownerId: v.string() },
  returns: v.array(v.object({ moduleKey: v.string(), lockedAt: v.number(), lockedBy: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ownerModuleLocks")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows
      .filter((row) => row.locked)
      .map((row) => ({ moduleKey: row.moduleKey, lockedAt: row.lockedAt, lockedBy: row.lockedBy }));
  },
});

/**
 * Migration seam for locks that predate this table. It can only ever LOCK.
 *
 * Deliberately one-way. An internal mutation is callable by anything holding
 * deploy credentials on the workstation, so an unlock here would be a way
 * around the owner-only rule that protects every other path. Adding a lock
 * carries no such risk.
 */
export const seedLock = internalMutation({
  args: { ownerId: v.string(), moduleKey: v.string() },
  returns: v.object({ moduleKey: v.string(), locked: v.literal(true) }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ownerModuleLocks")
      .withIndex("by_owner_module", (q) =>
        q.eq("ownerId", args.ownerId).eq("moduleKey", args.moduleKey),
      )
      .first();
    if (existing) {
      if (!existing.locked) {
        await ctx.db.patch(existing._id, { locked: true, lockedAt: Date.now(), lockedBy: "migration" });
      }
    } else {
      await ctx.db.insert("ownerModuleLocks", {
        ownerId: args.ownerId,
        moduleKey: args.moduleKey,
        locked: true,
        lockedAt: Date.now(),
        lockedBy: "migration",
      });
    }
    return { moduleKey: args.moduleKey, locked: true as const };
  },
});

export const setLock = mutation({
  args: {
    ownerId: v.string(),
    moduleKey: v.string(),
    locked: v.boolean(),
  },
  returns: v.object({ moduleKey: v.string(), locked: v.boolean(), lockedBy: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireOwnerActor(ctx, "ownerModuleLocks.setLock");
    const existing = await ctx.db
      .query("ownerModuleLocks")
      .withIndex("by_owner_module", (q) =>
        q.eq("ownerId", args.ownerId).eq("moduleKey", args.moduleKey),
      )
      .first();

    if (existing) {
      // Re-locking keeps the original provenance, so an accidental second click
      // does not rewrite who locked it and when.
      const keepProvenance = args.locked && existing.locked;
      await ctx.db.patch(existing._id, {
        locked: args.locked,
        lockedAt: keepProvenance ? existing.lockedAt : Date.now(),
        lockedBy: keepProvenance ? existing.lockedBy : actor,
      });
    } else {
      await ctx.db.insert("ownerModuleLocks", {
        ownerId: args.ownerId,
        moduleKey: args.moduleKey,
        locked: args.locked,
        lockedAt: Date.now(),
        lockedBy: actor,
      });
    }
    return { moduleKey: args.moduleKey, locked: args.locked, lockedBy: actor };
  },
});
