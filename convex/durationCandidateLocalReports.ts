import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "../src/lib/channelModuleLock";
import { verifiedDurationCandidate } from "../src/lib/durationCandidateEvidenceReview";
import { durationCandidateFamily } from "../src/lib/durationCandidateFamily";
import { durationCandidateProposal } from "../src/lib/durationCandidateProposal";
import { verifyDurationCandidateLocalReceipt } from "../src/lib/durationCandidateLocalReceipt";
import { normalizePipelineWorkerDeployment } from "../src/lib/pipelineWorkerDeployment";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export const list = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), candidateId: v.id("durationDraftCandidates") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.owner_id !== args.ownerId || !((identity.role === "owner" && identity.subject === args.ownerId) || identity.role === "service")) throw new Error("Owner verification required");
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate || candidate.ownerId !== args.ownerId || candidate.channelId !== args.channelId) throw new Error("Candidate not found");
    return ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_created", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId)).order("desc").take(20);
  },
});

export const retain = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), candidateId: v.id("durationDraftCandidates"), report: v.any() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "local candidate report retention");
    const [channel, candidate] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.candidateId)]);
    if (!channel || channel.ownerId !== args.ownerId || !candidate || candidate.channelId !== args.channelId) throw new Error("Channel or candidate not found");
    const verified = verifiedDurationCandidate(candidate, args.ownerId, String(args.channelId));
    if (!verified || channel.locked || channelPipelineWriteFence(channel) !== candidate.baselineFingerprint || durationCandidateFamily(channel) !== candidate.family) throw new Error("Candidate baseline or identity changed");
    if (firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: verified.pipeline })) throw new Error("A changed module is locked");
    for (const block of Object.keys(channel.moduleLocks ?? {})) if (moduleConfigFingerprint(channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(verified.moduleConfig, block)) throw new Error("Module settings are locked");
    const proposal = durationCandidateProposal(channel, candidate.requestedSeconds);
    if (canonicalJson(proposal.pipeline) !== canonicalJson(verified.pipeline) || canonicalJson(proposal.moduleConfig) !== canonicalJson(verified.moduleConfig)) throw new Error("Candidate no longer matches the duration transformation");
    const report = args.report;
    if (!record(report) || !record(report.body) || report.localCodeOnly !== true || report.receiptIssued !== false || report.dispatchAuthorized !== false || report.provenance !== "owner-supplied-options-unattested" || typeof report.evidenceFingerprint !== "string" || JSON.stringify(report).length > 150_000) throw new Error("Invalid local report");
    const body = report.body;
    if (body.version !== "duration-candidate-local-executable-planner/v2" || body.ownerId !== args.ownerId || body.channelId !== String(args.channelId) || body.candidateFingerprint !== candidate.fingerprint || body.baselineFingerprint !== candidate.baselineFingerprint || !record(body.localCompilation) || !record(body.planner) || sha256Hex(canonicalJson(body)) !== report.evidenceFingerprint) throw new Error("Local report does not match this candidate");
    const fingerprint = report.evidenceFingerprint;
    const existing = await ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_fingerprint", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId).eq("fingerprint", fingerprint)).unique();
    if (existing) return { id: existing._id, fingerprint, reused: true };
    const prior = await ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_created", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId)).take(20);
    if (prior.length >= 20) throw new Error("Candidate report limit reached");
    const id = await ctx.db.insert("durationCandidateLocalReports", { ownerId: args.ownerId, channelId: args.channelId, candidateId: args.candidateId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, fingerprint, report, createdAt: Date.now() });
    return { id, fingerprint, reused: false };
  },
});

