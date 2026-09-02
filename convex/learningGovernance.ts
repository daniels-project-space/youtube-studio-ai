import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { patchChannelRespectingLock } from "./channelLock";
import { stableJson } from "../src/lib/publishingPolicy";
import {
  SHOW_BIBLE_MAX_PRE_PROVIDER_ATTEMPTS,
  SHOW_BIBLE_OWNER_DAILY_MAX_TOKENS,
  SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP,
  SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS,
} from "../src/lib/learningRefreshCheckpoint";

const SHOW_BIBLE_CLAIM_PROTOCOL_VERSION = "show-bible-claim/v2";
const MAX_SHOW_BIBLE_OPERATOR_REARMS = 2;

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("learningGovernance: invalid internal secret");
  }
}

const offlineEvaluationValidator = v.object({
  method: v.string(),
  sampleSize: v.number(),
  baselineScore: v.optional(v.number()),
  candidateScore: v.optional(v.number()),
  passed: v.boolean(),
  notes: v.string(),
});

const showBibleRequestValidator = v.object({
  role: v.literal("showrunner"),
  system: v.string(),
  prompt: v.string(),
  maxTokens: v.number(),
});

async function exactShowBibleClaim(
  ctx: Pick<QueryCtx, "db">,
  ownerId: string,
  recommendationKey: string,
) {
  return await ctx.db
    .query("showBibleProposalClaims")
    .withIndex("by_owner_key", (q) =>
      q.eq("ownerId", ownerId).eq("recommendationKey", recommendationKey),
    )
    .unique();
}

async function assertShowBibleBinding(
  ctx: Pick<QueryCtx, "db">,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
    basePolicyVersion: number;
    recommendationKey: string;
  },
) {
  if (!Number.isSafeInteger(args.basePolicyVersion) || args.basePolicyVersion < 0) {
    throw new Error("show bible claim base policy version is invalid");
  }
  if (
    args.recommendationKey !==
      `show-bible:${String(args.channelId)}:v${args.basePolicyVersion + 1}`
  ) {
    throw new Error("show bible claim recommendation key does not bind the requested version");
  }
  const [channel, connector] = await Promise.all([
    ctx.db.get(args.channelId),
    ctx.db.get(args.connectorId),
  ]);
  if (!channel || channel.ownerId !== args.ownerId) {
    throw new Error("show bible claim channel owner mismatch");
  }
  if (
    !connector ||
    connector.ownerId !== args.ownerId ||
    connector.channelId !== args.channelId ||
    (connector.tokenVersion ?? 1) !== args.connectorVersion ||
    (connector.status ?? "active") !== "active"
  ) {
    throw new Error("show bible claim connector provenance mismatch");
  }
  return { channel, connector };
}

function assertExistingShowBibleClaimBinding(
  claim: {
    channelId: Id<"channels">;
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
    basePolicyVersion: number;
    proposedPolicyVersion: number;
  },
  args: {
    channelId: Id<"channels">;
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
    basePolicyVersion: number;
  },
): void {
  if (
    claim.channelId !== args.channelId ||
    claim.connectorId !== args.connectorId ||
    claim.connectorVersion !== args.connectorVersion ||
    claim.basePolicyVersion !== args.basePolicyVersion ||
    claim.proposedPolicyVersion !== args.basePolicyVersion + 1
  ) {
    throw new Error("show bible claim immutable binding conflict");
  }
}

function assertShowBibleAdmissionArgs(args: {
  admissionDay: string;
  fairnessKey: string;
  request: { maxTokens: number };
  now: number;
}): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.admissionDay)) {
    throw new Error("show bible admission day must be a UTC YYYY-MM-DD value");
  }
  if (!args.fairnessKey.trim() || args.fairnessKey.length > 300) {
    throw new Error("show bible admission fairness key is invalid");
  }
  if (new Date(args.now).toISOString().slice(0, 10) !== args.admissionDay) {
    throw new Error("show bible admission day must match the claim timestamp");
  }
  if (args.request.maxTokens > SHOW_BIBLE_OWNER_DAILY_MAX_TOKENS) {
    throw new Error("show bible request exceeds the daily owner token envelope");
  }
}

