import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION,
  admitReviewedDataStoryInitialRun,
  reviewedDataStoryInitialRunAdmissionFingerprint,
  reviewedDataStoryInitialDispatchEnvelope,
  type ReviewedDataStoryInitialRunAdmission,
} from "../src/engine/reviewedDataStoryInitialRunAdmission";
import { RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";

const MAX_INITIAL_DISPATCH_ATTEMPTS = 2;
const INITIAL_DISPATCH_QUEUE_LEASE_MS = RUN_QUEUE_LEASE_MS;
const SHA256 = /^[a-f0-9]{64}$/;

type DataStoryRun = Doc<"runs">;

export interface ReviewedDataStoryInitialAdmissionLease {
  readonly admissionFingerprint: string;
}

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
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("reviewed data-story dispatch time is invalid");
  return now + INITIAL_DISPATCH_QUEUE_LEASE_MS;
}

function initialAdmission(run: DataStoryRun): ReviewedDataStoryInitialRunAdmission {
  const value = run.reviewedDataStoryInitialAdmission;
  if (!value || value.version !== REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION) {
    throw new Error("reviewed data-story run is missing its immutable initial admission");
  }
  const normalized: ReviewedDataStoryInitialRunAdmission = {
    version: REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION,
    ownerId: required(value.ownerId, "reviewed data-story admission owner id"),
    channelId: required(value.channelId, "reviewed data-story admission channel id"),
    selector: {
      packId: required(String(value.selector.packId), "reviewed data-story admission pack id"),
      contentFingerprint: fingerprint(value.selector.contentFingerprint, "reviewed data-story admission content fingerprint"),
    },
    routeSeedFingerprint: fingerprint(value.routeSeedFingerprint, "reviewed data-story admission route fingerprint"),
    showProfileFingerprint: fingerprint(value.showProfileFingerprint, "reviewed data-story admission Show Profile fingerprint"),
    pipelineFingerprint: fingerprint(value.pipelineFingerprint, "reviewed data-story admission pipeline fingerprint"),
    topicFingerprint: fingerprint(value.topicFingerprint, "reviewed data-story admission topic fingerprint"),
    selectedCapabilityKeys: [...value.selectedCapabilityKeys].sort(),
    admissionFingerprint: fingerprint(value.admissionFingerprint, "reviewed data-story admission fingerprint"),
  };
  if (run.reviewedDataStoryInitialAdmissionFingerprint !== normalized.admissionFingerprint) {
    throw new Error("reviewed data-story admission fingerprint does not match its indexed run receipt");
  }
  if (
    reviewedDataStoryInitialRunAdmissionFingerprint({
      version: normalized.version,
      ownerId: normalized.ownerId,
      channelId: normalized.channelId,
      selector: normalized.selector,
      routeSeedFingerprint: normalized.routeSeedFingerprint,
      showProfileFingerprint: normalized.showProfileFingerprint,
      pipelineFingerprint: normalized.pipelineFingerprint,
      topicFingerprint: normalized.topicFingerprint,
      selectedCapabilityKeys: normalized.selectedCapabilityKeys,
    }) !== normalized.admissionFingerprint
  ) {
    throw new Error("reviewed data-story admission fingerprint does not bind its stored immutable fields");
  }
  return normalized;
}

function ownedRun(
  run: DataStoryRun | null,
  args: { readonly ownerId: string; readonly channelId: Id<"channels">; readonly runId: Id<"runs"> },
): DataStoryRun {
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId || run._id !== args.runId) {
    throw new Error("reviewed data-story run ownership/channel mismatch");
  }
  return run;
}

function sameAdmission(
  left: ReviewedDataStoryInitialRunAdmission,
  right: ReviewedDataStoryInitialRunAdmission,
): boolean {
  return left.admissionFingerprint === right.admissionFingerprint &&
    left.ownerId === right.ownerId &&
    left.channelId === right.channelId &&
    left.selector.packId === right.selector.packId &&
    left.selector.contentFingerprint === right.selector.contentFingerprint &&
    left.routeSeedFingerprint === right.routeSeedFingerprint &&
    left.showProfileFingerprint === right.showProfileFingerprint &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.topicFingerprint === right.topicFingerprint &&
    left.selectedCapabilityKeys.join("\u0000") === right.selectedCapabilityKeys.join("\u0000");
}

export function assertReviewedDataStoryInitialAdmissionLease(
  run: DataStoryRun,
  input: unknown,
): ReviewedDataStoryInitialRunAdmission {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("reviewed data-story initial admission lease is missing");
  }
  const record = input as Record<string, unknown>;
  const admissionFingerprint = fingerprint(
    record["admissionFingerprint"],
    "reviewed data-story initial admission lease fingerprint",
  );
  const admission = initialAdmission(run);
  if (admission.admissionFingerprint !== admissionFingerprint) {
    throw new Error("reviewed data-story initial admission lease does not match the stored receipt");
  }
  if (run.status !== "awaiting_reviewed_evidence_dispatch") {
    throw new Error("reviewed data-story initial admission is not awaiting its dedicated dispatch");
  }
  if (run.reviewedDataStoryInitialDispatchState !== "pending" && run.reviewedDataStoryInitialDispatchState !== "queued") {
    throw new Error("reviewed data-story initial admission dispatch is not claimable");
  }
  return admission;
}

