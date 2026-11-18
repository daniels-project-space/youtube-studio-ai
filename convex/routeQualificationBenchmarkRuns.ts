import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  assertRouteQualificationBenchmarkRequestApproval,
  assertRouteQualificationBenchmarkDispatchEnvelope,
  routeQualificationBenchmarkRequestApprovalSubject,
  type RouteQualificationBenchmarkDispatchEnvelope,
} from "../src/lib/routeQualificationBenchmark";
import { RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import type { StudioActionApprovalReceipt } from "../src/lib/studioActionApprovalContract";
import { verifiedDurationCandidate } from "../src/lib/durationCandidateEvidenceReview";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { candidateBenchmarkInvocation } from "../src/lib/candidateBenchmarkInvocation";

const MAX_ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_ATTEMPTS = 2;
const SHA256 = /^[a-f0-9]{64}$/;

type BenchmarkRun = Doc<"runs">;

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = required(value, label);
  if (!SHA256.test(output)) throw new Error(`${label} must be a sha256 fingerprint`);
  return output;
}

function limit(value: unknown, fallback = 25): number {
  return Math.max(1, Math.min(50, Math.floor(typeof value === "number" ? value : fallback)));
}

function queueDeadline(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("route qualification benchmark queue time is invalid");
  }
  return now + RUN_QUEUE_LEASE_MS;
}

function ownedRun(
  run: BenchmarkRun | null,
  args: { readonly ownerId: string; readonly channelId: Id<"channels">; readonly runId: Id<"runs"> },
): BenchmarkRun {
  if (!run || run._id !== args.runId || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("route qualification benchmark run ownership/channel mismatch");
  }
  return run;
}

function dispatchEnvelope(run: BenchmarkRun): RouteQualificationBenchmarkDispatchEnvelope {
  const envelope = run.routeQualificationBenchmarkDispatchEnvelope;
  if (!envelope) throw new Error("route qualification benchmark run has no immutable dispatch envelope");
  assertRouteQualificationBenchmarkDispatchEnvelope(envelope);
  if (
    envelope.ownerId !== run.ownerId ||
    envelope.channelId !== String(run.channelId) ||
    envelope.runId !== String(run._id) ||
    run.routeQualificationBenchmarkDispatchKey !== envelope.dispatchKey ||
    run.routeQualificationBenchmarkDispatchEnvelopeFingerprint !== envelope.dispatchEnvelopeFingerprint
  ) {
    throw new Error("route qualification benchmark envelope is not bound to its durable run");
  }
  return envelope;
}

function requestApproval(run: BenchmarkRun): {
  approval: StudioActionApprovalReceipt;
  maximumCostUsd: number;
  approvalFingerprint: string;
} {
  const approval = run.routeQualificationBenchmarkRequestApproval;
  const maximumCostUsd = run.routeQualificationBenchmarkMaximumCostUsd;
  assertRouteQualificationBenchmarkRequestApproval({ maximumCostUsd, approval });
  const acceptedApproval = approval as StudioActionApprovalReceipt;
  const acceptedMaximumCostUsd = maximumCostUsd as number;
  const approvalFingerprint = sha256Hex(canonicalJson(acceptedApproval));
  if (
    run.routeQualificationBenchmarkRequestApprovalFingerprint !== approvalFingerprint ||
    acceptedApproval.subject !== routeQualificationBenchmarkRequestApprovalSubject({
      ownerId: run.ownerId,
      channelId: String(run.channelId),
      runId: String(run._id),
      dispatchKey: required(run.routeQualificationBenchmarkDispatchKey, "route qualification benchmark request dispatch key"),
      maximumCostUsd: acceptedMaximumCostUsd,
      ...(run.routeQualificationBenchmarkCandidate ? { candidate: { ...run.routeQualificationBenchmarkCandidate, candidateId: String(run.routeQualificationBenchmarkCandidate.candidateId) } } : {}),
    })
  ) {
    throw new Error("route qualification benchmark owner request is not bound to its durable run");
  }
  return {
    approval: acceptedApproval,
    maximumCostUsd: acceptedMaximumCostUsd,
    approvalFingerprint,
  };
}

