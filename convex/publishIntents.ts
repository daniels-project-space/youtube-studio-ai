import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  boundedInt,
  buildPublishIdempotencyKey,
  evaluatePublishClaim,
  localDateKey,
  retryAt,
} from "../src/lib/publishingPolicy";
import {
  reconcileLegacyDispatchTiming,
  resolvePublishDispatchAt,
} from "../src/lib/publishTiming";
import { publishedCalendarItem } from "../src/lib/publishedCalendar";
import { bindExactPublishIntent } from "./publishContinuationState";

const LEASE_MS = 8 * 60 * 60 * 1000;

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("publishIntents: invalid internal secret");
  }
}

const privacyStatus = v.union(
  v.literal("private"),
  v.literal("unlisted"),
  v.literal("public"),
);

export const createOrGet = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    runId: v.optional(v.id("runs")),
    videoArtifactId: v.string(),
    videoArtifactKey: v.string(),
    videoSha256: v.string(),
    thumbnailArtifactKey: v.optional(v.string()),
    thumbnailSha256: v.optional(v.string()),
    intentVersion: v.number(),
    idempotencyKey: v.string(),
    metadataSha256: v.string(),
    title: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    categoryId: v.string(),
    privacyStatus,
    publishAt: v.optional(v.number()),
    containsSyntheticMedia: v.boolean(),
    madeForKids: v.boolean(),
    approvedForPublish: v.boolean(),
    approvedBy: v.optional(v.string()),
    approvalEvidence: v.optional(v.string()),
    approvalPolicyVersion: v.optional(v.number()),
    approvalPolicyFingerprint: v.optional(v.string()),
    dispatchRequestedAt: v.optional(v.number()),
    hypothesis: v.optional(v.string()),
    hookVariant: v.optional(v.string()),
    visualVariant: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("publishIntents.createOrGet: channel owner mismatch");
    }
    const connector = await ctx.db.get(args.connectorId);
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId
    ) {
      throw new Error("publishIntents.createOrGet: connector binding mismatch");
    }
    const expectedKey = buildPublishIdempotencyKey({
      connectorId: String(args.connectorId),
      videoArtifactId: args.videoArtifactId,
      intentVersion: args.intentVersion,
    });
    if (args.idempotencyKey !== expectedKey) {
      throw new Error("publishIntents.createOrGet: invalid idempotency key");
    }
    if (
      !/^[a-f0-9]{64}$/.test(args.metadataSha256) ||
      !/^[a-f0-9]{64}$/.test(args.videoSha256) ||
      (args.thumbnailSha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.thumbnailSha256))
    ) {
      throw new Error("publishIntents.createOrGet: invalid content digest");
    }
    if (Boolean(args.thumbnailArtifactKey) !== Boolean(args.thumbnailSha256)) {
      throw new Error("publishIntents.createOrGet: thumbnail key/digest must be paired");
    }
    const bindRun = async (intentId: Id<"publishIntents">) => {
      if (!args.runId) return;
      await bindExactPublishIntent(ctx, {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        intentId,
        artifactId: args.videoArtifactId,
      });
    };
    const needsApproval = args.privacyStatus !== "private" || args.publishAt !== undefined;
    if (
      needsApproval &&
      args.approvedForPublish &&
      (!args.approvedBy?.trim() ||
        !args.approvalEvidence?.trim() ||
        !Number.isInteger(args.approvalPolicyVersion) ||
        (args.approvalPolicyVersion ?? 0) < 1 ||
        !/^[a-f0-9]{64}$/.test(args.approvalPolicyFingerprint ?? ""))
    ) {
      throw new Error(
        "publishIntents.createOrGet: channel-policy approval requires actor, evidence, version, and fingerprint",
      );
    }

    const existing = await ctx.db
      .query("publishIntents")
      .withIndex("by_idempotency", (q) =>
        q.eq("ownerId", args.ownerId).eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.metadataSha256 !== args.metadataSha256 ||
        existing.connectorId !== args.connectorId ||
        existing.connectorVersion !== args.connectorVersion ||
        existing.videoArtifactKey !== args.videoArtifactKey ||
        existing.videoSha256 !== args.videoSha256 ||
        existing.thumbnailArtifactKey !== args.thumbnailArtifactKey ||
        existing.thumbnailSha256 !== args.thumbnailSha256
      ) {
        throw new Error("publishIntents.createOrGet: immutable intent conflict");
      }
      if (
        existing.status === "awaiting_approval" &&
        needsApproval &&
        args.approvedForPublish
      ) {
        const requestedDispatchAt = resolvePublishDispatchAt({
          createdAt: args.createdAt,
          dispatchRequestedAt: args.dispatchRequestedAt,
          publishAt: args.publishAt,
          privacyStatus: args.privacyStatus,
        });
        await ctx.db.patch(existing._id, {
          status:
            args.publishAt !== undefined && args.publishAt > args.createdAt
              ? "scheduled"
              : "approved",
          approvedBy: args.approvedBy,
          approvedAt: args.createdAt,
          approvalEvidence: args.approvalEvidence,
          approvalKind: "channel_policy",
          approvalPolicyVersion: args.approvalPolicyVersion,
          approvalPolicyFingerprint: args.approvalPolicyFingerprint,
          dispatchAt: requestedDispatchAt,
          nextAttemptAt: requestedDispatchAt,
          lastError: undefined,
          updatedAt: requestedDispatchAt,
        });
        await bindRun(existing._id);
        return await ctx.db.get(existing._id);
      }
      // Repair pre-separation rows only before their first provider attempt.
      // Never pull a retry_wait row forward and bypass its exponential backoff.
      if (
        existing.dispatchAt === undefined &&
        existing.attempts === 0 &&
        (existing.status === "approved" || existing.status === "scheduled")
      ) {
        const requestedDispatchAt = resolvePublishDispatchAt({
          createdAt: args.createdAt,
          dispatchRequestedAt: args.dispatchRequestedAt,
          publishAt: args.publishAt,
          privacyStatus: args.privacyStatus,
        });
        const repairedTiming = reconcileLegacyDispatchTiming({
          status: existing.status,
          attempts: existing.attempts,
          dispatchAt: existing.dispatchAt,
          nextAttemptAt: existing.nextAttemptAt,
          requestedDispatchAt,
        });
        if (!repairedTiming) {
          await bindRun(existing._id);
          return existing;
        }
        await ctx.db.patch(existing._id, {
          ...repairedTiming,
          updatedAt: Math.max(existing.updatedAt, requestedDispatchAt),
        });
        await bindRun(existing._id);
        return await ctx.db.get(existing._id);
      }
      await bindRun(existing._id);
      return existing;
    }

    const tokenVersion = connector.tokenVersion ?? 1;
    if (tokenVersion !== args.connectorVersion) {
      throw new Error("publishIntents.createOrGet: connector version changed");
    }
    if ((connector.status ?? "active") !== "active") {
      throw new Error("publishIntents.createOrGet: connector is not active");
    }

    const approved = !needsApproval || args.approvedForPublish;
    const status = !approved
      ? ("awaiting_approval" as const)
      : args.publishAt !== undefined && args.publishAt > args.createdAt
        ? ("scheduled" as const)
        : ("approved" as const);
    const maxAttempts = boundedInt(channel.schedule?.retryMaxAttempts, 5, 1, 12);
    const requestedDispatchAt = resolvePublishDispatchAt({
      createdAt: args.createdAt,
      dispatchRequestedAt: args.dispatchRequestedAt,
      publishAt: args.publishAt,
      privacyStatus: args.privacyStatus,
    });
    const {
      secret: _secret,
      approvedForPublish: _approved,
      hypothesis,
      hookVariant,
      visualVariant,
      approvalPolicyVersion,
      approvalPolicyFingerprint,
      dispatchRequestedAt: _dispatchRequestedAt,
      ...doc
    } = args;
    void _secret;
    void _approved;
    void _dispatchRequestedAt;
    const intentId = await ctx.db.insert("publishIntents", {
      ...doc,
      status,
      approvedBy: approved ? (args.approvedBy ?? (needsApproval ? undefined : "system:private-first")) : undefined,
      approvedAt: approved ? args.createdAt : undefined,
      approvalEvidence: approved
        ? (args.approvalEvidence ?? (needsApproval ? undefined : "private-first policy"))
        : undefined,
      approvalKind: approved
        ? (needsApproval ? "channel_policy" : "private_first")
        : undefined,
      approvalPolicyVersion:
        approved && needsApproval ? approvalPolicyVersion : undefined,
      approvalPolicyFingerprint:
        approved && needsApproval ? approvalPolicyFingerprint : undefined,
      attempts: 0,
      maxAttempts,
      dispatchAt: approved ? requestedDispatchAt : undefined,
      nextAttemptAt: requestedDispatchAt,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
    await bindRun(intentId);
    const experimentKey = `${args.idempotencyKey}:creative`;
    const experimentId = await ctx.db.insert("contentExperiments", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      runId: args.runId,
      publishIntentId: intentId,
      experimentKey,
      version: args.intentVersion,
      hypothesis,
      titleVariant: args.title,
      thumbnailVariant: args.thumbnailArtifactKey,
      hookVariant,
      visualVariant,
      status: "assigned",
      createdAt: args.createdAt,
    });
    await ctx.db.patch(intentId, { experimentId });
    return await ctx.db.get(intentId);
  },
});

