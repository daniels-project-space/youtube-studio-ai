import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { patchChannelRespectingLock } from "./channelLock";
import { stableJson } from "../src/lib/publishingPolicy";

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("learningGovernance: invalid internal secret");
  }
}

export const propose = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    recommendationKey: v.string(),
    kind: v.union(v.literal("show_bible"), v.literal("retention_rule")),
    target: v.union(v.literal("creative_brief"), v.literal("script_playbook")),
    sourceVideoIds: v.array(v.string()),
    dataWindowStart: v.string(),
    dataWindowEnd: v.string(),
    proposal: v.any(),
    offlineEvaluation: v.object({
      method: v.string(),
      sampleSize: v.number(),
      baselineScore: v.optional(v.number()),
      candidateScore: v.optional(v.number()),
      passed: v.boolean(),
      notes: v.string(),
    }),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const [channel, connector] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.connectorId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("learningGovernance.propose: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId ||
      (connector.tokenVersion ?? 1) !== args.connectorVersion ||
      (connector.status ?? "active") !== "active"
    ) {
      throw new Error("learningGovernance.propose: connector provenance mismatch");
    }
    const existing = await ctx.db
      .query("learningRecommendations")
      .withIndex("by_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("recommendationKey", args.recommendationKey),
      )
      .unique();
    if (existing) {
      if (
        stableJson(existing.proposal) !== stableJson(args.proposal) ||
        existing.connectorId !== args.connectorId ||
        existing.connectorVersion !== args.connectorVersion
      ) {
        throw new Error("learningGovernance.propose: immutable recommendation conflict");
      }
      return existing;
    }
    const basePolicyVersion = channel.learningPolicyVersion ?? 0;
    const { secret: _secret, ...doc } = args;
    const id = await ctx.db.insert("learningRecommendations", {
      ...doc,
      basePolicyVersion,
      proposedPolicyVersion: basePolicyVersion + 1,
      status: "proposed",
      updatedAt: args.createdAt,
    });
    return await ctx.db.get(id);
  },
});

export const listForOwner = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("approved"),
        v.literal("activated"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (args.status) {
      return await ctx.db
        .query("learningRecommendations")
        .withIndex("by_owner_status", (q) =>
          q.eq("ownerId", args.ownerId).eq("status", args.status!),
        )
        .order("desc")
        .take(200);
    }
    return await ctx.db
      .query("learningRecommendations")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(200);
  },
});

export const getExperimentByVideo = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    youtubeVideoId: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const rows = await ctx.db
      .query("contentExperiments")
      .withIndex("by_video", (q) => q.eq("youtubeVideoId", args.youtubeVideoId))
      .collect();
    const row = rows.find((candidate) => candidate.ownerId === args.ownerId);
    return row ?? null;
  },
});

export const getByKey = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    recommendationKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    return await ctx.db
      .query("learningRecommendations")
      .withIndex("by_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("recommendationKey", args.recommendationKey),
      )
      .unique();
  },
});