async function reserveShowBibleOwnerAdmission(
  ctx: Pick<MutationCtx, "db">,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    recommendationKey: string;
    admissionDay: string;
    fairnessKey: string;
    request: { maxTokens: number };
    now: number;
  },
): Promise<Id<"showBibleGenerationAdmissions"> | null> {
  // This is deliberately capped at one more than the permitted call count.
  // Under this mutation's atomic admission invariant that is enough to prove
  // a full owner envelope without turning a daily safety check into an
  // unbounded table scan.
  const admissions = await ctx.db
    .query("showBibleGenerationAdmissions")
    .withIndex("by_owner_day", (q) =>
      q.eq("ownerId", args.ownerId).eq("day", args.admissionDay),
    )
    .take(SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP + 1);
  const reservedTokens = admissions.reduce(
    (sum, admission) => sum + admission.reservedMaxTokens,
    0,
  );
  if (
    admissions.length >= SHOW_BIBLE_OWNER_DAILY_MODEL_CALL_CAP ||
    reservedTokens + args.request.maxTokens > SHOW_BIBLE_OWNER_DAILY_MAX_TOKENS
  ) {
    return null;
  }
  const admissionId = await ctx.db.insert("showBibleGenerationAdmissions", {
    ownerId: args.ownerId,
    day: args.admissionDay,
    channelId: args.channelId,
    recommendationKey: args.recommendationKey,
    fairnessKey: args.fairnessKey,
    reservedMaxTokens: args.request.maxTokens,
    status: "reserved",
    createdAt: args.now,
    updatedAt: args.now,
  });
  const ownerState = await ctx.db
    .query("showBibleOwnerAdmissionState")
    .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
    .unique();
  if (ownerState) {
    await ctx.db.patch(ownerState._id, {
      roundRobinCursor: args.fairnessKey,
      updatedAt: args.now,
    });
  } else {
    await ctx.db.insert("showBibleOwnerAdmissionState", {
      ownerId: args.ownerId,
      roundRobinCursor: args.fairnessKey,
      updatedAt: args.now,
    });
  }
  return admissionId;
}

async function updateShowBibleAdmissionStatus(
  ctx: Pick<MutationCtx, "db">,
  admissionId: Id<"showBibleGenerationAdmissions"> | undefined,
  ownerId: string,
  status:
    | "reserved"
    | "provider_started"
    | "provider_dispatch_started"
    | "finalized"
    | "manual_reconciliation_required"
    | "pre_provider_exhausted"
    | "operator_rearmed",
  now: number,
): Promise<void> {
  if (!admissionId) return;
  const admission = await ctx.db.get(admissionId);
  if (!admission || admission.ownerId !== ownerId) {
    throw new Error("show bible owner admission receipt is missing or owner-bound elsewhere");
  }
  await ctx.db.patch(admission._id, { status, updatedAt: now });
}

/**
 * A reservation only authorizes a paid provider boundary on its own UTC day.
 * A short pre-provider lease may cross midnight, so the boundary rechecks the
 * owner envelope instead of letting yesterday's unused reservation bypass
 * today's cap.
 */