/**
 * Used by the execution-lease claim, not the browser. A plain generic task
 * cannot cross this owner-confirmed private execution boundary.
 */
export function assertRouteQualificationBenchmarkDispatchLease(
  run: BenchmarkRun,
  input: unknown,
): RouteQualificationBenchmarkDispatchEnvelope {
  if (run.routeQualificationBenchmarkCandidate) throw new Error("candidate benchmark worker admission is not available");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("route qualification benchmark dispatch lease is missing");
  }
  const record = input as Record<string, unknown>;
  const dispatchEnvelopeFingerprint = fingerprint(
    record["dispatchEnvelopeFingerprint"],
    "route qualification benchmark dispatch lease fingerprint",
  );
  if (run.status !== "awaiting_route_qualification_benchmark_dispatch") {
    throw new Error("route qualification benchmark is not awaiting its dedicated dispatch");
  }
  if (
    run.routeQualificationBenchmarkDispatchState !== "pending" &&
    run.routeQualificationBenchmarkDispatchState !== "queued"
  ) {
    throw new Error("route qualification benchmark dispatch is not claimable");
  }
  const envelope = dispatchEnvelope(run);
  if (envelope.dispatchEnvelopeFingerprint !== dispatchEnvelopeFingerprint) {
    throw new Error("route qualification benchmark dispatch lease does not match its immutable envelope");
  }
  return envelope;
}

/**
 * Creates a no-spend, idempotent run shell before its exact signed envelope is
 * assembled. A caller retry can continue claiming the same shell; no runner
 * can claim it until the envelope exists and the dedicated dispatcher sends it.
 */
export const createShell = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    dispatchKey: v.string(),
    candidate: v.optional(v.object({ candidateId: v.id("durationDraftCandidates"), fingerprint: v.string(), baselineFingerprint: v.string() })),
    now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark shell creation");
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("route qualification benchmark shell time is invalid");
    const dispatchKey = required(args.dispatchKey, "route qualification benchmark dispatch key");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("route qualification benchmark channel is not owned by this operator");
    }
    if (args.candidate) {
      const candidate = await ctx.db.get(args.candidate.candidateId);
      if (!candidate || !verifiedDurationCandidate(candidate, args.ownerId, String(args.channelId)) || candidate.fingerprint !== fingerprint(args.candidate.fingerprint, "candidate fingerprint") || candidate.baselineFingerprint !== fingerprint(args.candidate.baselineFingerprint, "candidate baseline fingerprint") || channelPipelineWriteFence(channel) !== candidate.baselineFingerprint || channel.locked) throw new Error("candidate or channel baseline is unavailable or changed");
    }
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_owner_channel_route_qualification_benchmark_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("channelId", args.channelId)
        .eq("routeQualificationBenchmarkDispatchKey", dispatchKey))
      .unique();
    if (existing) {
      if (canonicalJson(existing.routeQualificationBenchmarkCandidate ?? null) !== canonicalJson(args.candidate ?? null)) throw new Error("request key is already bound to a different candidate");
      return {
        state: existing.routeQualificationBenchmarkDispatchEnvelope ||
          existing.routeQualificationBenchmarkRequestApproval
          ? "reused" as const
          : "shell" as const,
        runId: existing._id,
      };
    }
    const runId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: "awaiting_route_qualification_benchmark_dispatch",
      startedAt: now,
      libraryOrderAt: now,
      heartbeatAt: now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: now,
      routeQualificationBenchmarkDispatchKey: dispatchKey,
      ...(args.candidate ? { routeQualificationBenchmarkCandidate: args.candidate } : {}),
    });
    return { state: "created" as const, runId };
  },
});

