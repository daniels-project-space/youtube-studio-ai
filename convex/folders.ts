/**
 * Channel folders — operator organization on the Channels page. A folder is a
 * named row; channels reference it by name (channels.folder). Deleting a
 * folder unfiles its channels (never deletes them).
 */
import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { patchChannelRespectingLock } from "./channelLock";

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelFolders")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const create = mutation({
  args: { ownerId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim().slice(0, 40);
    if (!name) throw new Error("folder name required");
    const existing = await ctx.db
      .query("channelFolders")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    if (existing.some((f) => f.name === name)) return null; // idempotent
    return await ctx.db.insert("channelFolders", { ownerId: args.ownerId, name });
  },
});

export const remove = mutation({
  args: { ownerId: v.string(), folderId: v.id("channelFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== args.ownerId) return;
    // Unfile member channels (never delete them). A locked channel retains its
    // organization state until the owner explicitly releases that channel lock.
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const members = channels.filter((channel) => channel.folder === folder.name);
    const lockedMembers = members.filter((channel) => channel.locked === true);
    if (lockedMembers.length) {
      for (const c of lockedMembers) {
        await patchChannelRespectingLock(
          ctx,
          c._id,
          { folder: undefined },
          "folders.remove unfile channel",
        );
      }
      // Keep the folder too: otherwise frozen members would point at an
      // invisible, orphaned room.
      return { lockedSkipped: lockedMembers.length };
    }
    for (const c of members) {
      const outcome = await patchChannelRespectingLock(
        ctx,
        c._id,
        { folder: undefined },
        "folders.remove unfile channel",
      );
      if (outcome.state === "channel_locked") return { lockedSkipped: 1 };
    }
    await ctx.db.delete(args.folderId);
    return { lockedSkipped: 0 };
  },
});

export const rename = mutation({
  args: { ownerId: v.string(), folderId: v.id("channelFolders"), name: v.string() },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== args.ownerId) return;
    const name = args.name.trim().slice(0, 40);
    if (!name) return;
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const members = channels.filter((channel) => channel.folder === folder.name);
    const lockedMembers = members.filter((channel) => channel.locked === true);
    if (lockedMembers.length) {
      for (const c of lockedMembers) {
        await patchChannelRespectingLock(
          ctx,
          c._id,
          { folder: name },
          "folders.rename move channel",
        );
      }
      // Keep the old name and all memberships together; a partial rename
      // would strand a frozen channel in an orphaned room.
      return { lockedSkipped: lockedMembers.length };
    }
    for (const c of members) {
      const outcome = await patchChannelRespectingLock(
        ctx,
        c._id,
        { folder: name },
        "folders.rename move channel",
      );
      if (outcome.state === "channel_locked") return { lockedSkipped: 1 };
    }
    await ctx.db.patch(args.folderId, { name });
    return { lockedSkipped: 0 };
  },
});