/** Retains worker-reported local evidence, never an attestation or dispatch grant. */
export const retainWorkerReceipt = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), candidateId: v.id("durationDraftCandidates"), receipt: v.any(), taskRunId: v.string(), workerDeployment: v.any(), requestId: v.optional(v.id("durationCandidatePreflightRequests")) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "candidate worker receipt retention");
    const [channel, candidate] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.candidateId)]);
    if (!channel || channel.ownerId !== args.ownerId || !candidate || candidate.channelId !== args.channelId) throw new Error("Channel or candidate not found");
    const verified = verifiedDurationCandidate(candidate, args.ownerId, String(args.channelId));
    if (!verified || channel.locked || channelPipelineWriteFence(channel) !== candidate.baselineFingerprint || durationCandidateFamily(channel) !== candidate.family) throw new Error("Candidate baseline or identity changed");
    if (firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: verified.pipeline })) throw new Error("A changed module is locked");
    for (const block of Object.keys(channel.moduleLocks ?? {})) if (moduleConfigFingerprint(channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(verified.moduleConfig, block)) throw new Error("Module settings are locked");
    const proposal = durationCandidateProposal(channel, candidate.requestedSeconds);
    if (canonicalJson(proposal.pipeline) !== canonicalJson(verified.pipeline) || canonicalJson(proposal.moduleConfig) !== canonicalJson(verified.moduleConfig)) throw new Error("Candidate no longer matches the duration transformation");
    const receipt = verifyDurationCandidateLocalReceipt(args.receipt, { ownerId: args.ownerId, channelId: String(args.channelId), candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, pipeline: verified.pipeline, moduleConfig: verified.moduleConfig });
    if (!receipt || !record(args.receipt) || !record(args.receipt.body) || !record(verified.sourceInception) || args.receipt.body.sourceInceptionRequestFingerprint !== verified.sourceInception.requestFingerprint || JSON.stringify(args.receipt).length > 100_000) throw new Error("Candidate local receipt is invalid or changed");
    if (!args.taskRunId.trim() || args.taskRunId !== args.taskRunId.trim() || args.taskRunId.length > 300) throw new Error("Worker task run identity is invalid");
    const workerDeployment = normalizePipelineWorkerDeployment(args.workerDeployment);
    let requestBinding;
    if (args.requestId) {
      const request = await ctx.db.get(args.requestId);
      if (!request || request.ownerId !== args.ownerId || request.channelId !== args.channelId || request.candidateId !== args.candidateId || request.candidateFingerprint !== candidate.fingerprint || request.baselineFingerprint !== candidate.baselineFingerprint || request.taskRunId !== args.taskRunId || request.state !== "running" || request.optionsFingerprint !== args.receipt.body.sourceOptionsFingerprint) throw new Error("Candidate preflight request or options changed");
      requestBinding = { requestId: String(args.requestId), optionsFingerprint: request.optionsFingerprint };
    }
    const body = { version: requestBinding ? "duration-candidate-worker-preflight/v2" : "duration-candidate-worker-preflight/v1", ownerId: args.ownerId, channelId: String(args.channelId), candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, taskRunId: args.taskRunId, workerDeployment, localReceipt: args.receipt, ...(requestBinding ?? {}), workerAttestation: null, dispatchAuthorized: false, channelQualification: false };
    const fingerprint = sha256Hex(canonicalJson(body));
    const report = { body, evidenceFingerprint: fingerprint, provenance: "worker-reported-unattested", dispatchAuthorized: false, receiptIssued: false };
    const existing = await ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_fingerprint", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId).eq("fingerprint", fingerprint)).unique();
    if (existing) return { id: existing._id, fingerprint, reused: true };
    const prior = await ctx.db.query("durationCandidateLocalReports").withIndex("by_owner_candidate_created", q => q.eq("ownerId", args.ownerId).eq("candidateId", args.candidateId)).take(20);
    if (prior.some(row => record(row.report) && record(row.report.body) && ["duration-candidate-worker-preflight/v1", "duration-candidate-worker-preflight/v2"].includes(String(row.report.body.version)) && row.report.body.taskRunId === args.taskRunId)) throw new Error("Worker task run already retained different candidate evidence");
    if (prior.length >= 20) throw new Error("Candidate report limit reached");
    const id = await ctx.db.insert("durationCandidateLocalReports", { ownerId: args.ownerId, channelId: args.channelId, candidateId: args.candidateId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, fingerprint, report, createdAt: Date.now() });
    return { id, fingerprint, reused: false };
  },
});
