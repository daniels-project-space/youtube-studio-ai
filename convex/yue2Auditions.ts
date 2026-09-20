import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { YuE2AuditionSubmissionSchema } from "../src/engine/yue2Audition";
import { canonicalJson } from "../src/lib/canonicalJson";

const scope = { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), candidateSha256: v.string() };
async function owned(ctx: QueryCtx | MutationCtx, args: { ownerId: string; channelId: Id<"channels">; runId: Id<"runs">; candidateSha256: string }) {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE audition");
  if (!/^[a-f0-9]{64}$/.test(args.candidateSha256)) throw new Error("Invalid candidate digest");
  const run = await ctx.db.get(args.runId), channel = await ctx.db.get(args.channelId);
  if (!run || !channel || run.ownerId !== args.ownerId || channel.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("YuE audition ownership mismatch");
  }
}

export const latest = query({ args: scope, handler: async (ctx, args) => {
  await owned(ctx, args);
  const row = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", args.ownerId).eq("runId", args.runId).eq("candidateSha256", args.candidateSha256)).order("desc").first();
  return row ? { ...YuE2AuditionSubmissionSchema.parse(row.submission), reviewedAt: row.reviewedAt, reviewerId: row.ownerId, productionApproved: false as const } : null;
} });

// Only the authenticated server route may write, after fresh native-byte verification.
// No run status, resume outbox, approval or generation authority is changed here.
export const record = mutation({ args: { ...scope, submission: v.any() }, handler: async (ctx, args) => {
  await owned(ctx, args);
  const submission = YuE2AuditionSubmissionSchema.parse(args.submission);
  if (submission.candidateSha256 !== args.candidateSha256) throw new Error("YuE audition candidate mismatch");
  const previous = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", args.ownerId).eq("runId", args.runId).eq("candidateSha256", args.candidateSha256)).order("desc").first();
  const reviewedAt = previous && canonicalJson(previous.submission) === canonicalJson(submission) ? previous.reviewedAt : Date.now();
  if (!previous || canonicalJson(previous.submission) !== canonicalJson(submission)) {
    await ctx.db.insert("yue2Auditions", { ownerId: args.ownerId, channelId: args.channelId, runId: args.runId,
      candidateSha256: args.candidateSha256, submission, reviewedAt, revision: (previous?.revision ?? 0) + 1 });
  }
  return { ...submission, reviewedAt, reviewerId: args.ownerId, productionApproved: false as const };
} });