export const get = query({
  args: { secret: v.string(), intentId: v.id("publishIntents") },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    return await ctx.db.get(args.intentId);
  },
});

export const listForOwner = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const limit = boundedInt(args.limit, 100, 1, 250);
    const rows = await ctx.db
      .query("publishIntents")
      .withIndex("by_owner_created", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * Published/scheduled YouTube history for one visible calendar page.
 * Native schedules are keyed by exact `publishAt`; immediate public/unlisted
 * uploads are keyed by durable `completedAt`. Private drafts are excluded at
 * the index boundary and cannot consume the bounded result window.
 */
export const listPublishedCalendarRange = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    startAt: v.number(),
    endAt: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isFinite(args.startAt) ||
      !Number.isFinite(args.endAt) ||
      args.endAt <= args.startAt ||
      args.endAt - args.startAt > 62 * 86_400_000
    ) {
      throw new Error("published calendar range must be a valid window of at most 62 days");
    }
    const limit = boundedInt(args.limit, 800, 1, 1_000);
    const take = limit + 1;

    const scheduled = args.channelId
      ? await ctx.db
          .query("publishIntents")
          .withIndex("by_channel_status_publish_at", (q) =>
            q
              .eq("channelId", args.channelId!)
              .eq("status", "uploaded")
              .gte("publishAt", args.startAt)
              .lt("publishAt", args.endAt),
          )
          .take(take)
      : await ctx.db
          .query("publishIntents")
          .withIndex("by_owner_status_publish_at", (q) =>
            q
              .eq("ownerId", args.ownerId)
              .eq("status", "uploaded")
              .gte("publishAt", args.startAt)
              .lt("publishAt", args.endAt),
          )
          .take(take);

    const immediate = async (privacy: "public" | "unlisted") =>
      args.channelId
        ? await ctx.db
            .query("publishIntents")
            .withIndex("by_channel_status_privacy_publish_completed_at", (q) =>
              q
                .eq("channelId", args.channelId!)
                .eq("status", "uploaded")
                .eq("privacyStatus", privacy)
                .eq("publishAt", undefined)
                .gte("completedAt", args.startAt)
                .lt("completedAt", args.endAt),
            )
            .take(take)
        : await ctx.db
            .query("publishIntents")
            .withIndex("by_owner_status_privacy_publish_completed_at", (q) =>
              q
                .eq("ownerId", args.ownerId)
                .eq("status", "uploaded")
                .eq("privacyStatus", privacy)
                .eq("publishAt", undefined)
                .gte("completedAt", args.startAt)
                .lt("completedAt", args.endAt),
            )
            .take(take);

    const [publicRows, unlistedRows] = await Promise.all([
      immediate("public"),
      immediate("unlisted"),
    ]);
    const items = [...scheduled, ...publicRows, ...unlistedRows]
      .map(publishedCalendarItem)
      .filter((item) => item !== null)
      .filter((item) => item.publishedAt >= args.startAt && item.publishedAt < args.endAt)
      .sort((a, b) => a.publishedAt - b.publishedAt);

    return {
      items: items.slice(0, limit),
      truncated:
        items.length > limit ||
        scheduled.length > limit ||
        publicRows.length > limit ||
        unlistedRows.length > limit,
    };
  },
});

