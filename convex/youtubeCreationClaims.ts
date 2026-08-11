import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  YOUTUBE_CREATION_CLAIM_LEASE_MS,
  assertYoutubeChannelId,
  assertYoutubeCreationApprovalReceiptShape,
  assertYoutubeCreationBinding,
  assertYoutubeCreationClaimBinding,
  assertYoutubeCreationCompletionWasAbsent,
  assertYoutubeCreationCompletionOwner,
  assertYoutubeChannelIdUniqueBinding,
  assertYoutubePreProviderInventoryProof,
  assertExistingYoutubeProviderBinding,
  decideYoutubeCreationClaimAction,
  decideYoutubeCreationRecoveryAdmission,
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  type YoutubeCreationBinding,
  type YoutubePreProviderInventoryProof,
} from "@/lib/youtubeChannelCreationClaim";

const bindingArgs = {
  ownerId: v.string(),
  channelId: v.id("channels"),
  requestKey: v.string(),
  name: v.string(),
  requestedHandle: v.string(),
  receiptFingerprint: v.string(),
};

const preProviderInventoryValidator = v.object({
  version: v.literal("youtube-pre-provider-inventory/v1"),
  ownerId: v.string(),
  channelId: v.string(),
  requestKey: v.string(),
  name: v.string(),
  requestedHandle: v.string(),
  receiptFingerprint: v.string(),
  inventoryFingerprint: v.string(),
  candidateCount: v.number(),
  observedYtChannelIds: v.array(v.string()),
  exactIdentityState: v.union(
    v.literal("absent"),
    v.literal("present"),
    v.literal("ambiguous"),
  ),
  observedAt: v.number(),
});

function samePreProviderInventory(
  left: YoutubePreProviderInventoryProof,
  right: YoutubePreProviderInventoryProof,
): boolean {
  return left.version === right.version &&
    left.ownerId === right.ownerId &&
    left.channelId === right.channelId &&
    left.requestKey === right.requestKey &&
    left.name === right.name &&
    left.requestedHandle === right.requestedHandle &&
    left.receiptFingerprint === right.receiptFingerprint &&
    left.inventoryFingerprint === right.inventoryFingerprint &&
    left.candidateCount === right.candidateCount &&
    left.exactIdentityState === right.exactIdentityState &&
    left.observedAt === right.observedAt &&
    left.observedYtChannelIds.length === right.observedYtChannelIds.length &&
    left.observedYtChannelIds.every((value, index) => value === right.observedYtChannelIds[index]);
}

async function requireCreationService(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
  ownerId: string,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity() as {
    role?: unknown;
    owner_id?: unknown;
  } | null;
  if (identity?.role !== "service" || identity.owner_id !== ownerId) {
    throw new Error("YouTube creation claim writes require the bound studio service identity");
  }
}

function bindingFrom(args: {
  ownerId: string;
  channelId: Id<"channels">;
  requestKey: string;
  name: string;
  requestedHandle: string;
  receiptFingerprint: string;
}): YoutubeCreationBinding {
  return {
    ownerId: args.ownerId,
    channelId: String(args.channelId),
    requestKey: args.requestKey,
    name: normalizeYoutubeChannelName(args.name),
    requestedHandle: normalizeYoutubeHandle(args.requestedHandle),
    receiptFingerprint: args.receiptFingerprint,
  };
}

function assertClaimBinding(
  claim: {
    ownerId: string;
    channelId: Id<"channels">;
    requestKey: string;
    name: string;
    requestedHandle: string;
    receiptFingerprint: string;
  },
  requested: YoutubeCreationBinding,
): void {
  assertYoutubeCreationClaimBinding(
    {
      ownerId: claim.ownerId,
      channelId: String(claim.channelId),
      requestKey: claim.requestKey,
      name: claim.name,
      requestedHandle: claim.requestedHandle,
      receiptFingerprint: claim.receiptFingerprint,
    },
    requested,
  );
}

async function exactClaim(
  ctx: Pick<QueryCtx, "db">,
  ownerId: string,
  requestKey: string,
) {
  return await ctx.db
    .query("youtubeCreationClaims")
    .withIndex("by_owner_request", (q) =>
      q.eq("ownerId", ownerId).eq("requestKey", requestKey),
    )
    .unique();
}

