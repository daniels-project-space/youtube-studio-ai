import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";

const entry = v.object({ block: v.string(), version: v.optional(v.string()), params: v.optional(v.any()) });

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => ctx.db.query("workshopPipelineDrafts")
    .withIndex("by_owner_updated", q => q.eq("ownerId", ownerId)).order("desc").take(100),
});

export const listSnapshots = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => ctx.db.query("workshopPipelineSnapshots")
    .withIndex("by_owner_created", q => q.eq("ownerId", ownerId)).order("desc").take(100),
});

/** An immutable design snapshot, not a tested or deployable release. */
export const snapshot = mutation({
  args: { ownerId: v.string(), draftId: v.id("workshopPipelineDrafts"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.ownerId !== args.ownerId) throw new Error("Draft not found");
    if (draft.revision !== args.expectedRevision) throw new Error("Draft changed elsewhere; reload before creating a snapshot");
    if (!draft.family || !draft.entries.length) throw new Error("A snapshot needs a video format and at least one module");
    const existing = await ctx.db.query("workshopPipelineSnapshots")
      .withIndex("by_owner_draft_revision", q => q.eq("ownerId", args.ownerId).eq("draftId", args.draftId).eq("draftRevision", draft.revision)).unique();
    if (existing) return { snapshotId: existing._id, reused: true };
    const content = { version: "workshop-design-snapshot/v1", name: draft.name, family: draft.family, entries: draft.entries };
    const snapshotId = await ctx.db.insert("workshopPipelineSnapshots", {
      ownerId: args.ownerId, draftId: args.draftId, draftRevision: draft.revision,
      name: draft.name, family: draft.family, entries: draft.entries,
      fingerprint: sha256Hex(canonicalJson(content)), createdAt: Date.now(),
    });
    return { snapshotId, reused: false };
  },
});

export const removeSnapshot = mutation({
  args: { ownerId: v.string(), snapshotId: v.id("workshopPipelineSnapshots"), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.snapshotId);
    if (!existing || existing.ownerId !== args.ownerId) throw new Error("Snapshot not found");
    if (existing.fingerprint !== args.fingerprint) throw new Error("Snapshot identity changed; reload before deleting");
    await ctx.db.delete(args.snapshotId);
  },
});

export const save = mutation({
  args: {
    ownerId: v.string(), draftId: v.optional(v.id("workshopPipelineDrafts")),
    expectedRevision: v.optional(v.number()), name: v.string(), family: v.optional(v.string()), entries: v.array(entry),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name || name.length > 120) throw new Error("Draft name must be between 1 and 120 characters");
    if (args.family !== undefined && !/^[a-z][a-z0-9_]{0,79}$/.test(args.family)) throw new Error("Invalid video format");
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
      return await ctx.db.insert("workshopPipelineDrafts", { ownerId: args.ownerId, name, family: args.family, entries: args.entries, revision: 1, createdAt: now, updatedAt: now });
    }
    const existing = await ctx.db.get(args.draftId);
    if (!existing || existing.ownerId !== args.ownerId) throw new Error("Draft not found");
    if (args.expectedRevision !== existing.revision) throw new Error("Draft changed elsewhere; reload before saving");
    await ctx.db.patch(args.draftId, { name, family: args.family, entries: args.entries, revision: existing.revision + 1, updatedAt: now });
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