export const approveAndActivate = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    recommendationId: v.id("learningRecommendations"),
    approvedBy: v.string(),
    approvedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const recommendation = await ctx.db.get(args.recommendationId);
    if (!recommendation || recommendation.ownerId !== args.ownerId) {
      throw new Error("learningGovernance.activate: owner mismatch");
    }
    if (!args.approvedBy.trim()) {
      throw new Error("learningGovernance.activate: approving actor is required");
    }
    if (recommendation.status === "activated") return recommendation;
    if (recommendation.status !== "proposed") {
      throw new Error(`learningGovernance.activate: status is ${recommendation.status}`);
    }
    if (!recommendation.offlineEvaluation.passed) {
      throw new Error("learningGovernance.activate: offline evaluation did not pass");
    }
    const [channel, connector] = await Promise.all([
      ctx.db.get(recommendation.channelId),
      ctx.db.get(recommendation.connectorId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("learningGovernance.activate: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== recommendation.channelId ||
      (connector.tokenVersion ?? 1) !== recommendation.connectorVersion ||
      (connector.status ?? "active") !== "active"
    ) {
      throw new Error("learningGovernance.activate: source connector is no longer valid");
    }
    if ((channel.learningPolicyVersion ?? 0) !== recommendation.basePolicyVersion) {
      throw new Error("learningGovernance.activate: channel policy changed; regenerate proposal");
    }
    const proposal = recommendation.proposal as { nextValue?: unknown };
    if (!proposal || proposal.nextValue === undefined) {
      throw new Error("learningGovernance.activate: proposal has no nextValue");
    }
    // LOCK GUARD: an approved learning recommendation is a config change like
    // any other, so a locked ("done") channel keeps its shipped brief/playbook
    // and the activation lands on its v2 fork instead. This path is bounded —
    // the recommendation flips to "activated" below and cannot re-run.
    let channelWrite;
    if (recommendation.target === "creative_brief") {
      if (!channel.identity || typeof proposal.nextValue !== "object") {
        throw new Error("learningGovernance.activate: invalid creative brief proposal");
      }
      channelWrite = await patchChannelRespectingLock(ctx, channel._id, {
        identity: { ...channel.identity, creativeBrief: proposal.nextValue as never },
        learningPolicyVersion: recommendation.proposedPolicyVersion,
      });
    } else {
      if (typeof proposal.nextValue !== "object" || proposal.nextValue === null) {
        throw new Error("learningGovernance.activate: invalid script playbook proposal");
      }
      channelWrite = await patchChannelRespectingLock(ctx, channel._id, {
        scriptPlaybook: proposal.nextValue,
        learningPolicyVersion: recommendation.proposedPolicyVersion,
      });
    }
    await ctx.db.patch(recommendation._id, {
      status: "activated",
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      activatedAt: args.approvedAt,
      updatedAt: args.approvedAt,
    });
    const activated = await ctx.db.get(recommendation._id);
    // Additive fork signal so a caller can tell the change was redirected.
    return activated ? { ...activated, channelWrite } : activated;
  },
});

export const reject = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    recommendationId: v.id("learningRecommendations"),
    rejectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const row = await ctx.db.get(args.recommendationId);
    if (!row || row.ownerId !== args.ownerId) {
      throw new Error("learningGovernance.reject: owner mismatch");
    }
    if (row.status === "activated") {
      throw new Error("learningGovernance.reject: activated policy cannot be rejected");
    }
    await ctx.db.patch(row._id, { status: "rejected", updatedAt: args.rejectedAt });
    return await ctx.db.get(row._id);
  },
});

export const recordExperimentOutcome = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    experimentId: v.id("contentExperiments"),
    ingestionId: v.id("analyticsIngestions"),
    youtubeVideoId: v.string(),
    outcome: v.any(),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const [experiment, ingestion] = await Promise.all([
      ctx.db.get(args.experimentId),
      ctx.db.get(args.ingestionId),
    ]);
    if (!experiment || experiment.ownerId !== args.ownerId) {
      throw new Error("learningGovernance.recordOutcome: experiment owner mismatch");
    }
    if (
      !ingestion ||
      ingestion.ownerId !== args.ownerId ||
      ingestion.connectorId !== experiment.connectorId ||
      ingestion.connectorVersion !== experiment.connectorVersion ||
      ingestion.channelId !== experiment.channelId
    ) {
      throw new Error("learningGovernance.recordOutcome: ingestion provenance mismatch");
    }
    if (
      experiment.youtubeVideoId &&
      experiment.youtubeVideoId !== args.youtubeVideoId
    ) {
      throw new Error("learningGovernance.recordOutcome: video identity mismatch");
    }
    await ctx.db.patch(experiment._id, {
      youtubeVideoId: args.youtubeVideoId,
      outcome: args.outcome,
      outcomeIngestionId: args.ingestionId,
      status: "observed",
      observedAt: args.observedAt,
    });
    return await ctx.db.get(experiment._id);
  },
});