export const listDue = query({
  args: { secret: v.string(), now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const limit = boundedInt(args.limit, 50, 1, 200);
    const statuses = ["approved", "scheduled", "retry_wait"] as const;
    const batches = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("publishIntents")
          .withIndex("by_due", (q) =>
            q.eq("status", status).lte("nextAttemptAt", args.now),
          )
          .take(limit),
      ),
    );
    const expired = await ctx.db
      .query("publishIntents")
      .withIndex("by_status_lease", (q) =>
        q.eq("status", "dispatching").lte("leaseExpiresAt", args.now),
      )
      .take(limit);
    return [...batches.flat(), ...expired]
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
  },
});

export const claim = mutation({
  args: {
    secret: v.string(),
    intentId: v.id("publishIntents"),
    workerId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent) throw new Error("publishIntents.claim: intent not found");
    if (intent.status === "uploaded") {
      return { claimed: false as const, reason: "already_uploaded", intent };
    }
    if (
      intent.attempts >= intent.maxAttempts &&
      (intent.status === "dispatching" || intent.status === "retry_wait")
    ) {
      await ctx.db.patch(intent._id, {
        status: "dead_letter",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: "publish attempts exhausted",
        updatedAt: args.now,
      });
      return { claimed: false as const, reason: "attempts_exhausted", intent };
    }
    const [channel, connector] = await Promise.all([
      ctx.db.get(intent.channelId),
      ctx.db.get(intent.connectorId),
    ]);
    if (!channel || !connector) {
      await ctx.db.patch(intent._id, {
        status: "blocked_connector",
        lastError: "channel or connector deleted",
        updatedAt: args.now,
      });
      return { claimed: false as const, reason: "connector_missing", intent };
    }
    const timezone = channel.schedule?.timezone ?? "UTC";
    const quotaDay = localDateKey(args.now, timezone);
    const active = await ctx.db
      .query("publishIntents")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", intent.channelId).eq("status", "dispatching"),
      )
      .collect();
    const activeDispatches = active.filter(
      (row) => row._id !== intent._id && (row.leaseExpiresAt ?? 0) > args.now,
    ).length;
    const uploadsToday = (
      await ctx.db
        .query("publishIntents")
        .withIndex("by_channel_quota_day", (q) =>
          q.eq("channelId", intent.channelId).eq("quotaDay", quotaDay),
        )
        .collect()
    ).filter((row) => row.status === "uploaded").length;
    const repairedTiming = reconcileLegacyDispatchTiming({
      status: intent.status,
      attempts: intent.attempts,
      dispatchAt: intent.dispatchAt,
      nextAttemptAt: intent.nextAttemptAt,
      requestedDispatchAt: args.now,
    });
    const decision = evaluatePublishClaim({
      now: args.now,
      intent: {
        ownerId: intent.ownerId,
        channelId: String(intent.channelId),
        connectorId: String(intent.connectorId),
        connectorVersion: intent.connectorVersion,
        status: intent.status,
        nextAttemptAt: repairedTiming?.nextAttemptAt ?? intent.nextAttemptAt,
        publishAt: intent.publishAt,
        leaseExpiresAt: intent.leaseExpiresAt,
      },
      connector: {
        connectorId: String(connector._id),
        ownerId: connector.ownerId,
        channelId: String(connector.channelId),
        tokenVersion: connector.tokenVersion ?? 1,
        status: connector.status ?? "active",
        grantedScopes: connector.grantedScopes ?? [],
      },
      activeDispatches,
      uploadsToday,
      schedule: channel.schedule,
    });
    if (!decision.ok) {
      if (decision.terminal) {
        await ctx.db.patch(intent._id, {
          status:
            decision.reason === "publish_window_elapsed"
              ? "dead_letter"
              : "blocked_connector",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          lastError: decision.reason,
          updatedAt: args.now,
        });
      }
      return { claimed: false as const, reason: decision.reason, intent };
    }
    await ctx.db.patch(intent._id, {
      ...(repairedTiming ?? {}),
      status: "dispatching",
      attempts: intent.attempts + 1,
      leaseOwner: args.workerId,
      leaseExpiresAt: args.now + LEASE_MS,
      lastError: undefined,
      updatedAt: args.now,
    });
    return {
      claimed: true as const,
      intent: await ctx.db.get(intent._id),
    };
  },
});

