import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { verifiedDurationCandidate } from "../src/lib/durationCandidateEvidenceReview";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "../src/lib/channelModuleLock";
import { durationCandidateProposal } from "../src/lib/durationCandidateProposal";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";

const scope = { ownerId: v.string(), channelId: v.id("channels"), candidateId: v.id("durationDraftCandidates") };
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);

export const reserve = mutation({
  args: { ...scope, requestKey: v.string(), candidateFingerprint: v.string(), baselineFingerprint: v.string(), optionsFingerprint: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "candidate preflight request");
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(args.requestKey) || !hash(args.candidateFingerprint) || !hash(args.baselineFingerprint) || !hash(args.optionsFingerprint)) throw new Error("Invalid candidate preflight request");
    const [channel, candidate] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.candidateId)]);
    if (!channel || channel.ownerId !== args.ownerId || !candidate || candidate.channelId !== args.channelId) throw new Error("Candidate not found");
    const verified = verifiedDurationCandidate(candidate, args.ownerId, String(args.channelId));
    if (!verified || candidate.fingerprint !== args.candidateFingerprint || candidate.baselineFingerprint !== args.baselineFingerprint || channel.locked || channelPipelineWriteFence(channel) !== candidate.baselineFingerprint) throw new Error("Candidate baseline or identity changed");
    if (firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: verified.pipeline })) throw new Error("A changed module is locked");
    for (const block of Object.keys(channel.moduleLocks ?? {})) if (moduleConfigFingerprint(channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(verified.moduleConfig, block)) throw new Error("Module settings are locked");
    const proposal = durationCandidateProposal(channel, candidate.requestedSeconds);
    if (canonicalJson(proposal.pipeline) !== canonicalJson(verified.pipeline) || canonicalJson(proposal.moduleConfig) !== canonicalJson(verified.moduleConfig)) throw new Error("Candidate duration transformation changed");
    const existing = await ctx.db.query("durationCandidatePreflightRequests").withIndex("by_owner_candidate_key", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId).eq("requestKey", args.requestKey)).unique();
    if (existing) {
      if (existing.channelId !== args.channelId || existing.candidateFingerprint !== args.candidateFingerprint || existing.baselineFingerprint !== args.baselineFingerprint || existing.optionsFingerprint !== args.optionsFingerprint) throw new Error("Request key is already bound to different inputs");
      return { id: existing._id, state: existing.state, taskRunId: existing.taskRunId ?? null, reused: true };
    }
    const prior = await ctx.db.query("durationCandidatePreflightRequests").withIndex("by_owner_candidate_key", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId)).take(100);
    if (prior.length >= 100) throw new Error("Candidate check request limit reached");
    const now = Date.now();
    const id = await ctx.db.insert("durationCandidatePreflightRequests", { ...args, state: "pending", createdAt: now, updatedAt: now });
    return { id, state: "pending" as const, taskRunId: null, reused: false };
  },
});

export const get = query({
  args: { ...scope, requestId: v.id("durationCandidatePreflightRequests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.owner_id !== args.ownerId || !((identity.role === "owner" && identity.subject === args.ownerId) || identity.role === "service")) throw new Error("Owner verification required");
    const [row, channel] = await Promise.all([ctx.db.get(args.requestId), ctx.db.get(args.channelId)]);
    return channel?.ownerId === args.ownerId && row && row.ownerId === args.ownerId && row.channelId === args.channelId && row.candidateId === args.candidateId ? row : null;
  },
});

export const transition = mutation({
  args: { ...scope, requestId: v.id("durationCandidatePreflightRequests"), taskRunId: v.string(), action: v.union(v.literal("queue"), v.literal("start"), v.literal("complete"), v.literal("fail")), reportFingerprint: v.optional(v.string()), error: v.optional(v.string()), candidateFingerprint: v.string(), baselineFingerprint: v.string(), optionsFingerprint: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "candidate preflight state transition");
    const row = await ctx.db.get(args.requestId);
    if (!row || row.ownerId !== args.ownerId || row.channelId !== args.channelId || row.candidateId !== args.candidateId || row.candidateFingerprint !== args.candidateFingerprint || row.baselineFingerprint !== args.baselineFingerprint || row.optionsFingerprint !== args.optionsFingerprint || !args.taskRunId.trim() || args.taskRunId.length > 300) throw new Error("Candidate preflight request mismatch");
    if (row.taskRunId && row.taskRunId !== args.taskRunId) throw new Error("Candidate preflight task identity changed");
    if (row.state === "completed" || row.state === "failed") return { state: row.state };
    if (args.action === "complete") {
      if (!args.reportFingerprint || !hash(args.reportFingerprint)) throw new Error("Candidate preflight report is missing");
      const report = await ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_fingerprint", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId).eq("fingerprint", args.reportFingerprint!)).unique();
      const body = report?.report?.body;
      if (!report || report.channelId !== args.channelId || report.candidateFingerprint !== row.candidateFingerprint || report.baselineFingerprint !== row.baselineFingerprint || !body || !["duration-candidate-worker-preflight/v1", "duration-candidate-worker-preflight/v2"].includes(body.version) || body.taskRunId !== args.taskRunId || body.localReceipt?.body?.sourceOptionsFingerprint !== row.optionsFingerprint || (body.version === "duration-candidate-worker-preflight/v2" && (body.requestId !== String(args.requestId) || body.optionsFingerprint !== row.optionsFingerprint)) || sha256Hex(canonicalJson(body)) !== args.reportFingerprint || report.report.evidenceFingerprint !== args.reportFingerprint || report.report.provenance !== "worker-reported-unattested" || body.workerAttestation !== null || body.dispatchAuthorized !== false || body.channelQualification !== false) throw new Error("Candidate preflight report does not match task or options");
    }
    const state = args.action === "queue" ? (row.state === "running" ? "running" : "queued") : args.action === "start" ? "running" : args.action === "complete" ? "completed" : "failed";
    await ctx.db.patch(args.requestId, { state, taskRunId: args.taskRunId, updatedAt: Date.now(), ...(args.action === "complete" ? { reportFingerprint: args.reportFingerprint } : {}), ...(args.action === "fail" ? { error: "Local worker check failed. Review candidate settings and try a new check." } : {}) });
    return { state };
  },
});