export const get = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (claim && claim.channelId !== args.channelId) {
      throw new Error("YouTube creation claim channel binding mismatch");
    }
    return claim;
  },
});

export const getForChannel = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const claims = await ctx.db
      .query("youtubeCreationClaims")
      .withIndex("by_channel_request", (q) => q.eq("channelId", args.channelId))
      .take(20);
    if (claims.some((claim) => claim.ownerId !== args.ownerId)) {
      throw new Error("YouTube creation claim owner binding mismatch");
    }
    return claims.sort((a, b) => {
      const aActive = a.status === "pre_provider_failed" ? 0 : 1;
      const bActive = b.status === "pre_provider_failed" ? 0 : 1;
      return bActive - aActive || b.updatedAt - a.updatedAt;
    })[0] ?? null;
  },
});

export const claim = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    approvalSubject: v.string(),
    approvalActor: v.string(),
    approvalEvidence: v.string(),
    approvalIssuedAt: v.number(),
    approvalExpiresAt: v.number(),
    approvalReceipt: v.any(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    assertYoutubeCreationBinding(requested);
    if (!args.workerId.trim()) throw new Error("YouTube creation workerId is required");
    if (!args.approvalActor.startsWith("authenticated-operator:")) {
      throw new Error("YouTube creation approval actor is invalid");
    }
    if (!args.approvalEvidence.trim()) {
      throw new Error("YouTube creation approval evidence is required");
    }
    assertYoutubeCreationApprovalReceiptShape(args.approvalReceipt, {
      ownerId: args.ownerId,
      subject: args.approvalSubject,
      actor: args.approvalActor,
      evidence: args.approvalEvidence,
      issuedAt: args.approvalIssuedAt,
      expiresAt: args.approvalExpiresAt,
    });
    if (
      !Number.isFinite(args.approvalIssuedAt) ||
      !Number.isFinite(args.approvalExpiresAt) ||
      args.approvalExpiresAt <= args.approvalIssuedAt
    ) {
      throw new Error("YouTube creation approval timestamps are invalid");
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("YouTube creation channel owner mismatch");
    }
    const existing = await exactClaim(ctx, args.ownerId, args.requestKey);
    const channelClaims = await ctx.db
      .query("youtubeCreationClaims")
      .withIndex("by_channel_request", (q) => q.eq("channelId", args.channelId))
      .take(20);
    if (channelClaims.some(
      (row) => row.requestKey !== args.requestKey && row.status !== "pre_provider_failed",
    )) {
      throw new Error("YouTube creation channel is already bound to another request");
    }
    assertExistingYoutubeProviderBinding({
      projectedYtChannelId: channel.youtubeCreated?.ytChannelId,
      existingClaim: existing,
    });
    if (!existing && normalizeYoutubeChannelName(channel.name) !== requested.name) {
      throw new Error("YouTube creation name does not match the bound app channel");
    }
    const action = decideYoutubeCreationClaimAction({
      existing: existing
        ? {
            ownerId: existing.ownerId,
            channelId: String(existing.channelId),
            requestKey: existing.requestKey,
            name: existing.name,
            requestedHandle: existing.requestedHandle,
            receiptFingerprint: existing.receiptFingerprint,
            status: existing.status,
            workerId: existing.workerId,
            claimExpiresAt: existing.claimExpiresAt,
            ytChannelId: existing.ytChannelId,
          }
        : null,
      requested,
      workerId: args.workerId,
      now: args.now,
    });
    if (existing) {
      if (action === "create") {
        await ctx.db.patch(existing._id, {
          workerId: args.workerId,
          claimExpiresAt: args.now + YOUTUBE_CREATION_CLAIM_LEASE_MS,
          updatedAt: args.now,
          lastError: undefined,
        });
      }
      return { action, claim: await ctx.db.get(existing._id) };
    }
    if (channelClaims.length >= 20) {
      throw new Error("YouTube creation pre-provider intent history is full");
    }

    const claimId = await ctx.db.insert("youtubeCreationClaims", {
      ...requested,
      channelId: args.channelId,
      approvalSubject: args.approvalSubject,
      approvalActor: args.approvalActor,
      approvalEvidence: args.approvalEvidence.trim().slice(0, 500),
      approvalIssuedAt: args.approvalIssuedAt,
      approvalExpiresAt: args.approvalExpiresAt,
      approvalReceipt: args.approvalReceipt,
      status: "claimed",
      workerId: args.workerId,
      claimExpiresAt: args.now + YOUTUBE_CREATION_CLAIM_LEASE_MS,
      recoveryAttempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { action: "create" as const, claim: await ctx.db.get(claimId) };
  },
});