export const complete = mutation({
  args: {
    secret: v.string(),
    intentId: v.id("publishIntents"),
    workerId: v.string(),
    youtubeVideoId: v.string(),
    watchUrl: v.string(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent) throw new Error("publishIntents.complete: intent not found");
    if (intent.status === "uploaded") {
      if (intent.youtubeVideoId !== args.youtubeVideoId) {
        throw new Error("publishIntents.complete: conflicting YouTube video id");
      }
      return intent;
    }
    if (intent.status !== "dispatching" || intent.leaseOwner !== args.workerId) {
      throw new Error("publishIntents.complete: lease owner mismatch");
    }
    const channel = await ctx.db.get(intent.channelId);
    const quotaDay = localDateKey(args.completedAt, channel?.schedule?.timezone ?? "UTC");
    await ctx.db.patch(intent._id, {
      status: "uploaded",
      youtubeVideoId: args.youtubeVideoId,
      watchUrl: args.watchUrl,
      quotaDay,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
    });
    if (intent.experimentId) {
      await ctx.db.patch(intent.experimentId, { youtubeVideoId: args.youtubeVideoId });
    }
    return await ctx.db.get(intent._id);
  },
});

export const fail = mutation({
  args: {
    secret: v.string(),
    intentId: v.id("publishIntents"),
    workerId: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent) throw new Error("publishIntents.fail: intent not found");
    if (intent.status === "uploaded") return intent;
    if (intent.status !== "dispatching" || intent.leaseOwner !== args.workerId) {
      throw new Error("publishIntents.fail: lease owner mismatch");
    }
    const channel = await ctx.db.get(intent.channelId);
    const exhausted = intent.attempts >= intent.maxAttempts;
    await ctx.db.patch(intent._id, {
      status: exhausted ? "dead_letter" : "retry_wait",
      nextAttemptAt: exhausted
        ? intent.nextAttemptAt
        : retryAt(args.failedAt, intent.attempts, channel?.schedule?.retryBaseMinutes),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastError: args.error.slice(0, 1_000),
      updatedAt: args.failedAt,
    });
    return await ctx.db.get(intent._id);
  },
});