/** Stores the request only after the durable shell id is available to bind it. */
export const claimRequestApproval = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    maximumCostUsd: v.number(),
    approval: v.any(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark request claim");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("route qualification benchmark request claim time is invalid");
    }
    assertRouteQualificationBenchmarkRequestApproval({
      maximumCostUsd: args.maximumCostUsd,
      approval: args.approval,
    });
    const approval = args.approval as typeof args.approval & { subject: string };
    if (approval.subject !== routeQualificationBenchmarkRequestApprovalSubject({
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      runId: String(args.runId),
      dispatchKey: required(run.routeQualificationBenchmarkDispatchKey, "route qualification benchmark request dispatch key"),
      maximumCostUsd: args.maximumCostUsd,
      ...(run.routeQualificationBenchmarkCandidate ? { candidate: { ...run.routeQualificationBenchmarkCandidate, candidateId: String(run.routeQualificationBenchmarkCandidate.candidateId) } } : {}),
    })) {
      throw new Error("route qualification benchmark request approval is not bound to its durable shell");
    }
    if (run.status !== "awaiting_route_qualification_benchmark_dispatch") {
      throw new Error("route qualification benchmark shell is not awaiting an owner request");
    }
    const approvalFingerprint = sha256Hex(canonicalJson(args.approval));
    let invocationInput: ReturnType<typeof candidateBenchmarkInvocation> | undefined;
    if (run.routeQualificationBenchmarkCandidate) {
      const target = run.routeQualificationBenchmarkCandidate;
      const channel = await ctx.db.get(args.channelId);
      const candidate = await ctx.db.get(target.candidateId);
      if (!channel) throw new Error("candidate benchmark channel is unavailable");
      const version = run.routeQualificationBenchmarkCandidateInvocationInput?.body?.version;
      if (version !== undefined && version !== "candidate-benchmark-invocation-input/v1" && version !== "candidate-benchmark-invocation-input/v2") throw new Error("candidate benchmark invocation input version is invalid");
      invocationInput = candidateBenchmarkInvocation({ ownerId: args.ownerId, channelId: String(args.channelId), runId: String(args.runId), target: { ...target, candidateId: String(target.candidateId) }, channel, candidate, maximumCostUsd: args.maximumCostUsd, ...(version ? { version } : {}) });
    }
    if (run.routeQualificationBenchmarkRequestApproval !== undefined) {
      const existing = requestApproval(run);
      if (existing.approvalFingerprint !== approvalFingerprint) {
        throw new Error("route qualification benchmark owner request is immutable");
      }
      if (invocationInput && canonicalJson(run.routeQualificationBenchmarkCandidateInvocationInput) !== canonicalJson(invocationInput)) throw new Error("candidate benchmark invocation input is immutable or unavailable");
      return { fingerprint: approvalFingerprint, reused: true };
    }
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkRequestApproval: args.approval,
      routeQualificationBenchmarkRequestApprovalFingerprint: approvalFingerprint,
      routeQualificationBenchmarkMaximumCostUsd: args.maximumCostUsd,
      ...(invocationInput ? { routeQualificationBenchmarkCandidateInvocationInput: invocationInput } : {}),
      routeQualificationBenchmarkDispatchState: "pending",
      routeQualificationBenchmarkDispatchAttempts: 0,
      routeQualificationBenchmarkPreparationLastError: undefined,
      routeQualificationBenchmarkPreparationUpdatedAt: args.now,
      heartbeatAt: args.now,
    });
    return { fingerprint: approvalFingerprint, reused: false };
  },
});