export const markPreProviderFailed = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    if (claim.status !== "claimed" || claim.workerId !== args.workerId) return claim;
    await ctx.db.patch(claim._id, {
      status: "pre_provider_failed",
      claimExpiresAt: args.now,
      lastError: args.error.slice(0, 500),
      updatedAt: args.now,
    });
    return await ctx.db.get(claim._id);
  },
});

/**
 * Freeze the deterministic channel-switcher inventory before provider start.
 * Replays may only present the exact same observation; a changed browser view
 * requires a fresh creation intent rather than replacing causal evidence.
 */
export const recordPreProviderInventory = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    proof: preProviderInventoryValidator,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    const proof = args.proof as YoutubePreProviderInventoryProof;
    assertYoutubePreProviderInventoryProof(proof, requested);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    if (proof.observedAt < claim.createdAt || proof.observedAt > args.now) {
      throw new Error("YouTube pre-provider inventory is outside the claim timeline");
    }
    if (claim.status !== "claimed") {
      throw new Error("YouTube pre-provider inventory cannot change after provider start");
    }
    if (claim.workerId !== args.workerId || claim.claimExpiresAt < args.now) {
      throw new Error("YouTube pre-provider inventory worker does not own the live claim");
    }
    if (claim.preProviderInventory) {
      if (!samePreProviderInventory(
        claim.preProviderInventory as YoutubePreProviderInventoryProof,
        proof,
      )) {
        throw new Error("YouTube pre-provider inventory replay mismatch");
      }
      return claim.preProviderInventory;
    }
    await ctx.db.patch(claim._id, {
      preProviderInventory: proof,
      updatedAt: args.now,
    });
    return proof;
  },
});

export const markProviderStarted = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    if (claim.status !== "claimed") {
      return { started: false as const, status: claim.status };
    }
    if (claim.workerId !== args.workerId || claim.claimExpiresAt < args.now) {
      return { started: false as const, status: "claim_not_owned" as const };
    }
    const inventory = claim.preProviderInventory as YoutubePreProviderInventoryProof | undefined;
    if (!inventory) {
      return { started: false as const, status: "pre_provider_inventory_missing" as const };
    }
    assertYoutubePreProviderInventoryProof(inventory, requested);
    if (inventory.exactIdentityState !== "absent") {
      return { started: false as const, status: "preexisting_exact_identity" as const };
    }
    await ctx.db.patch(claim._id, {
      status: "provider_started",
      providerAttemptId: args.workerId,
      providerStartedAt: args.now,
      claimExpiresAt: args.now + YOUTUBE_CREATION_CLAIM_LEASE_MS,
      updatedAt: args.now,
    });
    return { started: true as const, status: "provider_started" as const };
  },
});

export const beginRecovery = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    const admission = decideYoutubeCreationRecoveryAdmission({
      existing: {
        status: claim.status,
        workerId: claim.workerId,
        claimExpiresAt: claim.claimExpiresAt,
      },
      workerId: args.workerId,
      now: args.now,
    });
    if (admission === "reuse") {
      return { action: "reuse" as const, claim };
    }
    if (admission === "wait") {
      return { action: "wait" as const, claim };
    }
    await ctx.db.patch(claim._id, {
      status: "recovery",
      workerId: args.workerId,
      claimExpiresAt: args.now + YOUTUBE_CREATION_CLAIM_LEASE_MS,
      recoveryAttempts: claim.recoveryAttempts + 1,
      lastRecoveryAt: args.now,
      updatedAt: args.now,
    });
    return { action: "recover" as const, claim: await ctx.db.get(claim._id) };
  },
});

export const markAmbiguous = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    providerSessionId: v.optional(v.string()),
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    if (claim.status === "created") return claim;
    if (claim.status === "claimed" || claim.status === "pre_provider_failed") {
      throw new Error("YouTube creation cannot be ambiguous before provider start");
    }
    if (claim.workerId !== args.workerId) return claim;
    await ctx.db.patch(claim._id, {
      status: "ambiguous",
      providerSessionId: args.providerSessionId,
      lastError: args.error.slice(0, 500),
      claimExpiresAt: args.now,
      updatedAt: args.now,
    });
    return await ctx.db.get(claim._id);
  },
});