async function ensureCurrentShowBibleAdmission(
  ctx: Pick<MutationCtx, "db">,
  claim: {
    ownerId: string;
    channelId: Id<"channels">;
    recommendationKey: string;
    request: { maxTokens: number };
    fairnessKey?: string;
    ownerAdmissionId?: Id<"showBibleGenerationAdmissions">;
  },
  now: number,
): Promise<Id<"showBibleGenerationAdmissions"> | null> {
  const day = new Date(now).toISOString().slice(0, 10);
  if (claim.ownerAdmissionId) {
    const admission = await ctx.db.get(claim.ownerAdmissionId);
    if (admission?.ownerId === claim.ownerId && admission.day === day) {
      return admission._id;
    }
  }
  return await reserveShowBibleOwnerAdmission(ctx, {
    ownerId: claim.ownerId,
    channelId: claim.channelId,
    recommendationKey: claim.recommendationKey,
    admissionDay: day,
    fairnessKey: claim.fairnessKey ?? String(claim.channelId),
    request: claim.request,
    now,
  });
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
    void _secret;
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

/**
 * Owner-bound operational visibility for immutable Show Bible claim state.
 * We intentionally return audit/status metadata, never the stored model
 * prompt or claim token.
 */
export const listShowBibleClaims = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const limit = args.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("show bible claim list limit must be between 1 and 100");
    }
    const claims = await ctx.db
      .query("showBibleProposalClaims")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
    return claims.map((claim) => ({
      claimId: claim._id,
      channelId: claim.channelId,
      recommendationKey: claim.recommendationKey,
      basePolicyVersion: claim.basePolicyVersion,
      proposedPolicyVersion: claim.proposedPolicyVersion,
      status: claim.status,
      claimProtocolVersion: claim.claimProtocolVersion,
      fairnessKey: claim.fairnessKey,
      ownerAdmissionId: claim.ownerAdmissionId,
      providerStartedAt: claim.providerStartedAt,
      providerDispatchStartedAt: claim.providerDispatchStartedAt,
      ambiguousAt: claim.ambiguousAt,
      deferredAt: claim.deferredAt,
      deferredAdmissionDay: claim.deferredAdmissionDay,
      deferredReason: claim.deferredReason,
      preProviderAttempts: claim.preProviderAttempts,
      operatorResolutionAudit: claim.operatorResolutionAudit ?? [],
      operatorResolutionCount: claim.operatorResolutionCount ?? 0,
      lastError: claim.lastError,
      recommendationId: claim.recommendationId,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      rearmAllowed:
        claim.status === "provider_started" &&
        claim.claimProtocolVersion === SHOW_BIBLE_CLAIM_PROTOCOL_VERSION &&
        claim.providerDispatchStartedAt === undefined &&
        claim.ambiguousAt === undefined &&
        claim.recommendationId === undefined &&
        (claim.operatorResolutionCount ?? 0) < MAX_SHOW_BIBLE_OPERATOR_REARMS,
    }));
  },
});

/** Return the persisted cursor used to rotate daily owner admission order. */
export const getShowBibleOwnerAdmissionState = query({
  args: { secret: v.string(), ownerId: v.string() },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    return await ctx.db
      .query("showBibleOwnerAdmissionState")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
  },
});

/**
 * Atomically reserve the immutable Show Bible version before the model call.
 * A duplicate schedule/manual invocation can only observe the same claim; it
 * never gets a second permission to dispatch the showrunner.
 */