/** Atomically installs the one signed payload used by all delivery retries. */
export const claimDispatchEnvelope = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    envelope: v.any(),
    fingerprint: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark envelope claim");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    if (run.routeQualificationBenchmarkCandidate) throw new Error("candidate benchmark worker admission is not available");
    const requestedFingerprint = fingerprint(args.fingerprint, "route qualification benchmark envelope fingerprint");
    assertRouteQualificationBenchmarkDispatchEnvelope(args.envelope);
    const envelope = args.envelope as RouteQualificationBenchmarkDispatchEnvelope;
    if (
      envelope.ownerId !== args.ownerId ||
      envelope.channelId !== String(args.channelId) ||
      envelope.runId !== String(args.runId) ||
      envelope.dispatchEnvelopeFingerprint !== requestedFingerprint ||
      run.routeQualificationBenchmarkDispatchKey !== envelope.dispatchKey
    ) {
      throw new Error("route qualification benchmark envelope is not bound to its durable shell");
    }
    const encoded = JSON.stringify(envelope);
    if (encoded.length > 250_000) throw new Error("route qualification benchmark envelope exceeds 250000 characters");
    if (run.status !== "awaiting_route_qualification_benchmark_dispatch") {
      throw new Error("route qualification benchmark shell is not awaiting an envelope");
    }
    requestApproval(run);
    if (run.routeQualificationBenchmarkDispatchEnvelope !== undefined) {
      const existing = dispatchEnvelope(run);
      if (existing.dispatchEnvelopeFingerprint !== requestedFingerprint) {
        throw new Error("route qualification benchmark dispatch envelope is immutable");
      }
      return { envelope: existing, fingerprint: requestedFingerprint, reused: true };
    }
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkDispatchEnvelope: envelope,
      routeQualificationBenchmarkDispatchEnvelopeFingerprint: requestedFingerprint,
      routeQualificationBenchmarkDispatchState: "pending",
      routeQualificationBenchmarkDispatchLastError: undefined,
      routeQualificationBenchmarkPreparationLastError: undefined,
      routeQualificationBenchmarkPreparationUpdatedAt: Date.now(),
    });
    return { envelope, fingerprint: requestedFingerprint, reused: false };
  },
});

function pendingDispatch(run: BenchmarkRun) {
  if (run.status !== "awaiting_route_qualification_benchmark_dispatch" || run.routeQualificationBenchmarkDispatchState !== "pending") return null;
  const request = requestApproval(run);
  const envelope = run.routeQualificationBenchmarkDispatchEnvelope === undefined ? undefined : dispatchEnvelope(run);
  const attempt = run.routeQualificationBenchmarkDispatchAttempts ?? 0;
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= MAX_ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_ATTEMPTS) {
    throw new Error("route qualification benchmark dispatch is exhausted");
  }
  return { runId: run._id, channelId: run.channelId,
    dispatchKey: required(run.routeQualificationBenchmarkDispatchKey, "route qualification benchmark dispatch key"),
    envelope, approval: request.approval, approvalFingerprint: request.approvalFingerprint,
    maximumCostUsd: request.maximumCostUsd, attempt, candidate: run.routeQualificationBenchmarkCandidate, candidateInvocationInput: run.routeQualificationBenchmarkCandidateInvocationInput };
}

/** Fetch one owner-approved request without waking unrelated channels. */
export const getPendingForRun = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark targeted dispatch");
    return pendingDispatch(ownedRun(await ctx.db.get(args.runId), args));
  },
});

export const listPending = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark dispatch recovery");
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_route_qualification_benchmark_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("routeQualificationBenchmarkDispatchState", "pending"))
      .take(limit(args.limit) * 2);
    const pending: Array<{
      runId: Id<"runs">;
      channelId: Id<"channels">;
      dispatchKey: string;
      envelope?: RouteQualificationBenchmarkDispatchEnvelope;
      approval: unknown;
      approvalFingerprint: string;
      maximumCostUsd: number;
      attempt: number;
      candidate?: { candidateId: Id<"durationDraftCandidates">; fingerprint: string; baselineFingerprint: string };
      candidateInvocationInput?: unknown;
    }> = [];
    for (const run of rows) {
      try {
        const receipt = pendingDispatch(run);
        if (receipt) pending.push(receipt);
      } catch {
        // The next explicit owner action/reaper surfaces a malformed receipt;
        // never turn a corrupted row into an executable task payload.
      }
      if (pending.length >= limit(args.limit)) break;
    }
    return pending;
  },
});

