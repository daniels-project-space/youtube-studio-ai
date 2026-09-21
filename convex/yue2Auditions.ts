import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { YuE2AuditionSubmissionSchema } from "../src/engine/yue2Audition";
import { canonicalJson } from "../src/lib/canonicalJson";
import { createYuE2SourceApproval, YuE2SourceApprovalBasisSchema, YuE2SourceApprovalSchema } from "../src/engine/yue2SourceApproval";

const scope = { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), candidateSha256: v.string() };
async function owned(ctx: QueryCtx | MutationCtx, args: { ownerId: string; channelId: Id<"channels">; runId: Id<"runs">; candidateSha256: string }) {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE audition");
  if (!/^[a-f0-9]{64}$/.test(args.candidateSha256)) throw new Error("Invalid candidate digest");
  const run = await ctx.db.get(args.runId), channel = await ctx.db.get(args.channelId);
  if (!run || !channel || run.ownerId !== args.ownerId || channel.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("YuE audition ownership mismatch");
  }
  return run;
}

function verifiedApproval(row: Doc<"yue2Auditions"> | null, invocationSha256: string | undefined) {
  if (!row?.sourceApproval || row.submission?.verdict !== "approved_for_assembly") return null;
  const approval = YuE2SourceApprovalSchema.parse(row.sourceApproval);
  const expected = createYuE2SourceApproval({ basis: approval.basis, submission: row.submission,
    reviewedAt: row.reviewedAt, revision: row.revision });
  if (approval.fingerprint !== expected.fingerprint || approval.basis.ownerId !== row.ownerId ||
    approval.basis.channelId !== row.channelId || approval.basis.runId !== row.runId ||
    approval.basis.candidateSha256 !== row.candidateSha256) throw new Error("Source approval audit identity mismatch");
  return approval.basis.invocationSha256 === invocationSha256 ? approval : null;
}

export const latest = query({ args: scope, handler: async (ctx, args) => {
  const run = await owned(ctx, args);
  const row = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", args.ownerId).eq("runId", args.runId).eq("candidateSha256", args.candidateSha256)).order("desc").first();
  const approval = verifiedApproval(row, run.pipelineInvocationSha256);
  return row ? { ...YuE2AuditionSubmissionSchema.parse(row.submission), reviewedAt: row.reviewedAt, reviewerId: row.ownerId,
    productionApproved: false as const,
    sourceApprovalFingerprint: approval?.fingerprint ?? null } : null;
} });

// Only the authenticated server route may write, after fresh native-byte verification.
// Source approval is separate from run continuation, generation and publishing authority.
export const record = mutation({ args: { ...scope, submission: v.any(), sourceBasis: v.optional(v.any()) }, handler: async (ctx, args) => {
  const run = await owned(ctx, args);
  const submission = YuE2AuditionSubmissionSchema.parse(args.submission);
  if (submission.candidateSha256 !== args.candidateSha256) throw new Error("YuE audition candidate mismatch");
  const basis = submission.verdict === "approved_for_assembly" ? YuE2SourceApprovalBasisSchema.parse(args.sourceBasis) : null;
  if ((!basis && args.sourceBasis !== undefined) || (basis && (basis.ownerId !== args.ownerId || basis.channelId !== args.channelId ||
    basis.runId !== args.runId || basis.candidateSha256 !== args.candidateSha256 || basis.invocationSha256 !== run.pipelineInvocationSha256))) {
    throw new Error("Source approval scope or frozen invocation mismatch");
  }
  const previous = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", args.ownerId).eq("runId", args.runId).eq("candidateSha256", args.candidateSha256)).order("desc").first();
  const unchanged = previous && canonicalJson(previous.submission) === canonicalJson(submission) &&
    canonicalJson(previous.sourceApproval?.basis ?? null) === canonicalJson(basis);
  const reviewedAt = unchanged ? previous.reviewedAt : Date.now();
  const revision = unchanged ? previous.revision : (previous?.revision ?? 0) + 1;
  const sourceApproval = basis ? createYuE2SourceApproval({ basis, submission, reviewedAt, revision }) : null;
  if (!unchanged) {
    await ctx.db.insert("yue2Auditions", { ownerId: args.ownerId, channelId: args.channelId, runId: args.runId,
      candidateSha256: args.candidateSha256, submission, reviewedAt, revision, ...(sourceApproval ? { sourceApproval } : {}) });
  }
  return { ...submission, reviewedAt, reviewerId: args.ownerId, productionApproved: false as const,
    sourceApprovalFingerprint: sourceApproval?.fingerprint ?? null };
} });

/** Current owner decision only: a later rejection/needs-work record revokes adoption. */
export const getSourceApproval = query({ args: { ...scope, invocationSha256: v.string() }, handler: async (ctx, args) => {
  const run = await owned(ctx, args);
  if (run.pipelineInvocationSha256 !== args.invocationSha256) throw new Error("Source approval invocation changed");
  const row = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", args.ownerId).eq("runId", args.runId).eq("candidateSha256", args.candidateSha256)).order("desc").first();
  if (row && row.channelId !== args.channelId) throw new Error("Source approval channel mismatch");
  return verifiedApproval(row, args.invocationSha256);
} });
