import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, requireStudioServiceIdentity } from "./studioFunctions";
import { writeChannelDirectory } from "./channelDirectoryProjection";
import { canonicalJson } from "../src/lib/canonicalJson";

/** One atomic, service-only import into an empty local Automation database. */
export const importBaseline = mutation({
  args: { ownerId: v.string(), sourceFileSha256: v.string(), channels: v.array(v.any()) },
  returns: v.object({ imported: v.number(), reused: v.boolean(), mappings: v.array(v.object({ sourceId: v.string(), channelId: v.id("channels") })) }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "channel baseline import");
    if (process.env.YOUTUBE_LOCAL_IMPORT_ENABLED !== "1") throw new Error("Local channel import is disabled");
    if (!/^[a-f0-9]{64}$/.test(args.sourceFileSha256) || args.channels.length < 1 || args.channels.length > 30 ||
        new TextEncoder().encode(JSON.stringify(args.channels)).length > 750_000) throw new Error("Invalid or oversized channel baseline");
    const prior = await ctx.db.query("channelImportReceipts").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).unique();
    if (prior) {
      if (prior.sourceFileSha256 !== args.sourceFileSha256 || canonicalJson(prior.sourceChannels) !== canonicalJson(args.channels)) {
        throw new Error("A different channel baseline was already imported; explicit migration is required");
      }
      return { imported: prior.mappings.length, reused: true, mappings: prior.mappings };
    }
    const existing = await ctx.db.query("channels").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).take(1);
    if (existing.length) throw new Error("Channel import requires an empty destination for this owner");
    const ids = new Set<string>(), slugs = new Set<string>();
    for (const channel of args.channels) {
      if (!channel || typeof channel !== "object" || Array.isArray(channel) || channel.ownerId !== args.ownerId ||
          typeof channel._id !== "string" || !channel._id || typeof channel.slug !== "string" || !channel.slug ||
          !Array.isArray(channel.pipeline) || ids.has(channel._id) || slugs.has(channel.slug)) throw new Error("Invalid or duplicate baseline channel");
      ids.add(channel._id); slugs.add(channel.slug);
    }
    for (const channel of args.channels) {
      if (channel.groupId !== undefined && (typeof channel.groupId !== "string" || !ids.has(channel.groupId))) {
        throw new Error("Channel group references an uncaptured source channel");
      }
    }
    const mappings: { sourceId: string; channelId: Id<"channels"> }[] = [];
    for (const source of args.channels) {
      const fields = { ...source };
      delete fields._id; delete fields._creationTime; delete fields.groupId;
      const schedule = fields.schedule === undefined ? undefined : { ...fields.schedule, enabled: false };
      const channelId = await ctx.db.insert("channels", { ...fields, status: "paused", ...(schedule === undefined ? {} : { schedule }) } as Omit<Doc<"channels">, "_id" | "_creationTime">);
      mappings.push({ sourceId: source._id, channelId });
    }
    const translated = new Map(mappings.map(entry => [entry.sourceId, entry.channelId]));
    for (let i = 0; i < args.channels.length; i++) {
      const source = args.channels[i], channelId = mappings[i]!.channelId;
      if (source.groupId !== undefined) await ctx.db.patch(channelId, { groupId: translated.get(source.groupId)! });
      const channel = await ctx.db.get(channelId);
      if (!channel) throw new Error("Imported channel disappeared");
      await writeChannelDirectory(ctx, channel);
    }
    await ctx.db.insert("channelImportReceipts", { ownerId: args.ownerId, sourceFileSha256: args.sourceFileSha256, sourceChannels: args.channels, mappings, importedAt: Date.now() });
    return { imported: mappings.length, reused: false, mappings };
  },
});
