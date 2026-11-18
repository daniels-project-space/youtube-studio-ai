import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";
import { parseWorkshopDesignTransport } from "../src/lib/workshopDesignTransport";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { durationCandidateFamily } from "../src/lib/durationCandidateFamily";

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== args.ownerId || identity.owner_id !== args.ownerId) {
      throw new Error("Owner verification required");
    }
    return ctx.db.query("importedWorkshopDesigns")
      .withIndex("by_owner_imported", q => q.eq("ownerId", args.ownerId)).order("desc").take(100);
  },
});

export const channelOptions = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== args.ownerId || identity.owner_id !== args.ownerId) throw new Error("Owner verification required");
    const rows = await ctx.db.query("channels").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).take(101);
    return { channels: rows.slice(0, 100).map(row => ({ id: row._id, name: row.name, slug: row.slug })), truncated: rows.length > 100 };
  },
});

export const channelBySlug = query({
  args: { ownerId: v.string(), slug: v.string() },
  handler: async (ctx, { ownerId, slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== ownerId || identity.owner_id !== ownerId) throw new Error("Owner verification required");
    if (!slug || slug.length > 200 || slug.trim() !== slug) throw new Error("Invalid channel slug");
    const rows = await ctx.db.query("channels").withIndex("by_owner_slug", q => q.eq("ownerId", ownerId).eq("slug", slug)).take(2);
    if (rows.length !== 1) return { channel: null, ambiguous: rows.length > 1 };
    const row = rows[0]!;
    return { channel: { id: row._id, name: row.name, slug: row.slug }, ambiguous: false };
  },
});

/** Import is deliberately data-only; it does not approve or modify channels. */
export const importDesign = mutation({
  args: { ownerId: v.string(), design: v.any() },
  handler: async (ctx, args) => {
    const design = parseWorkshopDesignTransport(args.design);
    const existing = await ctx.db.query("importedWorkshopDesigns")
      .withIndex("by_owner_fingerprint", q => q.eq("ownerId", args.ownerId).eq("fingerprint", design.fingerprint)).unique();
    if (existing) return { id: existing._id, reused: true };
    const id = await ctx.db.insert("importedWorkshopDesigns", { ownerId: args.ownerId, fingerprint: design.fingerprint, design, importedAt: Date.now() });
    return { id, reused: false };
  },
});

/** Freeze an unqualified review without modifying the channel or granting authority. */
export const createReviewCandidate = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), designId: v.id("importedWorkshopDesigns"), expectedBaselineFingerprint: v.string(), expectedDesignFingerprint: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== args.ownerId || identity.owner_id !== args.ownerId) throw new Error("Owner verification required");
    const channel = await ctx.db.get(args.channelId);
    const imported = await ctx.db.get(args.designId);
    if (!channel || channel.ownerId !== args.ownerId || !imported || imported.ownerId !== args.ownerId) throw new Error("Channel or imported design not found");
    durationCandidateFamily(channel);
    const design = parseWorkshopDesignTransport(imported.design);
    if (design.fingerprint !== imported.fingerprint || design.fingerprint !== args.expectedDesignFingerprint) throw new Error("Imported design changed; reload and retry");
    const baselineFingerprint = channelPipelineWriteFence(channel);
    if (baselineFingerprint !== args.expectedBaselineFingerprint) throw new Error("Channel settings changed; refresh the baseline before saving a review");
    const baseline = {
      pipeline: channel.pipeline ?? [], moduleConfig: channel.moduleConfig ?? {}, disabledBlocks: channel.disabledBlocks ?? [],
      identity: channel.identity ?? null, family: channel.family ?? null, contentLane: channel.contentLane ?? null,
      styleDNA: channel.styleDNA ?? null, modelRouting: channel.modelRouting ?? null, moduleLocks: channel.moduleLocks ?? {},
      locked: channel.locked ?? false, budget: channel.budget ?? null, template: channel.template ?? null, language: channel.language ?? null,
      qaRubric: channel.qaRubric ?? null, scriptPlaybook: channel.scriptPlaybook ?? null, thumbnailPlaybook: channel.thumbnailPlaybook ?? null, thumbnailer: channel.thumbnailer ?? null,
    };
    const candidate = { version: "workshop-review-candidate/v1", status: "unqualified", ownerId: args.ownerId, channelId: String(args.channelId), design, baseline, baselineFingerprint };
    const encoded = canonicalJson(candidate);
    if (new TextEncoder().encode(encoded).byteLength > 200_000) throw new Error("Review exceeds its size limit");
    const fingerprint = sha256Hex(encoded);
    const existing = await ctx.db.query("workshopReviewCandidates").withIndex("by_owner_channel_fingerprint", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId).eq("fingerprint", fingerprint)).unique();
    if (existing) {
      if (canonicalJson(existing.candidate) !== encoded) throw new Error("Review candidate conflict");
      return { id: existing._id, fingerprint, reused: true };
    }
    const id = await ctx.db.insert("workshopReviewCandidates", { ownerId: args.ownerId, channelId: args.channelId, designFingerprint: design.fingerprint, baselineFingerprint, fingerprint, candidate, createdAt: Date.now() });
    return { id, fingerprint, reused: false };
  },
});

export const listReviewCandidates = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), designFingerprint: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== args.ownerId || identity.owner_id !== args.ownerId) throw new Error("Owner verification required");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) throw new Error("Channel not found");
    const rows = await ctx.db.query("workshopReviewCandidates").withIndex("by_owner_channel_design_created", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId).eq("designFingerprint", args.designFingerprint)).order("desc").take(10);
    for (const row of rows) {
      const candidate = row.candidate;
      if (!candidate || candidate.version !== "workshop-review-candidate/v1" || candidate.status !== "unqualified" || candidate.ownerId !== args.ownerId || candidate.channelId !== String(args.channelId) || candidate.baselineFingerprint !== row.baselineFingerprint || channelPipelineWriteFence(candidate.baseline) !== row.baselineFingerprint || parseWorkshopDesignTransport(candidate.design).fingerprint !== row.designFingerprint || sha256Hex(canonicalJson(candidate)) !== row.fingerprint) throw new Error("Saved review integrity check failed");
    }
    return rows;
  },
});

export const remove = mutation({
  args: { ownerId: v.string(), designId: v.id("importedWorkshopDesigns"), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.designId);
    if (!record || record.ownerId !== args.ownerId) throw new Error("Imported design not found");
    if (record.fingerprint !== args.fingerprint) throw new Error("Imported design changed; reload before deleting");
    await ctx.db.delete(args.designId);
  },
});
