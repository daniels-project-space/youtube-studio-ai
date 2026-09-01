import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import {
  STUDIO_REUSABLE_MEDIA_VERSION,
  STUDIO_REUSABLE_MEDIA_PLAN_VERSION,
  assertStudioReusableMediaEntry,
  assertStudioReusableMediaPlan,
  assertStudioReusableMediaUsageReceipt,
  resolveStudioReusableMedia,
  StudioReusableMediaClaimRequestSchema,
  studioReusableMediaClaimRequestFingerprint,
  studioReusableMediaInventory,
  type StudioReusableMediaEntry,
} from "../src/engine/studioReusableMedia";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";

type MediaRow = {
  readonly fingerprint: string;
  readonly logicalId: string;
  readonly entry: unknown;
};

function currentEntries(rows: readonly MediaRow[]): StudioReusableMediaEntry[] {
  const parsed = rows.map((row) => assertStudioReusableMediaEntry(row.entry));
  const superseded = new Set(parsed.flatMap((entry) => entry.supersedesFingerprint ? [entry.supersedesFingerprint] : []));
  return parsed.filter((entry) => !superseded.has(entry.fingerprint));
}

export const listInventory = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio reusable media inventory");
    const rows = await ctx.db
      .query("studioReusableMediaAssets")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return studioReusableMediaInventory(currentEntries(rows as MediaRow[]));
  },
});

/**
 * A retry receives the exact same ordinal and selection. Convex mutations are
 * serializable, so two channel runs cannot both become episode N even if they
 * arrive concurrently through independent schedulers.
 */
export const claimEpisodeAndResolve = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    request: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio reusable media selection");
    const request = StudioReusableMediaClaimRequestSchema.parse(args.request);
    if (request.ownerId !== args.ownerId || request.channelId !== String(args.channelId) || request.runId !== String(args.runId)) {
      throw new Error("studioReusableMedia: request owner/channel/run binding mismatch");
    }
    const [channel, run] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.runId)]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("studioReusableMedia: selection channel must belong to the same owner");
    }
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("studioReusableMedia: selection must bind an owned run in the same channel");
    }
    if (channel.family && channel.family !== request.family) {
      throw new Error("studioReusableMedia: frozen request family differs from channel identity");
    }
    const programBrief = channel.identity?.programBrief as undefined | { nicheKey?: string; subcategory?: string };
    if (programBrief) {
      if (request.nicheKey !== programBrief.nicheKey || request.subcategory !== programBrief.subcategory) {
        throw new Error("studioReusableMedia: frozen request program identity differs from channel identity");
      }
    } else if (request.nicheKey || request.subcategory) {
      throw new Error("studioReusableMedia: a historical channel without a canonical brief cannot claim an inferred reuse policy");
    }

    const claimRequestFingerprint = studioReusableMediaClaimRequestFingerprint(request);
    const existing = await ctx.db
      .query("studioReusableMediaEpisodeClaims")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId || existing.channelId !== args.channelId || existing.claimRequestFingerprint !== claimRequestFingerprint) {
        throw new Error("studioReusableMedia: immutable run claim collision");
      }
      const plan = assertStudioReusableMediaPlan(existing.plan);
      if (plan.fingerprint !== existing.planFingerprint || plan.episodeOrdinal !== existing.episodeOrdinal) {
        throw new Error("studioReusableMedia: persisted claim plan is corrupt");
      }
      return plan;
    }

    const [priorClaims, mediaRows, priorUsageRows] = await Promise.all([
      ctx.db
        .query("studioReusableMediaEpisodeClaims")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect(),
      ctx.db
        .query("studioReusableMediaAssets")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect(),
      ctx.db
        .query("studioReusableMediaUsageObservations")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .collect(),
    ]);
    const episodeOrdinal = priorClaims.reduce((maximum, claim) => Math.max(maximum, claim.episodeOrdinal), 0) + 1;
    const plan = resolveStudioReusableMedia({
      request: { ...request, episodeOrdinal },
      entries: currentEntries(mediaRows as MediaRow[]),
      priorUses: priorUsageRows.map((usage) => ({
        assetFingerprint: usage.assetFingerprint,
        episodeOrdinal: usage.episodeOrdinal,
      })),
    });
    await ctx.db.insert("studioReusableMediaEpisodeClaims", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      version: STUDIO_REUSABLE_MEDIA_PLAN_VERSION,
      episodeOrdinal,
      claimRequestFingerprint,
      policyFingerprint: plan.policy.fingerprint,
      planFingerprint: plan.fingerprint,
      plan,
      createdAt: Date.now(),
    });
    return plan;
  },
});

