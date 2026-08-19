import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

const uploadStatus = v.union(
  v.literal("initiated"),
  v.literal("uploading"),
  v.literal("completed"),
  v.literal("expired"),
  v.literal("failed"),
);

function assertInternalSecret(secret: string, operation: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error(`${operation}: invalid internal secret`);
  }
}

export const get = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    uploadKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "youtubeUploads.get");
    const row = await ctx.db
      .query("youtubeUploadSessions")
      .withIndex("by_owner_upload_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("uploadKey", args.uploadKey),
      )
      .unique();
    if (row && row.channelId !== args.channelId) {
      throw new Error("youtubeUploads.get: channel mismatch");
    }
    return row;
  },
});

export const save = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    uploadKey: v.string(),
    sessionUrlCiphertext: v.string(),
    fileSize: v.number(),
    fileSha256: v.string(),
    metadataSha256: v.string(),
    uploadedBytes: v.number(),
    chunkSize: v.number(),
    status: uploadStatus,
    videoId: v.optional(v.string()),
    privacyStatus: v.optional(v.string()),
    publishAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "youtubeUploads.save");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("youtubeUploads.save: channel owner mismatch");
    }
    if (!Number.isSafeInteger(args.fileSize) || args.fileSize < 1) {
      throw new Error("youtubeUploads.save: invalid file size");
    }
    if (!Number.isSafeInteger(args.uploadedBytes)
        || args.uploadedBytes < 0
        || args.uploadedBytes > args.fileSize) {
      throw new Error("youtubeUploads.save: invalid uploaded byte count");
    }
    if (!Number.isSafeInteger(args.chunkSize) || args.chunkSize < 256 * 1024) {
      throw new Error("youtubeUploads.save: invalid chunk size");
    }
    const existing = await ctx.db
      .query("youtubeUploadSessions")
      .withIndex("by_owner_upload_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("uploadKey", args.uploadKey),
      )
      .unique();
    const { secret: _secret, ...row } = args;
    void _secret;
    if (existing) {
      if (existing.channelId !== args.channelId) {
        throw new Error("youtubeUploads.save: channel mismatch");
      }
      if (existing.status === "completed" && args.status !== "completed") {
        throw new Error("youtubeUploads.save: completed upload cannot regress");
      }
      const sameFile = existing.fileSize === args.fileSize
        && existing.fileSha256 === args.fileSha256
        && existing.metadataSha256 === args.metadataSha256;
      const replacingExpiredSession = args.status === "initiated"
        && args.createdAt > existing.createdAt;
      if (sameFile && args.uploadedBytes < existing.uploadedBytes && !replacingExpiredSession) {
        throw new Error("youtubeUploads.save: uploaded byte count cannot regress");
      }
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("youtubeUploadSessions", row);
    }
    return null;
  },
});