export const claimShowBibleProposal = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    recommendationKey: v.string(),
    basePolicyVersion: v.number(),
    request: showBibleRequestValidator,
    baseBrief: v.any(),
    sourceVideoIds: v.array(v.string()),
    dataWindowStart: v.string(),
    dataWindowEnd: v.string(),
    offlineEvaluation: offlineEvaluationValidator,
    admissionDay: v.string(),
    fairnessKey: v.string(),
    claimToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!args.claimToken.trim()) throw new Error("show bible claim token is required");
    if (!Number.isFinite(args.now) || args.now < 0) {
      throw new Error("show bible claim time is invalid");
    }
    if (
      !Number.isSafeInteger(args.request.maxTokens) ||
      args.request.maxTokens < 1 ||
      args.request.maxTokens > 4_000 ||
      !args.request.system.trim() ||
      !args.request.prompt.trim()
    ) {
      throw new Error("show bible claim request is invalid");
    }
    assertShowBibleAdmissionArgs(args);
    if (args.sourceVideoIds.length > 300 || new Set(args.sourceVideoIds).size !== args.sourceVideoIds.length) {
      throw new Error("show bible claim source videos must be a unique bounded set");
    }
    const { channel } = await assertShowBibleBinding(ctx, args);
    if ((channel.learningPolicyVersion ?? 0) !== args.basePolicyVersion) {
      return {
        action: "blocked_policy_changed" as const,
        currentPolicyVersion: channel.learningPolicyVersion ?? 0,
      };
    }
    const existingRecommendation = await ctx.db
      .query("learningRecommendations")
      .withIndex("by_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("recommendationKey", args.recommendationKey),
      )
      .unique();
    // Any already-materialized version is immutable, including a rejected one:
    // resynthesizing it would silently create a competing policy proposal.
    if (existingRecommendation) {
      return {
        action: "blocked_existing_recommendation" as const,
        recommendationId: existingRecommendation._id,
        status: existingRecommendation.status,
      };
    }

    const existing = await exactShowBibleClaim(ctx, args.ownerId, args.recommendationKey);
    if (existing) {
      assertExistingShowBibleClaimBinding(existing, args);
      if (existing.fairnessKey && existing.fairnessKey !== args.fairnessKey) {
        throw new Error("show bible claim fairness binding conflict");
      }
      if (existing.status === "deferred_owner_budget") {
        const deferredDay = existing.deferredAdmissionDay ?? (existing.deferredAt === undefined
          ? undefined
          : new Date(existing.deferredAt).toISOString().slice(0, 10));
        if (deferredDay === args.admissionDay) {
          return {
            action: "deferred_owner_budget" as const,
            reason: existing.deferredReason ?? "daily owner Show Bible envelope is exhausted",
            claim: existing,
          };
        }
        const admissionId = await reserveShowBibleOwnerAdmission(ctx, args);
        if (!admissionId) {
          await ctx.db.patch(existing._id, {
            deferredAt: args.now,
            deferredAdmissionDay: args.admissionDay,
            deferredReason: "daily owner Show Bible envelope is exhausted",
            updatedAt: args.now,
          });
          return {
            action: "deferred_owner_budget" as const,
            reason: "daily owner Show Bible envelope is exhausted",
            claim: await ctx.db.get(existing._id),
          };
        }
        await ctx.db.patch(existing._id, {
          status: "claimed",
          claimToken: args.claimToken,
          claimProtocolVersion: SHOW_BIBLE_CLAIM_PROTOCOL_VERSION,
          fairnessKey: args.fairnessKey,
          ownerAdmissionId: admissionId,
          preProviderAttempts: 1,
          claimExpiresAt: args.now + SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS,
          deferredAt: undefined,
          deferredAdmissionDay: undefined,
          deferredReason: undefined,
          lastError: undefined,
          updatedAt: args.now,
        });
        return { action: "generate" as const, claim: await ctx.db.get(existing._id) };
      }
      if (existing.status === "claimed") {
        if ((existing.claimExpiresAt ?? 0) > args.now) {
          return { action: "blocked_pre_provider_claim" as const, claim: existing };
        }
        if (existing.preProviderAttempts >= SHOW_BIBLE_MAX_PRE_PROVIDER_ATTEMPTS) {
          await ctx.db.patch(existing._id, {
            status: "pre_provider_exhausted",
            claimExpiresAt: undefined,
            lastError: "pre-provider Show Bible claim recovery attempts exhausted; manual reconciliation required",
            updatedAt: args.now,
          });
          await updateShowBibleAdmissionStatus(
            ctx,
            existing.ownerAdmissionId,
            args.ownerId,
            "pre_provider_exhausted",
            args.now,
          );
          return { action: "manual_reconciliation_required" as const };
        }
        await ctx.db.patch(existing._id, {
          claimToken: args.claimToken,
          preProviderAttempts: existing.preProviderAttempts + 1,
          claimExpiresAt: args.now + SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS,
          updatedAt: args.now,
          lastError: undefined,
        });
        return {
          action: "generate" as const,
          claim: await ctx.db.get(existing._id),
        };
      }
      if (
        existing.status === "provider_started" ||
        existing.status === "provider_dispatch_started" ||
        existing.status === "ambiguous"
      ) {
        return {
          action: "manual_reconciliation_required" as const,
          reason: existing.status === "provider_started"
            ? "Show Bible provider start is unresolved; an owner must explicitly attest no dispatch before any retry"
            : "Show Bible model boundary already crossed; outcome must be reconciled without replay",
          claim: existing,
        };
      }
      if (existing.status === "pre_provider_exhausted") {
        return { action: "manual_reconciliation_required" as const, claim: existing };
      }
      return { action: "blocked_finalized_claim" as const, claim: existing };
    }

    const admissionId = await reserveShowBibleOwnerAdmission(ctx, args);
    if (!admissionId) {
      const claimId = await ctx.db.insert("showBibleProposalClaims", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        connectorId: args.connectorId,
        connectorVersion: args.connectorVersion,
        recommendationKey: args.recommendationKey,
        basePolicyVersion: args.basePolicyVersion,
        proposedPolicyVersion: args.basePolicyVersion + 1,
        request: args.request,
        baseBrief: args.baseBrief,
        sourceVideoIds: args.sourceVideoIds,
        dataWindowStart: args.dataWindowStart,
        dataWindowEnd: args.dataWindowEnd,
        offlineEvaluation: args.offlineEvaluation,
        status: "deferred_owner_budget",
        claimToken: args.claimToken,
        claimProtocolVersion: SHOW_BIBLE_CLAIM_PROTOCOL_VERSION,
        fairnessKey: args.fairnessKey,
        preProviderAttempts: 0,
        deferredAt: args.now,
        deferredAdmissionDay: args.admissionDay,
        deferredReason: "daily owner Show Bible envelope is exhausted",
        createdAt: args.now,
        updatedAt: args.now,
      });
      return {
        action: "deferred_owner_budget" as const,
        reason: "daily owner Show Bible envelope is exhausted",
        claim: await ctx.db.get(claimId),
      };
    }

    const claimId = await ctx.db.insert("showBibleProposalClaims", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      recommendationKey: args.recommendationKey,
      basePolicyVersion: args.basePolicyVersion,
      proposedPolicyVersion: args.basePolicyVersion + 1,
      request: args.request,
      baseBrief: args.baseBrief,
      sourceVideoIds: args.sourceVideoIds,
      dataWindowStart: args.dataWindowStart,
      dataWindowEnd: args.dataWindowEnd,
      offlineEvaluation: args.offlineEvaluation,
      status: "claimed",
      claimToken: args.claimToken,
      claimProtocolVersion: SHOW_BIBLE_CLAIM_PROTOCOL_VERSION,
      fairnessKey: args.fairnessKey,
      ownerAdmissionId: admissionId,
      preProviderAttempts: 1,
      claimExpiresAt: args.now + SHOW_BIBLE_PRE_PROVIDER_CLAIM_LEASE_MS,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { action: "generate" as const, claim: await ctx.db.get(claimId) };
  },
});

