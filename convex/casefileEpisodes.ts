import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import {
  admitCasefileEpisodeEvidenceMap,
  admitCasefileEpisodeSource,
  attachCasefileEpisodePlanning,
  draftCasefileEpisodeCinematicSequence,
  finalizeCasefileEpisodeCinematicSequence,
  type CasefileEpisodeWorkflow,
} from "../src/engine/casefileEpisodeWorkflow";
import { mutation, query } from "./studioFunctions";

const statusValidator = v.union(
  v.literal("source_admitted"),
  v.literal("awaiting_evidence_review"),
  v.literal("awaiting_cinematic_direction"),
  v.literal("awaiting_cinematic_review"),
  v.literal("render_admitted"),
);

function workflow(document: { workflow: unknown }): CasefileEpisodeWorkflow {
  return document.workflow as CasefileEpisodeWorkflow;
}

async function ownedEpisode(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  episodeId: Id<"casefileEpisodes">,
  ownerId: string,
) {
  const episode = await ctx.db.get(episodeId);
  if (!episode || episode.ownerId !== ownerId) throw new Error("casefile episode not found");
  return episode;
}

/** Creates one immutable source-admitted episode revision per case/owner. */
export const admitSource = mutation({
  args: { ownerId: v.string(), sourcePacket: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const admitted = admitCasefileEpisodeSource(args.sourcePacket, {
      ...(args.now === undefined ? {} : { now: new Date(args.now) }),
    });
    const existing = await ctx.db
      .query("casefileEpisodes")
      .withIndex("by_owner_case", (q) => q.eq("ownerId", args.ownerId).eq("caseId", admitted.caseId))
      .unique();
    if (existing) {
      const prior = workflow(existing);
      if (prior.sourceAdmission.sourcePacketFingerprint !== admitted.sourceAdmission.sourcePacketFingerprint) {
        throw new Error("casefile episode source revision already exists for this caseId; use a new caseId for changed evidence");
      }
      return existing;
    }
    const now = args.now ?? Date.now();
    const id = await ctx.db.insert("casefileEpisodes", {
      ownerId: args.ownerId,
      caseId: admitted.caseId,
      status: admitted.status,
      workflow: admitted,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const attachPlanning = mutation({
  args: { ownerId: v.string(), episodeId: v.id("casefileEpisodes"), sceneManifest: v.any(), shotList: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const episode = await ownedEpisode(ctx, args.episodeId, args.ownerId);
    const next = attachCasefileEpisodePlanning({ episode: workflow(episode), sceneManifest: args.sceneManifest, shotList: args.shotList });
    await ctx.db.patch(episode._id, { status: next.status, workflow: next, updatedAt: args.now ?? Date.now() });
    return await ctx.db.get(episode._id);
  },
});

export const admitEvidenceMap = mutation({
  args: { ownerId: v.string(), episodeId: v.id("casefileEpisodes"), evidenceShotMapInput: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const episode = await ownedEpisode(ctx, args.episodeId, args.ownerId);
    const next = admitCasefileEpisodeEvidenceMap({
      episode: workflow(episode), evidenceShotMapInput: args.evidenceShotMapInput,
      ...(args.now === undefined ? {} : { now: new Date(args.now) }),
    });
    await ctx.db.patch(episode._id, { status: next.status, workflow: next, updatedAt: args.now ?? Date.now() });
    return await ctx.db.get(episode._id);
  },
});

export const draftCinematicSequence = mutation({
  args: { ownerId: v.string(), episodeId: v.id("casefileEpisodes"), direction: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const episode = await ownedEpisode(ctx, args.episodeId, args.ownerId);
    const next = draftCasefileEpisodeCinematicSequence({ episode: workflow(episode), direction: args.direction });
    await ctx.db.patch(episode._id, { status: next.status, workflow: next, updatedAt: args.now ?? Date.now() });
    return await ctx.db.get(episode._id);
  },
});

export const finalizeCinematicSequence = mutation({
  args: { ownerId: v.string(), episodeId: v.id("casefileEpisodes"), editorialReview: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const episode = await ownedEpisode(ctx, args.episodeId, args.ownerId);
    const next = finalizeCasefileEpisodeCinematicSequence({
      episode: workflow(episode), editorialReview: args.editorialReview,
      ...(args.now === undefined ? {} : { now: new Date(args.now) }),
    });
    await ctx.db.patch(episode._id, { status: next.status, workflow: next, updatedAt: args.now ?? Date.now() });
    return await ctx.db.get(episode._id);
  },
});

export const get = query({
  args: { ownerId: v.string(), episodeId: v.id("casefileEpisodes") },
  handler: async (ctx, args) => await ownedEpisode(ctx, args.episodeId, args.ownerId),
});

export const listForOwner = query({
  args: { ownerId: v.string(), status: v.optional(statusValidator) },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("casefileEpisodes")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", args.ownerId).eq("status", args.status!))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("casefileEpisodes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(100);
  },
});