export const admit = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    packId: v.id("reviewedEvidencePacks"),
    now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed data-story initial-run admission");
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("reviewed data-story initial admission time is invalid");
    const [channel, pack] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.packId)]);
    if (!channel || channel.ownerId !== args.ownerId) throw new Error("reviewed data-story channel is not owned by this operator");
    if (!pack || pack.ownerId !== args.ownerId) throw new Error("reviewed data-story pack is not owned by this operator");
    const admitted = admitReviewedDataStoryInitialRun({
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      identity: channel.identity,
      contentLane: channel.contentLane,
      family: channel.family,
      pipeline: channel.pipeline,
      selector: { packId: String(args.packId), contentFingerprint: pack.contentFingerprint },
      record: {
        _id: String(pack._id),
        ownerId: pack.ownerId,
        contentFingerprint: pack.contentFingerprint,
        pack: pack.pack,
      },
      now,
    });
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_owner_channel_reviewed_data_story_admission", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("channelId", args.channelId)
        .eq("reviewedDataStoryInitialAdmissionFingerprint", admitted.admission.admissionFingerprint),
      )
      .unique();
    if (existing) {
      const prior = initialAdmission(existing);
      if (!sameAdmission(prior, admitted.admission)) {
        throw new Error("reviewed data-story initial admission replay does not match its immutable receipt");
      }
      return {
        state: "reused" as const,
        runId: existing._id,
        ...reviewedDataStoryInitialDispatchEnvelope(prior),
      };
    }
    const runId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: "awaiting_reviewed_evidence_dispatch",
      startedAt: now,
      heartbeatAt: now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: now,
      reviewedDataStoryInitialDispatchState: "pending",
      reviewedDataStoryInitialAdmission: {
        ...admitted.admission,
        selector: { packId: args.packId, contentFingerprint: admitted.admission.selector.contentFingerprint },
        selectedCapabilityKeys: [...admitted.admission.selectedCapabilityKeys],
      },
      reviewedDataStoryInitialAdmissionFingerprint: admitted.admission.admissionFingerprint,
      reviewedDataStoryInitialDispatchAttempts: 0,
    });
    return {
      state: "created" as const,
      runId,
      ...reviewedDataStoryInitialDispatchEnvelope(admitted.admission),
    };
  },
});