/**
 * The provider marker is intentionally not idempotent-success.  A caller that
 * loses the response must stop rather than infer it may safely dispatch again.
 */
export const markShowBibleProviderStarted = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    recommendationKey: v.string(),
    claimToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("show bible provider start time is invalid");
    const claim = await exactShowBibleClaim(ctx, args.ownerId, args.recommendationKey);
    if (!claim || claim.channelId !== args.channelId) {
      throw new Error("show bible provider claim is missing or channel-bound elsewhere");
    }
    if (claim.status !== "claimed") return { started: false as const, status: claim.status };
    if (claim.claimToken !== args.claimToken || (claim.claimExpiresAt ?? 0) < args.now) {
      return { started: false as const, status: "claim_not_owned" as const };
    }
    const { channel } = await assertShowBibleBinding(ctx, {
      ownerId: args.ownerId,
      channelId: claim.channelId,
      connectorId: claim.connectorId,
      connectorVersion: claim.connectorVersion,
      basePolicyVersion: claim.basePolicyVersion,
      recommendationKey: claim.recommendationKey,
    });
    if ((channel.learningPolicyVersion ?? 0) !== claim.basePolicyVersion) {
      return { started: false as const, status: "policy_changed" as const };
    }
    const admissionId = await ensureCurrentShowBibleAdmission(ctx, claim, args.now);
    if (!admissionId) {
      // This remains strictly pre-provider: no dispatch marker was written, so
      // a future fair daily turn may retry after the owner envelope resets.
      await ctx.db.patch(claim._id, {
        status: "deferred_owner_budget",
        claimExpiresAt: undefined,
        deferredAt: args.now,
        deferredAdmissionDay: new Date(args.now).toISOString().slice(0, 10),
        deferredReason: "daily owner Show Bible envelope is exhausted before provider dispatch",
        updatedAt: args.now,
      });
      return { started: false as const, status: "deferred_owner_budget" as const };
    }
    await ctx.db.patch(claim._id, {
      status: "provider_started",
      // No expiration after this write.  This is the deliberately visible
      // no-dispatch crash window: only an authenticated owner attestation can
      // rearm it, and only while no dispatch marker exists.
      claimExpiresAt: undefined,
      ownerAdmissionId: admissionId,
      providerStartedAt: args.now,
      updatedAt: args.now,
    });
    await updateShowBibleAdmissionStatus(
      ctx,
      admissionId,
      args.ownerId,
      "provider_started",
      args.now,
    );
    return { started: true as const };
  },
});

