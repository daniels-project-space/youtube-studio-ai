/**
 * Mutable organization for immutable episode media.
 *
 * Media rows are provenance-bound and never change after promotion. Folder
 * membership therefore lives in a separate, owner/channel-scoped relation so
 * an operator can reorganize the library without changing what a pipeline
 * selected or what a release certificate proved.
 */
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";

export const DEFAULT_EPISODE_ASSET_FOLDER = "Episode assets" as const;

type FolderContext = Pick<MutationCtx, "db">;

async function ownedChannel(
  ctx: FolderContext,
  ownerId: string,
  channelId: string,
) {
  const channel = await ctx.db.get(channelId as never) as { _id: string; ownerId: string } | null;
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error("studioEpisodeAssetFolders: channel is not owned by this Studio owner");
  }
  return channel;
}

/**
 * Future automated episode promotion calls this helper so newly admitted
 * media is filed consistently without making folder membership part of the
 * immutable media contract. Existing manual placement is always preserved.
 */
export async function ensureEpisodeAssetFolderAssignment(
  ctx: FolderContext,
  input: { ownerId: string; channelId: string; assetFingerprint: string },
): Promise<string> {
  const existingAssignment = await ctx.db
    .query("studioEpisodeAssetFolderAssignments")
    .withIndex("by_owner_asset", (q) =>
      q.eq("ownerId", input.ownerId).eq("assetFingerprint", input.assetFingerprint),
    )
    .unique();
  if (existingAssignment) return String(existingAssignment.folderId);

  const folders = await ctx.db
    .query("studioEpisodeAssetFolders")
    .withIndex("by_owner_channel", (q) =>
      q.eq("ownerId", input.ownerId).eq("channelId", input.channelId as never),
    )
    .collect();
  const defaultFolder = folders.find((folder) => folder.name === DEFAULT_EPISODE_ASSET_FOLDER)
    ?? await ctx.db.insert("studioEpisodeAssetFolders", {
      ownerId: input.ownerId,
      channelId: input.channelId as never,
      name: DEFAULT_EPISODE_ASSET_FOLDER,
      createdAt: Date.now(),
    });
  const folderId = typeof defaultFolder === "string" ? defaultFolder : String(defaultFolder._id);
  await ctx.db.insert("studioEpisodeAssetFolderAssignments", {
    ownerId: input.ownerId,
    channelId: input.channelId as never,
    folderId: folderId as never,
    assetFingerprint: input.assetFingerprint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return folderId;
}

export const listForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio episode asset folders");
    const [folders, assignments] = await Promise.all([
      ctx.db.query("studioEpisodeAssetFolders")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect(),
      ctx.db.query("studioEpisodeAssetFolderAssignments")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect(),
    ]);
    return {
      folders: folders.map((folder) => ({
        _id: folder._id,
        channelId: folder.channelId,
        name: folder.name,
        createdAt: folder.createdAt,
      })),
      assignments: assignments.map((assignment) => ({
        _id: assignment._id,
        channelId: assignment.channelId,
        folderId: assignment.folderId,
        assetFingerprint: assignment.assetFingerprint,
        updatedAt: assignment.updatedAt,
      })),
    };
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio episode asset folder creation");
    await ownedChannel(ctx, args.ownerId, args.channelId);
    const name = args.name.trim().slice(0, 40);
    if (!name) throw new Error("episode asset folder name required");
    const existing = await ctx.db.query("studioEpisodeAssetFolders")
      .withIndex("by_owner_channel", (q) => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId))
      .collect();
    if (existing.some((folder) => folder.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("episode asset folder name already exists");
    }
    return await ctx.db.insert("studioEpisodeAssetFolders", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      name,
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: {
    ownerId: v.string(),
    folderId: v.id("studioEpisodeAssetFolders"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio episode asset folder rename");
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== args.ownerId) throw new Error("episode asset folder unavailable");
    const name = args.name.trim().slice(0, 40);
    if (!name) throw new Error("episode asset folder name required");
    const existing = await ctx.db.query("studioEpisodeAssetFolders")
      .withIndex("by_owner_channel", (q) => q.eq("ownerId", args.ownerId).eq("channelId", folder.channelId))
      .collect();
    if (existing.some((candidate) => candidate._id !== folder._id
      && candidate.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("episode asset folder name already exists");
    }
    await ctx.db.patch(args.folderId, { name });
    return { folderId: args.folderId, name };
  },
});

export const remove = mutation({
  args: {
    ownerId: v.string(),
    folderId: v.id("studioEpisodeAssetFolders"),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio episode asset folder removal");
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== args.ownerId) throw new Error("episode asset folder unavailable");
    const assignments = await ctx.db.query("studioEpisodeAssetFolderAssignments")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();
    for (const assignment of assignments) {
      if (assignment.ownerId === args.ownerId) await ctx.db.delete(assignment._id);
    }
    await ctx.db.delete(args.folderId);
    return { removedAssignments: assignments.filter((assignment) => assignment.ownerId === args.ownerId).length };
  },
});

export const move = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    assetFingerprint: v.string(),
    folderId: v.optional(v.id("studioEpisodeAssetFolders")),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio episode asset move");
    await ownedChannel(ctx, args.ownerId, args.channelId);
    const asset = await ctx.db.query("studioReusableMediaAssets")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", args.assetFingerprint))
      .unique();
    if (!asset || asset.channelId !== args.channelId) {
      throw new Error("episode asset is not owned by this channel");
    }
    const current = await ctx.db.query("studioEpisodeAssetFolderAssignments")
      .withIndex("by_owner_asset", (q) => q.eq("ownerId", args.ownerId).eq("assetFingerprint", args.assetFingerprint))
      .unique();
    if (args.folderId === undefined) {
      if (current) await ctx.db.delete(current._id);
      return { folderId: null };
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== args.ownerId || folder.channelId !== args.channelId) {
      throw new Error("episode asset folder is not owned by this channel");
    }
    if (current) {
      if (current.folderId !== args.folderId) {
        await ctx.db.patch(current._id, { folderId: args.folderId, updatedAt: Date.now() });
      }
      return { folderId: args.folderId };
    }
    await ctx.db.insert("studioEpisodeAssetFolderAssignments", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      folderId: args.folderId,
      assetFingerprint: args.assetFingerprint,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { folderId: args.folderId };
  },
});