/** Release a claimed channel-policy intent when the policy was changed/revoked. */
export const requireReapproval = mutation({
  args: {
    secret: v.string(),
    intentId: v.id("publishIntents"),
    workerId: v.string(),
    reason: v.string(),
    changedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent) throw new Error("publishIntents.requireReapproval: intent not found");
    if (intent.status !== "dispatching" || intent.leaseOwner !== args.workerId) {
      throw new Error("publishIntents.requireReapproval: lease owner mismatch");
    }
    if (intent.privacyStatus === "private" && intent.publishAt === undefined) {
      throw new Error("publishIntents.requireReapproval: private-first intent cannot be blocked");
    }
    await ctx.db.patch(intent._id, {
      status: "awaiting_approval",
      attempts: Math.max(0, intent.attempts - 1),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      approvalEvidence: undefined,
      approvalKind: undefined,
      approvalPolicyVersion: undefined,
      approvalPolicyFingerprint: undefined,
      dispatchAt: undefined,
      lastError: args.reason.slice(0, 1_000),
      updatedAt: args.changedAt,
    });
    return await ctx.db.get(intent._id);
  },
});

export const approve = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    intentId: v.id("publishIntents"),
    approvedBy: v.string(),
    evidence: v.string(),
    approvedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.ownerId !== args.ownerId) {
      throw new Error("publishIntents.approve: owner mismatch");
    }
    if (!args.approvedBy.trim() || !args.evidence.trim()) {
      throw new Error("publishIntents.approve: actor and evidence are required");
    }
    if (intent.status !== "awaiting_approval") return intent;
    const dispatchAt = resolvePublishDispatchAt({
      createdAt: intent.createdAt,
      dispatchRequestedAt: args.approvedAt,
      publishAt: intent.publishAt,
      privacyStatus: intent.privacyStatus,
    });
    await ctx.db.patch(intent._id, {
      status:
        intent.publishAt !== undefined && intent.publishAt > args.approvedAt
          ? "scheduled"
          : "approved",
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      approvalEvidence: args.evidence.slice(0, 500),
      approvalKind: "manual_intent",
      approvalPolicyVersion: undefined,
      approvalPolicyFingerprint: undefined,
      dispatchAt,
      nextAttemptAt: dispatchAt,
      updatedAt: args.approvedAt,
    });
    return await ctx.db.get(intent._id);
  },
});

export const cancel = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    intentId: v.id("publishIntents"),
    cancelledAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.ownerId !== args.ownerId) {
      throw new Error("publishIntents.cancel: owner mismatch");
    }
    if (intent.status === "uploaded") {
      throw new Error("publishIntents.cancel: uploaded intents cannot be cancelled");
    }
    if (intent.status === "dispatching") {
      throw new Error("publishIntents.cancel: an in-flight upload cannot be cancelled safely");
    }
    await ctx.db.patch(intent._id, {
      status: "cancelled",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: args.cancelledAt,
    });
    return await ctx.db.get(intent._id);
  },
});