export const markQueued = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    dispatchEnvelopeFingerprint: v.string(),
    triggerRunId: v.string(),
    queuedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark dispatch acknowledgement");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    const envelope = dispatchEnvelope(run);
    if (envelope.dispatchEnvelopeFingerprint !== fingerprint(args.dispatchEnvelopeFingerprint, "route qualification benchmark acknowledgement fingerprint")) {
      throw new Error("route qualification benchmark acknowledgement does not match its immutable envelope");
    }
    if (!Number.isSafeInteger(args.queuedAt) || args.queuedAt < 0 || !args.triggerRunId.trim()) {
      throw new Error("route qualification benchmark dispatch acknowledgement is invalid");
    }
    if (run.routeQualificationBenchmarkDispatchState === "consumed") return { state: "consumed" as const };
    if (run.routeQualificationBenchmarkDispatchState !== "pending") {
      throw new Error("route qualification benchmark dispatch acknowledgement is stale");
    }
    const attempts = (run.routeQualificationBenchmarkDispatchAttempts ?? 0) + 1;
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkDispatchState: "queued",
      routeQualificationBenchmarkDispatchAttempts: attempts,
      routeQualificationBenchmarkDispatchQueuedAt: args.queuedAt,
      routeQualificationBenchmarkDispatchQueueDeadlineAt: queueDeadline(args.queuedAt),
      routeQualificationBenchmarkDispatchTriggerRunId: args.triggerRunId.slice(0, 500),
      routeQualificationBenchmarkDispatchLastError: undefined,
      heartbeatAt: args.queuedAt,
    });
    return { state: "queued" as const, attempts };
  },
});

export const recordEnqueueFailure = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    dispatchEnvelopeFingerprint: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark dispatch failure");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    const envelope = dispatchEnvelope(run);
    if (envelope.dispatchEnvelopeFingerprint !== fingerprint(args.dispatchEnvelopeFingerprint, "route qualification benchmark failure fingerprint")) {
      throw new Error("route qualification benchmark failure does not match its immutable envelope");
    }
    if (!Number.isSafeInteger(args.failedAt) || args.failedAt < 0) {
      throw new Error("route qualification benchmark dispatch failure time is invalid");
    }
    if (run.routeQualificationBenchmarkDispatchState !== "pending") return { state: "unchanged" as const };
    const attempts = (run.routeQualificationBenchmarkDispatchAttempts ?? 0) + 1;
    const error = args.error.trim().slice(0, 1_000) || "route qualification benchmark dispatch failed";
    if (attempts >= MAX_ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_ATTEMPTS) {
      await ctx.db.patch(run._id, {
        status: "route_qualification_benchmark_blocked",
        routeQualificationBenchmarkDispatchState: "blocked",
        routeQualificationBenchmarkDispatchAttempts: attempts,
        routeQualificationBenchmarkDispatchLastError: error,
        error: `route qualification benchmark dispatch exhausted its bounded delivery attempts: ${error}`,
        finishedAt: args.failedAt,
        heartbeatAt: args.failedAt,
      });
      return { state: "blocked" as const, attempts };
    }
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkDispatchAttempts: attempts,
      routeQualificationBenchmarkDispatchLastError: error,
      heartbeatAt: args.failedAt,
    });
    return { state: "pending" as const, attempts };
  },
});

/** Preparation has no provider side effect. Keep a recoverable diagnostic but
 * do not consume a delivery attempt while the operator repairs preflight. */
export const recordPreparationFailure = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    error: v.string(),
    failedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark preparation failure");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    requestApproval(run);
    if (run.status !== "awaiting_route_qualification_benchmark_dispatch") {
      return { state: "unchanged" as const };
    }
    if (!Number.isSafeInteger(args.failedAt) || args.failedAt < 0) {
      throw new Error("route qualification benchmark preparation failure time is invalid");
    }
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkPreparationLastError:
        args.error.trim().slice(0, 1_000) || "route qualification benchmark preparation failed",
      routeQualificationBenchmarkPreparationUpdatedAt: args.failedAt,
      heartbeatAt: args.failedAt,
    });
    return { state: "pending" as const };
  },
});