/**
 * Persist the exact point at which the model request is allowed to leave this
 * process.  A caller must fail closed if its acknowledgement is uncertain.
 */
export const markShowBibleProviderDispatchStarted = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    recommendationKey: v.string(),
    claimToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!Number.isFinite(args.now) || args.now < 0) {
      throw new Error("show bible provider dispatch time is invalid");
    }
    const claim = await exactShowBibleClaim(ctx, args.ownerId, args.recommendationKey);
    if (!claim || claim.channelId !== args.channelId) {
      throw new Error("show bible provider dispatch claim is missing or channel-bound elsewhere");
    }
    if (
      claim.status !== "provider_started" ||
      claim.claimProtocolVersion !== SHOW_BIBLE_CLAIM_PROTOCOL_VERSION ||
      claim.claimToken !== args.claimToken ||
      claim.providerDispatchStartedAt !== undefined
    ) {
      return { started: false as const, status: claim.status };
    }
    // Provider-start may be separated from the actual paid dispatch by a
    // process pause. Rebind the immutable channel/connector/policy version at
    // this exact boundary so a newly activated policy cannot bill a stale
    // Show Bible proposal whose finalization would be rejected afterward.
    const { channel } = await assertShowBibleBinding(ctx, {
      ownerId: args.ownerId,
      channelId: claim.channelId,
      connectorId: claim.connectorId,
      connectorVersion: claim.connectorVersion,
      basePolicyVersion: claim.basePolicyVersion,
      recommendationKey: claim.recommendationKey,
    });
    if ((channel.learningPolicyVersion ?? 0) !== claim.basePolicyVersion) {
      await ctx.db.patch(claim._id, {
        lastError: "learning policy changed before Show Bible provider dispatch; no model request was sent",
        updatedAt: args.now,
      });
      return { started: false as const, status: "policy_changed" as const };
    }
    // The provider-start marker may have been written just before midnight.
    // Revalidate the *actual* paid dispatch against the current UTC-day
    // envelope; a stale-day reservation is never permission to bill today.
    const admissionId = await ensureCurrentShowBibleAdmission(ctx, claim, args.now);
    if (!admissionId) {
      // This mutation itself has not crossed the provider boundary, so the
      // claim can safely wait for a future fair admission without weakening
      // the no-replay guarantee for any dispatch-marked/ambiguous claim.
      await ctx.db.patch(claim._id, {
        status: "deferred_owner_budget",
        claimExpiresAt: undefined,
        deferredAt: args.now,
        deferredAdmissionDay: new Date(args.now).toISOString().slice(0, 10),
        deferredReason: "daily owner Show Bible envelope is exhausted before provider dispatch",
        updatedAt: args.now,
      });
      return { started: false as const, status: "deferred_owner_budget" as const };
    }
    await ctx.db.patch(claim._id, {
      status: "provider_dispatch_started",
      ownerAdmissionId: admissionId,
      providerDispatchStartedAt: args.now,
      updatedAt: args.now,
    });
    await updateShowBibleAdmissionStatus(
      ctx,
      admissionId,
      args.ownerId,
      "provider_dispatch_started",
      args.now,
    );
    return { started: true as const };
  },
});

