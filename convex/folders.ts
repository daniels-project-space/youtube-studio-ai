/**
 * Channel folders — operator organization on the Channels page. A folder is a
 * named row; channels reference it by name (channels.folder). Deleting a
 * folder unfiles its channels (never deletes them).
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
    // Unfile member channels (never delete them).
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    for (const c of channels) {
      if (c.folder === folder.name) await ctx.db.patch(c._id, { folder: undefined });
    }
    await ctx.db.delete(args.folderId);
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
    for (const c of channels) {
      if (c.folder === folder.name) await ctx.db.patch(c._id, { folder: name });
    }
    await ctx.db.patch(args.folderId, { name });
  },
});