export const markCreated = mutation({
  args: {
    ...bindingArgs,
    workerId: v.string(),
    ytChannelId: v.string(),
    providerSessionId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCreationService(ctx, args.ownerId);
    const requested = bindingFrom(args);
    assertYoutubeChannelId(args.ytChannelId);
    const claim = await exactClaim(ctx, args.ownerId, args.requestKey);
    if (!claim) throw new Error("YouTube creation claim is missing");
    assertClaimBinding(claim, requested);
    assertYoutubeCreationCompletionWasAbsent(
      claim.preProviderInventory as YoutubePreProviderInventoryProof | undefined,
      requested,
      args.ytChannelId,
    );
    if (claim.status === "claimed" || claim.status === "pre_provider_failed") {
      throw new Error("YouTube creation cannot complete before provider start");
    }
    if (claim.status === "created") {
      if (claim.ytChannelId !== args.ytChannelId) {
        throw new Error("YouTube creation receipt conflicts with an existing channel id");
      }
      return claim;
    }
    assertYoutubeCreationCompletionOwner({
      claim: {
        status: claim.status,
        workerId: claim.workerId,
        providerAttemptId: claim.providerAttemptId,
      },
      workerId: args.workerId,
    });
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("YouTube creation channel owner mismatch");
    }
    if (
      channel.youtubeCreated?.ytChannelId &&
      channel.youtubeCreated.ytChannelId !== args.ytChannelId
    ) {
      throw new Error("YouTube creation result conflicts with the channel's provider binding");
    }
    const [createdClaims, projectedChannels] = await Promise.all([
      ctx.db
        .query("youtubeCreationClaims")
        .withIndex("by_yt_channel_id", (q) => q.eq("ytChannelId", args.ytChannelId))
        .collect(),
      ctx.db
        .query("channels")
        .withIndex("by_youtube_channel_id", (q) =>
          q.eq("youtubeCreated.ytChannelId", args.ytChannelId),
        )
        .collect(),
    ]);
    assertYoutubeChannelIdUniqueBinding({
      channelId: String(args.channelId),
      claimChannelIds: createdClaims
        .filter((row) => row._id !== claim._id)
        .map((row) => String(row.channelId)),
      projectedChannelIds: projectedChannels
        .filter((row) => row._id !== args.channelId)
        .map((row) => String(row._id)),
    });
    const handle = `@${normalizeYoutubeHandle(args.requestedHandle)}`;
    const url = `https://www.youtube.com/channel/${args.ytChannelId}`;
    await ctx.db.patch(claim._id, {
      status: "created",
      workerId: args.workerId,
      ytChannelId: args.ytChannelId,
      handle,
      url,
      providerSessionId: args.providerSessionId,
      completedAt: args.now,
      claimExpiresAt: args.now,
      lastError: undefined,
      updatedAt: args.now,
    });
    // This is intentionally in the same Convex transaction as the durable
    // receipt. No provisional/ambiguous state is projected onto the channel.
    //
    // DELIBERATE CHANNEL-LOCK EXCEPTION (convex/channelLock.ts). This is the one
    // channels write that is neither fork-guarded nor lock-blocked:
    //   - Forking is definitionally wrong — `youtubeCreated` is in the fork's
    //     NON_INHERITED_FORK_FIELDS (two rows may not project one ytChannelId,
    //     enforced by assertYoutubeChannelIdUniqueBinding above), so a fork
    //     would DROP the receipt entirely.
    //   - Blocking is worse — the YouTube channel already exists at the
    //     provider. Throwing here would strand the exactly-once claim in
    //     provider_started and permanently lose the receipt for a completed
    //     irreversible action.
    // This records an external fact that already happened rather than editing
    // the operator's config/content, and it is unreachable for a finished
    // channel in practice (creation runs at inception, long before lock).
    await ctx.db.patch(args.channelId, {
      youtubeCreated: {
        ytChannelId: args.ytChannelId,
        handle,
        url,
        createdAt: args.now,
        status: "created",
      },
    });
    return await ctx.db.get(claim._id);
  },
});

export const youtubeCreationClaimGuardsForTests = {
  requireCreationService,
};