/** Service-only post-QA promotion of already copied, durable media bytes. */
export const recordEntry = mutation({
  args: { ownerId: v.string(), entry: v.any() },
  returns: v.id("studioReusableMediaAssets"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio reusable media promotion");
    const entry = assertStudioReusableMediaEntry(args.entry);
    if (entry.ownerId !== args.ownerId) {
      throw new Error("studioReusableMedia: entry owner mismatch");
    }
    const channelId = entry.channelId as Id<"channels">;
    const sourceRunId = entry.origin.sourceRunId as Id<"runs">;
    const [channel, run] = await Promise.all([ctx.db.get(channelId), ctx.db.get(sourceRunId)]);
    if (!channel || channel.ownerId !== args.ownerId || !run || run.ownerId !== args.ownerId || run.channelId !== channelId) {
      throw new Error("studioReusableMedia: source run and channel must share the owning Studio identity");
    }
    const existing = await ctx.db
      .query("studioReusableMediaAssets")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", entry.fingerprint))
      .unique();
    if (existing) {
      assertStudioReusableMediaEntry(existing.entry);
      return existing._id;
    }
    const logicalRows = await ctx.db
      .query("studioReusableMediaAssets")
      .withIndex("by_owner_channel_logical_id", (q) =>
        q.eq("ownerId", args.ownerId).eq("channelId", channelId).eq("logicalId", entry.logicalId),
      )
      .collect();
    const current = currentEntries(logicalRows as MediaRow[]);
    if (entry.supersedesFingerprint) {
      if (!current.some((candidate) => candidate.fingerprint === entry.supersedesFingerprint)) {
        throw new Error("studioReusableMedia: entry may supersede only its current immutable predecessor");
      }
    } else if (current.length > 0) {
      throw new Error("studioReusableMedia: a logical asset revision must identify its predecessor");
    }
    // A status-only revocation legitimately keeps the same bytes and creates a
    // new immutable semantic revision. Byte de-duplication therefore applies
    // only to a brand-new logical asset, never to an explicit supersession.
    if (!entry.supersedesFingerprint) {
      const sameBytes = await ctx.db
        .query("studioReusableMediaAssets")
        .withIndex("by_channel_content_sha256", (q) =>
          q.eq("channelId", channelId).eq("contentSha256", entry.resource.contentSha256),
        )
        .first();
      if (sameBytes) {
        assertStudioReusableMediaEntry(sameBytes.entry);
        return sameBytes._id;
      }
    }
    return await ctx.db.insert("studioReusableMediaAssets", {
      ownerId: args.ownerId,
      channelId,
      sourceRunId,
      version: STUDIO_REUSABLE_MEDIA_VERSION,
      logicalId: entry.logicalId,
      fingerprint: entry.fingerprint,
      kind: entry.kind,
      status: entry.status,
      contentSha256: entry.resource.contentSha256,
      entry,
      createdAt: Date.now(),
    });
  },
});

/** Record only media that actually survived into a certificate-bound master. */
export const recordUsage = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    usage: v.any(),
  },
  returns: v.array(v.id("studioReusableMediaUsageObservations")),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio reusable media release usage");
    const usage = assertStudioReusableMediaUsageReceipt(args.usage);
    const claim = await ctx.db
      .query("studioReusableMediaEpisodeClaims")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (!claim || claim.ownerId !== args.ownerId || claim.channelId !== args.channelId) {
      throw new Error("studioReusableMedia: release usage has no owned episode claim");
    }
    const plan = assertStudioReusableMediaPlan(claim.plan);
    if (usage.planFingerprint !== plan.fingerprint || usage.episodeOrdinal !== plan.episodeOrdinal) {
      throw new Error("studioReusableMedia: release usage differs from its frozen episode plan");
    }
    const priorRunUsage = await ctx.db
      .query("studioReusableMediaUsageObservations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const priorByAsset = new Map(priorRunUsage.map((observation) => [observation.assetFingerprint, observation]));
    const ids: Id<"studioReusableMediaUsageObservations">[] = [];
    for (const actualUse of usage.uses) {
      const assetFingerprint = actualUse.assetFingerprint;
      const selection = plan.selections.find((item) => item.assetFingerprint === assetFingerprint);
      if (!selection) throw new Error("studioReusableMedia: release usage references an unselected asset");
      const asset = await ctx.db
        .query("studioReusableMediaAssets")
        .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", assetFingerprint))
        .unique();
      if (!asset || asset.channelId !== args.channelId) {
        throw new Error("studioReusableMedia: release usage cannot cross channel media scope");
      }
      const priorForRun = priorByAsset.get(assetFingerprint);
      if (priorForRun) {
        if (priorForRun.usageFingerprint !== usage.fingerprint) {
          throw new Error("studioReusableMedia: one run cannot record conflicting usage for the same asset");
        }
        ids.push(priorForRun._id);
        continue;
      }
      const existing = await ctx.db
        .query("studioReusableMediaUsageObservations")
        .withIndex("by_owner_usage_asset", (q) =>
          q.eq("ownerId", args.ownerId).eq("usageFingerprint", usage.fingerprint).eq("assetFingerprint", assetFingerprint),
        )
        .unique();
      if (existing) {
        ids.push(existing._id);
        continue;
      }
      ids.push(await ctx.db.insert("studioReusableMediaUsageObservations", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        assetFingerprint,
        planFingerprint: plan.fingerprint,
        usageFingerprint: usage.fingerprint,
        certificateFingerprint: usage.certificateFingerprint,
        finalMasterSha256: usage.finalMasterSha256,
        episodeOrdinal: usage.episodeOrdinal,
        screenSeconds: actualUse.screenSeconds,
        usage,
        createdAt: Date.now(),
      }));
    }
    return ids;
  },
});
