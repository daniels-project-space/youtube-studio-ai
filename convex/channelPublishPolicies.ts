import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

const publishAction = v.union(
  v.literal("youtube_public"),
  v.literal("youtube_scheduled"),
  v.literal("youtube_short_public"),
  v.literal("crosspost"),
);

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("channel publish policy access denied");
  }
}

export const replace = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    allowedActions: v.array(publishAction),
    pipelineFingerprint: v.string(),
    actor: v.string(),
    evidence: v.string(),
    changedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!args.actor.trim() || !args.evidence.trim()) {
      throw new Error("channel publish policy requires actor and evidence");
    }
    if (!/^[a-f0-9]{64}$/.test(args.pipelineFingerprint)) {
      throw new Error("invalid channel publish configuration fingerprint");
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("channel publish policy owner mismatch");
    }
    const allowedActions = [...new Set(args.allowedActions)];
    const existing = await ctx.db
      .query("channelPublishPolicies")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (existing && existing.ownerId !== args.ownerId) {
      throw new Error("channel publish policy tenant mismatch");
    }
    const active = allowedActions.length > 0;
    const patch = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      allowedActions,
      pipelineFingerprint: args.pipelineFingerprint,
      status: active ? ("active" as const) : ("revoked" as const),
      version: (existing?.version ?? 0) + 1,
      approvedBy: active ? args.actor : existing?.approvedBy,
      approvalEvidence: active ? args.evidence : existing?.approvalEvidence,
      approvedAt: active ? args.changedAt : existing?.approvedAt,
      revokedBy: active ? undefined : args.actor,
      revocationEvidence: active ? undefined : args.evidence,
      revokedAt: active ? undefined : args.changedAt,
      updatedAt: args.changedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("channelPublishPolicies", patch);
    return await ctx.db.get(id);
  },
});

export const getForOwner = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const row = await ctx.db
      .query("channelPublishPolicies")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    return row?.ownerId === args.ownerId ? row : null;
  },
});

export const authorize = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    action: publishAction,
    pipelineFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return { authorized: false as const, reason: "channel_missing" as const };
    if (channel.ownerId !== args.ownerId) {
      return { authorized: false as const, reason: "tenant_mismatch" as const };
    }
    // The channel's own operator toggle (draft|active|paused|archived, schema.ts
    // `channels.status`) is a SEPARATE control from this row's approval status.
    // Without this check, pausing/archiving a channel only stops the autopilot
    // scheduler from admitting NEW runs (src/trigger/scheduler.ts) — it does not
    // retroactively stop an already-admitted/in-flight/manually-triggered run
    // from shipping through upload_draft or crosspost. This is the actual final
    // gate, so it must enforce the toggle directly.
    if (channel.status !== "active") {
      return { authorized: false as const, reason: "channel_not_active" as const };
    }
    const row = await ctx.db
      .query("channelPublishPolicies")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (!row || row.ownerId !== args.ownerId) {
      return { authorized: false as const, reason: "policy_missing" as const };
    }
    if (row.status !== "active") {
      return { authorized: false as const, reason: "policy_revoked" as const };
    }
    if (!row.allowedActions.includes(args.action)) {
      return { authorized: false as const, reason: "action_not_approved" as const };
    }
    if (row.pipelineFingerprint !== args.pipelineFingerprint) {
      return { authorized: false as const, reason: "configuration_changed" as const };
    }
    return {
      authorized: true as const,
      reason: "authorized" as const,
      policyVersion: row.version,
      approvedBy: row.approvedBy,
      approvalEvidence: row.approvalEvidence,
      pipelineFingerprint: row.pipelineFingerprint,
    };
  },
});
