import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { YuE2MusicCandidateSchema } from "../src/engine/yue2MusicCandidate";
import { AcceptedMusicArrangementSchema } from "../src/engine/acceptedMusicArrangement";
import { YuE2SourceApprovalBasisSchema, type YuE2SourceApproval } from "../src/engine/yue2SourceApproval";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { assertRunExecutionWriteFence, RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";
import { verifiedWorkerDeploymentFields } from "./pipelineWorkerDeploymentTransport";
import { verifiedYuE2Approval } from "./yue2ApprovalIdentity";
import { YuE2AssemblySourceSchema } from "../src/engine/yue2AssemblySource";
import type { PipelineInvocationSnapshot } from "../src/lib/pipelineInvocationSnapshot";

type Ctx = QueryCtx | MutationCtx;
const scope = { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs") };
export const yue2ResumeValidator = v.object({
  checkpointId: v.id("yue2Continuations"), checkpointFingerprint: v.string(),
  approvalFingerprint: v.string(), invocationSha256: v.string(),
});
export type YuE2Resume = { checkpointId: Id<"yue2Continuations">; checkpointFingerprint: string;
  approvalFingerprint: string; invocationSha256: string };

async function basisFromStages(ctx: Ctx, run: Doc<"runs">) {
  verifiedWorkerDeploymentFields(run);
  const music = await ctx.db.query("runStages").withIndex("by_run_block", q => q.eq("runId", run._id).eq("block", "music")).take(2);
  const composers = await ctx.db.query("runStages").withIndex("by_run_block", q => q.eq("runId", run._id).eq("block", "music_arrangement_plan")).take(2);
  if (music.length !== 1 || composers.length !== 1 || music[0].status !== "ok" || composers[0].status !== "ok") {
    throw new Error("YuE2 requires one retained music stage and accepted arrangement");
  }
  const candidate = YuE2MusicCandidateSchema.parse(music[0].outputs?.yue2MusicCandidate);
  const arrangement = AcceptedMusicArrangementSchema.parse(composers[0].outputs?.acceptedMusicArrangement);
  if (candidate.ownerId !== run.ownerId || candidate.channelId !== run.channelId || candidate.runId !== run._id ||
    arrangement.ownerId !== run.ownerId || arrangement.channelId !== run.channelId || arrangement.runId !== run._id ||
    candidate.arrangementFingerprint !== arrangement.fingerprint || !arrangement.reviewContext || candidate.technicalStatus !== "needs_audition") {
    throw new Error("YuE2 retained stage identity mismatch");
  }
  return YuE2SourceApprovalBasisSchema.parse({ ownerId: run.ownerId, channelId: run.channelId, runId: run._id,
    invocationSha256: run.pipelineInvocationSha256, candidateSha256: candidate.candidateSha256,
    arrangementFingerprint: arrangement.fingerprint, jobId: candidate.jobId,
    listeningAudioKey: candidate.listeningAudioKey, listeningAudioSha256: candidate.listeningAudioSha256,
    nativeFrames: candidate.nativeFrames, sampleRateHz: 48000, channels: 2,
    sectionIds: arrangement.arrangement.sections.map(section => section.id), technicalStatus: "needs_audition", contextRetained: true });
}

async function currentApproval(ctx: Ctx, row: Doc<"yue2Continuations">) {
  const audition = await ctx.db.query("yue2Auditions").withIndex("by_owner_run_candidate", q =>
    q.eq("ownerId", row.ownerId).eq("runId", row.runId).eq("candidateSha256", row.basis.candidateSha256)).order("desc").first();
  const approval = verifiedYuE2Approval(audition, row.basis.invocationSha256);
  if (approval && canonicalJson(approval.basis) !== canonicalJson(row.basis)) throw new Error("YuE2 approval/checkpoint basis mismatch");
  return approval;
}

async function verifyRow(ctx: Ctx, run: Doc<"runs">) {
  const row = run.yue2ContinuationId ? await ctx.db.get(run.yue2ContinuationId) : null;
  if (!row || row.ownerId !== run.ownerId || row.channelId !== run.channelId || row.runId !== run._id ||
    row.fingerprint !== sha256Hex(canonicalJson(row.basis)) || canonicalJson(row.basis) !== canonicalJson(await basisFromStages(ctx, run))) {
    throw new Error("YuE2 continuation no longer binds the frozen retained stages");
  }
  return row;
}

export async function updateYuE2ContinuationDecision(ctx: MutationCtx, run: Doc<"runs">, approval: YuE2SourceApproval | null, candidateSha256: string) {
  if (!run.yue2ContinuationId || run.status !== "awaiting_music_audition") return;
  const row = await verifyRow(ctx, run);
  if (row.basis.candidateSha256 !== candidateSha256) return;
  if (row.state === "consumed" || row.state === "blocked") return;
  if (approval && canonicalJson(approval.basis) !== canonicalJson(row.basis)) throw new Error("YuE2 decision targets a different retained source");
  if (row.approvalFingerprint === approval?.fingerprint) return;
  await ctx.db.patch(row._id, { state: approval ? "pending" : "awaiting", approvalFingerprint: approval?.fingerprint,
    attempts: 0, queueDeadlineAt: undefined, triggerRunId: undefined, error: undefined, updatedAt: Date.now() });
}

export const createAwaiting = mutation({ args: { ...scope, invocationSha256: v.string(),
  leaseOwner: v.string(), executionLeaseToken: v.number() }, handler: async (ctx, args) => {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE2 checkpoint creation");
  const run = await ctx.db.get(args.runId), channel = await ctx.db.get(args.channelId);
  if (!run || !channel || run.ownerId !== args.ownerId || channel.ownerId !== args.ownerId || run.channelId !== args.channelId ||
    run.pipelineInvocationSha256 !== args.invocationSha256) throw new Error("YuE2 checkpoint scope mismatch");
  assertRunExecutionWriteFence(run, args, Date.now());
  const basis = await basisFromStages(ctx, run), fingerprint = sha256Hex(canonicalJson(basis));
  const rows = await ctx.db.query("yue2Continuations").withIndex("by_run", q => q.eq("runId", run._id)).take(2);
  if (rows.length > 1 || rows[0] && (rows[0].fingerprint !== fingerprint || rows[0].state === "consumed" || rows[0].state === "blocked")) {
    throw new Error("YuE2 checkpoint replay mismatch");
  }
  const now = Date.now();
  const id = rows[0]?._id ?? await ctx.db.insert("yue2Continuations", { ownerId: args.ownerId, channelId: args.channelId,
    runId: args.runId, basis, fingerprint, state: "awaiting", attempts: 0, createdAt: now, updatedAt: now });
  await ctx.db.patch(run._id, { yue2ContinuationId: id, status: "awaiting_music_audition", heartbeatAt: now,
    leaseOwner: undefined, leaseExpiresAt: undefined, leaseRecoveryPending: undefined,
    remoteChildWaitLeaseOwner: undefined, remoteChildWaitExecutionLeaseToken: undefined,
    remoteChildWaitBlockId: undefined, remoteChildWaitDispatchKey: undefined, remoteChildWaitUntil: undefined,
    remoteChildWaitDeadline: undefined, error: undefined });
  const parked = (await ctx.db.get(run._id))!;
  await updateYuE2ContinuationDecision(ctx, parked, await currentApproval(ctx, (await ctx.db.get(id))!), basis.candidateSha256);
  return { checkpointId: id, checkpointFingerprint: fingerprint };
} });

/** Reproved on every claim, including ordinary retries after the first delivery. */
export async function assertYuE2Continuation(ctx: Ctx, run: Doc<"runs">, resume?: YuE2Resume) {
  const row = await verifyRow(ctx, run);
  const approval = await currentApproval(ctx, row);
  if (!approval || approval.fingerprint !== row.approvalFingerprint || !["pending", "queued", "consumed"].includes(row.state)) {
    throw new Error("YuE2 continuation lacks its current explicit owner approval");
  }
  if (row.state === "queued" && (!Number.isSafeInteger(row.queueDeadlineAt) || row.queueDeadlineAt! <= Date.now())) {
    throw new Error("YuE2 queued delivery expired before execution claim");
  }
  if (resume && (resume.checkpointId !== row._id || resume.checkpointFingerprint !== row.fingerprint ||
    resume.approvalFingerprint !== approval.fingerprint || resume.invocationSha256 !== row.basis.invocationSha256)) {
    throw new Error("YuE2 continuation delivery is stale or mismatched");
  }
  return row;
}

export const getApproved = query({ args: { ...scope, resume: v.optional(yue2ResumeValidator) }, handler: async (ctx, args) => {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE2 continuation read");
  const run = await ctx.db.get(args.runId);
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) throw new Error("YuE2 continuation scope mismatch");
  const row = await assertYuE2Continuation(ctx, run, args.resume);
  if (!args.resume && row.state !== "consumed") throw new Error("YuE2 continuation has not been consumed");
  return row;
} });

/** Small authoritative read at release boundaries; cached artifacts never grandfather a revoked decision. */
export const verifyReleaseSource = query({ args: { ...scope, source: v.optional(v.any()) }, handler: async (ctx, args) => {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE2 release source");
  const run = await ctx.db.get(args.runId), channel = await ctx.db.get(args.channelId);
  if (!run || !channel || run.ownerId !== args.ownerId || channel.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("YuE2 release source scope mismatch");
  }
  verifiedWorkerDeploymentFields(run);
  const invocation = run.pipelineInvocationSnapshot as PipelineInvocationSnapshot | undefined;
  const required = Boolean(run.yue2ContinuationId || invocation?.entries.some(entry =>
    entry.block === "music" && entry.version === "3.0.0-yue2-candidate") ||
    (Array.isArray(invocation?.compilationModules) && invocation.compilationModules.some(module =>
      module?.id === "music" && module.version === "3.0.0-yue2-candidate")));
  if (!required && args.source === undefined) return null;
  const source = YuE2AssemblySourceSchema.parse(args.source);
  const row = await assertYuE2Continuation(ctx, run);
  if (row.state !== "consumed" || source.approvalFingerprint !== row.approvalFingerprint ||
    source.candidateSha256 !== row.basis.candidateSha256 || source.arrangementFingerprint !== row.basis.arrangementFingerprint ||
    source.listeningAudioSha256 !== row.basis.listeningAudioSha256 || source.nativeFrames !== row.basis.nativeFrames) {
    throw new Error("YuE2 release source no longer matches the consumed approval");
  }
  const stages = [];
  for (const block of ["assemble", "timeline_assemble"]) {
    stages.push(...await ctx.db.query("runStages").withIndex("by_run_block", q => q.eq("runId", run._id).eq("block", block)).take(2));
  }
  if (stages.length !== 1 || stages[0].status !== "ok" ||
    canonicalJson(YuE2AssemblySourceSchema.parse(stages[0].outputs?.yue2AssemblySource)) !== canonicalJson(source)) {
    throw new Error("YuE2 release source differs from the retained assembly receipt");
  }
  return source;
} });

export async function prepareYuE2Dispatch(ctx: MutationCtx, args: { ownerId: string }) {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE2 continuation dispatch");
  const now = Date.now();
  const expired = await ctx.db.query("yue2Continuations").withIndex("by_owner_state_deadline", q =>
    q.eq("ownerId", args.ownerId).eq("state", "queued").lte("queueDeadlineAt", now)).take(25);
  for (const row of expired) {
    await ctx.db.patch(row._id, { state: row.attempts < 2 ? "pending" : "blocked", updatedAt: now,
      queueDeadlineAt: undefined, error: "YuE2 accepted delivery expired before claim" });
  }
  const rows = await ctx.db.query("yue2Continuations").withIndex("by_owner_state_deadline", q =>
    q.eq("ownerId", args.ownerId).eq("state", "pending")).take(25);
  const pending = [];
  for (const row of rows) {
    try {
      const run = await ctx.db.get(row.runId);
      if (!run || run.status !== "awaiting_music_audition" || row.attempts >= 2) throw new Error("YuE2 continuation is not dispatchable");
      await assertYuE2Continuation(ctx, run);
      pending.push({ channelId: row.channelId, runId: row.runId, attempt: row.attempts + 1,
        invocationSha256: row.basis.invocationSha256 as string, ...verifiedWorkerDeploymentFields(run),
        yue2AuditionResume: { checkpointId: row._id, checkpointFingerprint: row.fingerprint,
          approvalFingerprint: row.approvalFingerprint!, invocationSha256: row.basis.invocationSha256 as string } });
    } catch {
      await ctx.db.patch(row._id, { state: "blocked", updatedAt: now, error: "YuE2 continuation integrity requires manual reconciliation" });
    }
  }
  return pending;
}

export const prepareDispatch = mutation({ args: { ownerId: v.string() }, handler: prepareYuE2Dispatch });

export const recordDispatch = mutation({ args: { ...scope, resume: yue2ResumeValidator, attempt: v.number(), triggerRunId: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireStudioServiceIdentity(ctx, args.ownerId, "YuE2 continuation acknowledgement");
  const run = await ctx.db.get(args.runId);
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) throw new Error("YuE2 continuation scope mismatch");
  const row = await assertYuE2Continuation(ctx, run, args.resume);
  if (row.state === "consumed" || row.state === "queued") return;
  if (args.attempt !== row.attempts + 1 || args.attempt > 2) throw new Error("YuE2 delivery attempt mismatch");
  const now = Date.now();
  await ctx.db.patch(row._id, { state: args.triggerRunId ? "queued" : args.attempt >= 2 ? "blocked" : "pending",
    attempts: args.attempt, updatedAt: now, triggerRunId: args.triggerRunId,
    queueDeadlineAt: args.triggerRunId ? now + RUN_QUEUE_LEASE_MS : undefined,
    error: args.triggerRunId ? undefined : "YuE2 continuation enqueue failed" });
} });
