import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";

const entry = v.object({ block: v.string(), version: v.optional(v.string()), params: v.optional(v.any()) });

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => ctx.db.query("workshopPipelineDrafts")
    .withIndex("by_owner_updated", q => q.eq("ownerId", ownerId)).order("desc").take(100),
});

export const save = mutation({
  args: {
    ownerId: v.string(), draftId: v.optional(v.id("workshopPipelineDrafts")),
    expectedRevision: v.optional(v.number()), name: v.string(), entries: v.array(entry),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name || name.length > 120) throw new Error("Draft name must be between 1 and 120 characters");
    if (args.entries.length > 100 || JSON.stringify(args.entries).length > 100_000)
      throw new Error("Draft exceeds the module or configuration size limit");
    for (const item of args.entries) {
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(item.block) ||
          (item.version !== undefined && (!item.version.trim() || item.version.length > 80)) ||
          (item.params !== undefined && (!item.params || typeof item.params !== "object" || Array.isArray(item.params))))
        throw new Error("Invalid module identifier, version or parameters");
    }
    const now = Date.now();
    if (!args.draftId) {
      if (args.expectedRevision !== undefined) throw new Error("A new draft cannot have an expected revision");
      return await ctx.db.insert("workshopPipelineDrafts", { ownerId: args.ownerId, name, entries: args.entries, revision: 1, createdAt: now, updatedAt: now });
    }
    const existing = await ctx.db.get(args.draftId);
    if (!existing || existing.ownerId !== args.ownerId) throw new Error("Draft not found");
    if (args.expectedRevision !== existing.revision) throw new Error("Draft changed elsewhere; reload before saving");
    await ctx.db.patch(args.draftId, { name, entries: args.entries, revision: existing.revision + 1, updatedAt: now });
    return args.draftId;
  },
});

export const remove = mutation({
  args: { ownerId: v.string(), draftId: v.id("workshopPipelineDrafts"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.draftId);
    if (!existing || existing.ownerId !== args.ownerId) throw new Error("Draft not found");
    if (args.expectedRevision !== existing.revision) throw new Error("Draft changed elsewhere; reload before deleting");
    await ctx.db.delete(args.draftId);
  },
});