/** Finalize the immutable recommendation and its provider claim atomically. */
export const finalizeShowBibleProposal = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    recommendationKey: v.string(),
    claimToken: v.string(),
    nextValue: v.any(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("show bible finalization time is invalid");
    const claim = await exactShowBibleClaim(ctx, args.ownerId, args.recommendationKey);
    if (!claim || claim.channelId !== args.channelId) {
      throw new Error("show bible finalization claim is missing or channel-bound elsewhere");
    }
    if (claim.status !== "provider_dispatch_started" || claim.claimToken !== args.claimToken) {
      throw new Error("show bible finalization is not authorized by the exact provider claim");
    }
    const { channel } = await assertShowBibleBinding(ctx, {
      ownerId: args.ownerId,
      channelId: claim.channelId,
      connectorId: claim.connectorId,
      connectorVersion: claim.connectorVersion,
      basePolicyVersion: claim.basePolicyVersion,
      recommendationKey: claim.recommendationKey,
    });
    if ((channel.learningPolicyVersion ?? 0) !== claim.basePolicyVersion) {
      throw new Error("show bible finalization policy changed after provider start; manual reconciliation required");
    }
    const existing = await ctx.db
      .query("learningRecommendations")
      .withIndex("by_key", (q) =>
        q.eq("ownerId", args.ownerId).eq("recommendationKey", args.recommendationKey),
      )
      .unique();
    if (existing) {
      throw new Error("show bible finalization found an immutable recommendation conflict");
    }
    const recommendationId = await ctx.db.insert("learningRecommendations", {
      ownerId: claim.ownerId,
      channelId: claim.channelId,
      connectorId: claim.connectorId,
      connectorVersion: claim.connectorVersion,
      recommendationKey: claim.recommendationKey,
      kind: "show_bible",
      target: "creative_brief",
      basePolicyVersion: claim.basePolicyVersion,
      proposedPolicyVersion: claim.proposedPolicyVersion,
      sourceVideoIds: claim.sourceVideoIds,
      dataWindowStart: claim.dataWindowStart,
      dataWindowEnd: claim.dataWindowEnd,
      proposal: {
        nextValue: args.nextValue,
        rationale: "showrunner synthesis of connector-bound historical outcomes",
      },
      offlineEvaluation: claim.offlineEvaluation,
      status: "proposed",
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.patch(claim._id, {
      status: "finalized",
      claimExpiresAt: undefined,
      recommendationId,
      updatedAt: args.now,
    });
    await updateShowBibleAdmissionStatus(
      ctx,
      claim.ownerAdmissionId,
      args.ownerId,
      "finalized",
      args.now,
    );
    return await ctx.db.get(recommendationId);
  },
});

/** Persist an uncertain post-dispatch result; later schedules must not replay it. */
export const markShowBibleProposalAmbiguous = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    recommendationKey: v.string(),
    claimToken: v.string(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("show bible ambiguity time is invalid");
    const claim = await exactShowBibleClaim(ctx, args.ownerId, args.recommendationKey);
    if (!claim || claim.channelId !== args.channelId) {
      throw new Error("show bible ambiguity claim is missing or channel-bound elsewhere");
    }
    if (claim.claimToken !== args.claimToken) {
      throw new Error("show bible ambiguity token mismatch");
    }
    if (claim.status === "ambiguous") return claim;
    if (claim.status !== "provider_dispatch_started") {
      throw new Error("show bible ambiguity requires a provider-dispatch-started claim");
    }
    await ctx.db.patch(claim._id, {
      status: "ambiguous",
      claimExpiresAt: undefined,
      ambiguousAt: args.now,
      lastError: args.error.slice(0, 1_000),
      updatedAt: args.now,
    });
    await updateShowBibleAdmissionStatus(
      ctx,
      claim.ownerAdmissionId,
      args.ownerId,
      "manual_reconciliation_required",
      args.now,
    );
    return await ctx.db.get(claim._id);
  },
});

/**
 * An owner may rearm only the narrow v2 gap after `provider_started` and
 * before `provider_dispatch_started`.  This is intentionally not a retry
 * convenience: the attestation/evidence are retained and any dispatch-marked
 * or ambiguous claim remains permanently reconciliation-only.
 */