export const listPending = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed data-story initial dispatch recovery");
    const pendingRows = await ctx.db
      .query("runs")
      .withIndex("by_owner_reviewed_data_story_initial_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("reviewedDataStoryInitialDispatchState", "pending"),
      )
      .take(limit(args.limit) * 2);
    const pending: Array<{
      runId: Id<"runs">;
      channelId: Id<"channels">;
      selector: { packId: Id<"reviewedEvidencePacks">; contentFingerprint: string };
      admissionFingerprint: string;
      attempt: number;
    }> = [];
    for (const run of pendingRows) {
      if (run.status !== "awaiting_reviewed_evidence_dispatch") continue;
      try {
        const admission = initialAdmission(run);
        const attempt = run.reviewedDataStoryInitialDispatchAttempts ?? 0;
        if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= MAX_INITIAL_DISPATCH_ATTEMPTS) continue;
        pending.push({
          runId: run._id,
          channelId: run.channelId,
          selector: {
            packId: admission.selector.packId as Id<"reviewedEvidencePacks">,
            contentFingerprint: admission.selector.contentFingerprint,
          },
          admissionFingerprint: admission.admissionFingerprint,
          attempt,
        });
      } catch {
        // A malformed row cannot be dispatched. The reaper/next deliberate
        // operator action will surface it as manual-required instead.
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
    admissionFingerprint: v.string(),
    triggerRunId: v.string(),
    queuedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed data-story initial dispatch acknowledgement");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    const admission = initialAdmission(run);
    if (admission.admissionFingerprint !== fingerprint(args.admissionFingerprint, "reviewed data-story acknowledgement fingerprint")) {
      throw new Error("reviewed data-story acknowledgement does not match its immutable admission");
    }
    if (!Number.isSafeInteger(args.queuedAt) || args.queuedAt < 0 || !args.triggerRunId.trim()) {
      throw new Error("reviewed data-story dispatch acknowledgement is invalid");
    }
    if (run.reviewedDataStoryInitialDispatchState === "consumed") return { state: "consumed" as const };
    if (run.reviewedDataStoryInitialDispatchState !== "pending") {
      throw new Error("reviewed data-story initial dispatch acknowledgement is stale");
    }
    const attempts = (run.reviewedDataStoryInitialDispatchAttempts ?? 0) + 1;
    await ctx.db.patch(run._id, {
      reviewedDataStoryInitialDispatchState: "queued",
      reviewedDataStoryInitialDispatchAttempts: attempts,
      reviewedDataStoryInitialDispatchQueuedAt: args.queuedAt,
      reviewedDataStoryInitialDispatchQueueDeadlineAt: queueDeadline(args.queuedAt),
      reviewedDataStoryInitialDispatchTriggerRunId: args.triggerRunId.slice(0, 500),
      reviewedDataStoryInitialDispatchLastError: undefined,
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
    admissionFingerprint: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed data-story initial dispatch failure");
    const run = ownedRun(await ctx.db.get(args.runId), args);
    const admission = initialAdmission(run);
    if (admission.admissionFingerprint !== fingerprint(args.admissionFingerprint, "reviewed data-story failure fingerprint")) {
      throw new Error("reviewed data-story dispatch failure does not match its immutable admission");
    }
    if (!Number.isSafeInteger(args.failedAt) || args.failedAt < 0) throw new Error("reviewed data-story dispatch failure time is invalid");
    if (run.reviewedDataStoryInitialDispatchState !== "pending") return { state: "unchanged" as const };
    const attempts = (run.reviewedDataStoryInitialDispatchAttempts ?? 0) + 1;
    const error = args.error.trim().slice(0, 1_000) || "reviewed data-story initial dispatch failed";
    if (attempts >= MAX_INITIAL_DISPATCH_ATTEMPTS) {
      await ctx.db.patch(run._id, {
        status: "reviewed_data_story_admission_blocked",
        reviewedDataStoryInitialDispatchState: "blocked",
        reviewedDataStoryInitialDispatchAttempts: attempts,
        reviewedDataStoryInitialDispatchLastError: error,
        error: `reviewed data-story initial dispatch exhausted its bounded delivery attempts: ${error}`,
        finishedAt: args.failedAt,
        heartbeatAt: args.failedAt,
      });
      return { state: "blocked" as const, attempts };
    }
    await ctx.db.patch(run._id, {
      reviewedDataStoryInitialDispatchAttempts: attempts,
      reviewedDataStoryInitialDispatchLastError: error,
      heartbeatAt: args.failedAt,
    });
    return { state: "pending" as const, attempts };
  },
});

export const reapExpiredQueued = mutation({
  args: { ownerId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed data-story queued dispatch recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) throw new Error("reviewed data-story queue recovery time is invalid");
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_reviewed_data_story_initial_dispatch_deadline", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("reviewedDataStoryInitialDispatchState", "queued")
        .gt("reviewedDataStoryInitialDispatchQueueDeadlineAt", undefined)
        .lte("reviewedDataStoryInitialDispatchQueueDeadlineAt", args.now),
      )
      .take(limit(args.limit));
    let requeued = 0;
    let blocked = 0;
    for (const run of rows) {
      try {
        initialAdmission(run);
        const attempts = run.reviewedDataStoryInitialDispatchAttempts;
        if (
          run.status !== "awaiting_reviewed_evidence_dispatch" ||
          !Number.isSafeInteger(attempts) ||
          (attempts ?? 0) < 1 ||
          (attempts ?? 0) >= MAX_INITIAL_DISPATCH_ATTEMPTS
        ) {
          throw new Error("queued dispatch receipt is invalid or exhausted");
        }
        await ctx.db.patch(run._id, {
          reviewedDataStoryInitialDispatchState: "pending",
          reviewedDataStoryInitialDispatchQueuedAt: undefined,
          reviewedDataStoryInitialDispatchQueueDeadlineAt: undefined,
          reviewedDataStoryInitialDispatchTriggerRunId: undefined,
          reviewedDataStoryInitialDispatchLastError:
            "accepted Trigger delivery expired before the reviewed data-story execution claim; reissuing exact immutable admission",
          heartbeatAt: args.now,
        });
        requeued++;
      } catch (error) {
        await ctx.db.patch(run._id, {
          status: "reviewed_data_story_admission_blocked",
          reviewedDataStoryInitialDispatchState: "blocked",
          reviewedDataStoryInitialDispatchQueueDeadlineAt: undefined,
          reviewedDataStoryInitialDispatchLastError:
            error instanceof Error ? error.message.slice(0, 1_000) : "reviewed data-story queue recovery failed",
          error: "reviewed data-story initial dispatch is corrupt or exhausted; manual reconciliation is required",
          finishedAt: args.now,
          heartbeatAt: args.now,
        });
        blocked++;
      }
    }
    return { checked: rows.length, requeued, blocked };
  },
});