/** Stores a diagnostic only. It can neither issue a receipt nor authorize a worker. */
export const recordCandidatePreflightBlocked = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), report: v.any(), failedAt: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "candidate benchmark preflight");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    requestApproval(run);
    const target = run.routeQualificationBenchmarkCandidate;
    const report = args.report;
    if (!target || run.status !== "awaiting_route_qualification_benchmark_dispatch" || run.routeQualificationBenchmarkDispatchState !== "pending" || run.routeQualificationBenchmarkDispatchEnvelope !== undefined || !Number.isSafeInteger(args.failedAt) || args.failedAt < 0 || !report || typeof report !== "object" || !report.binding || report.binding.ownerId !== args.ownerId || report.binding.channelId !== String(args.channelId) || report.binding.candidateFingerprint !== target.fingerprint || report.binding.baselineFingerprint !== target.baselineFingerprint || report.binding.maximumCostUsd !== run.routeQualificationBenchmarkMaximumCostUsd || report.ready !== false || report.dispatchAuthorized !== false || report.receiptIssued !== false || !Array.isArray(report.blockers) || JSON.stringify(report).length > 100_000) throw new Error("candidate benchmark preflight report is invalid");
    await ctx.db.patch(run._id, { routeQualificationBenchmarkCandidatePreflight: report, routeQualificationBenchmarkDispatchState: "blocked", status: "route_qualification_benchmark_blocked", routeQualificationBenchmarkPreparationLastError: "Candidate preflight is not an admission; candidate-aware worker validation is unavailable.", routeQualificationBenchmarkPreparationUpdatedAt: args.failedAt, heartbeatAt: args.failedAt, finishedAt: args.failedAt });
    return { state: "blocked" as const };
  },
});

async function recoverExpiredQueued(ctx: MutationCtx, run: BenchmarkRun, now: number): Promise<"requeued" | "blocked"> {
  try {
    dispatchEnvelope(run);
    const attempts = run.routeQualificationBenchmarkDispatchAttempts;
    if (run.status !== "awaiting_route_qualification_benchmark_dispatch" || !Number.isSafeInteger(attempts) ||
        (attempts ?? 0) < 1 || (attempts ?? 0) >= MAX_ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_ATTEMPTS) {
      throw new Error("route qualification benchmark queued dispatch is invalid or exhausted");
    }
    await ctx.db.patch(run._id, {
      routeQualificationBenchmarkDispatchState: "pending",
      routeQualificationBenchmarkDispatchQueuedAt: undefined,
      routeQualificationBenchmarkDispatchQueueDeadlineAt: undefined,
      routeQualificationBenchmarkDispatchTriggerRunId: undefined,
      routeQualificationBenchmarkDispatchLastError:
        "accepted Trigger delivery expired before the private benchmark execution claim; reissuing exact immutable envelope",
      heartbeatAt: now,
    });
    return "requeued";
  } catch (error) {
    await ctx.db.patch(run._id, {
      status: "route_qualification_benchmark_blocked",
      routeQualificationBenchmarkDispatchState: "blocked",
      routeQualificationBenchmarkDispatchQueueDeadlineAt: undefined,
      routeQualificationBenchmarkDispatchLastError:
        error instanceof Error ? error.message.slice(0, 1_000) : "route qualification benchmark queue recovery failed",
      error: "route qualification benchmark dispatch is corrupt or exhausted; manual reconciliation is required",
      finishedAt: now,
      heartbeatAt: now,
    });
    return "blocked";
  }
}

/** A manual retry can recover only its own expired delivery. */
export const reapExpiredQueuedForRun = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), now: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "targeted route qualification benchmark recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) throw new Error("route qualification benchmark queue recovery time is invalid");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    const deadline = run.routeQualificationBenchmarkDispatchQueueDeadlineAt;
    if (run.routeQualificationBenchmarkDispatchState !== "queued" || !Number.isSafeInteger(deadline) || deadline! > args.now) {
      return { state: "unchanged" as const };
    }
    return { state: await recoverExpiredQueued(ctx, run, args.now) };
  },
});

export const reapExpiredQueued = mutation({
  args: { ownerId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "route qualification benchmark queued dispatch recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("route qualification benchmark queue recovery time is invalid");
    }
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_route_qualification_benchmark_dispatch_deadline", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("routeQualificationBenchmarkDispatchState", "queued")
        .gt("routeQualificationBenchmarkDispatchQueueDeadlineAt", undefined)
        .lte("routeQualificationBenchmarkDispatchQueueDeadlineAt", args.now))
      .take(limit(args.limit));
    let requeued = 0;
    let blocked = 0;
    for (const run of rows) {
      const state = await recoverExpiredQueued(ctx, run, args.now);
      if (state === "requeued") requeued++;
      else blocked++;
    }
    return { checked: rows.length, requeued, blocked };
  },
});