export const resolveShowBibleProviderStartedNoDispatch = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    claimId: v.id("showBibleProposalClaims"),
    actor: v.string(),
    reason: v.string(),
    evidence: v.string(),
    verifiedNoDispatch: v.boolean(),
    attestedAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    if (
      !Number.isFinite(args.now) || args.now < 0 ||
      !Number.isFinite(args.attestedAt) || args.attestedAt < 0
    ) {
      throw new Error("show bible operator resolution time is invalid");
    }
    if (args.actor !== `session:${args.ownerId}`) {
      throw new Error("show bible provider-start resolution requires the owner session actor");
    }
    if (!args.verifiedNoDispatch) {
      throw new Error("show bible provider-start resolution requires an explicit no-dispatch attestation");
    }
    if (args.reason.trim().length < 12 || args.reason.length > 1_000) {
      throw new Error("show bible provider-start resolution requires a bounded substantive reason");
    }
    if (args.evidence.trim().length < 20 || args.evidence.length > 4_000) {
      throw new Error("show bible provider-start resolution requires bounded no-dispatch evidence");
    }
    const claim = await ctx.db.get(args.claimId);
    if (!claim || claim.ownerId !== args.ownerId) {
      throw new Error("show bible provider-start resolution is owner-bound to a different claim");
    }
    if (
      claim.status !== "provider_started" ||
      claim.claimProtocolVersion !== SHOW_BIBLE_CLAIM_PROTOCOL_VERSION ||
      claim.providerDispatchStartedAt !== undefined ||
      claim.ambiguousAt !== undefined ||
      claim.recommendationId !== undefined
    ) {
      throw new Error("show bible claim is not a proven no-dispatch provider-start gap");
    }
    const resolutionCount = claim.operatorResolutionCount ?? 0;
    if (resolutionCount >= MAX_SHOW_BIBLE_OPERATOR_REARMS) {
      throw new Error("show bible provider-start rearm limit reached; manual reconciliation remains required");
    }
    const audit = [
      ...(claim.operatorResolutionAudit ?? []),
      {
        action: "rearm_no_dispatch" as const,
        actor: args.actor,
        reason: args.reason.trim(),
        evidence: args.evidence.trim(),
        attestedAt: args.attestedAt,
        resolvedAt: args.now,
        priorClaimToken: claim.claimToken,
      },
    ].slice(-MAX_SHOW_BIBLE_OPERATOR_REARMS);
    await ctx.db.patch(claim._id, {
      status: "claimed",
      // Expired immediately. The next caller must atomically obtain a fresh
      // claim token before it can repeat the provider-start/dispatch markers.
      claimExpiresAt: args.now,
      providerStartedAt: undefined,
      lastError: "owner attested no provider dispatch and explicitly rearmed this claim",
      operatorResolutionAudit: audit,
      operatorResolutionCount: resolutionCount + 1,
      updatedAt: args.now,
    });
    await updateShowBibleAdmissionStatus(
      ctx,
      claim.ownerAdmissionId,
      args.ownerId,
      "operator_rearmed",
      args.now,
    );
    return await ctx.db.get(claim._id);
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
    // any other. A locked channel stays byte-for-byte unchanged and its
    // recommendation remains approved so the owner may explicitly unlock and
    // retry; it is never silently applied to a v2.
    let channelWrite;
    if (recommendation.target === "creative_brief") {
      if (!channel.identity || typeof proposal.nextValue !== "object") {
        throw new Error("learningGovernance.activate: invalid creative brief proposal");
      }
      channelWrite = await patchChannelRespectingLock(ctx, channel._id, {
        identity: { ...channel.identity, creativeBrief: proposal.nextValue as never },
        learningPolicyVersion: recommendation.proposedPolicyVersion,
      }, "learningGovernance.approveAndActivate creative brief");
    } else {
      if (typeof proposal.nextValue !== "object" || proposal.nextValue === null) {
        throw new Error("learningGovernance.activate: invalid script playbook proposal");
      }
      channelWrite = await patchChannelRespectingLock(ctx, channel._id, {
        scriptPlaybook: proposal.nextValue,
        learningPolicyVersion: recommendation.proposedPolicyVersion,
      }, "learningGovernance.approveAndActivate script playbook");
    }
    if (channelWrite.state === "channel_locked") {
      return { ...recommendation, channelWrite };
    }
    await ctx.db.patch(recommendation._id, {
      status: "activated",
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      activatedAt: args.approvedAt,
      updatedAt: args.approvedAt,
    });
    const activated = await ctx.db.get(recommendation._id);
    // Surface the exact write outcome alongside the activated recommendation.
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
