import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import {
  assertStudioAssetLibraryEntry,
  assertStudioAssetReleaseUsageReceipt,
  resolveStudioAssetLibrary,
  StudioAssetResolveRequestSchema,
  studioAssetLibraryInventory,
  type StudioAssetLibraryEntry,
} from "../src/engine/studioAssetLibrary";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";

type AssetRow = {
  readonly _id: string;
  readonly ownerId: string;
  readonly logicalId: string;
  readonly fingerprint: string;
  readonly entry: unknown;
};

function currentEntries(rows: readonly AssetRow[]): StudioAssetLibraryEntry[] {
  const superseded = new Set<string>();
  const parsed = rows.map((row) => ({ row, entry: assertStudioAssetLibraryEntry(row.entry) }));
  for (const { entry } of parsed) {
    if (entry.supersedesFingerprint) superseded.add(entry.supersedesFingerprint);
  }
  return parsed
    .filter(({ entry }) => !superseded.has(entry.fingerprint))
    .map(({ entry }) => entry);
}

/**
 * Immutable asset promotion. Only the Studio service may publish an entry; a
 * browser can browse its own library but cannot inject recipes, weights, or
 * control guides into a future render.
 */
export const recordEntry = mutation({
  args: {
    ownerId: v.string(),
    entry: v.any(),
  },
  returns: v.id("studioAssetLibraryEntries"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library entry promotion");
    const entry = assertStudioAssetLibraryEntry(args.entry);
    if (entry.channelId) {
      const channel = await ctx.db.get(entry.channelId as Id<"channels">);
      if (!channel || channel.ownerId !== args.ownerId) {
        throw new Error("studioAssetLibrary: entry channel must belong to the same owner");
      }
    }
    const existing = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", entry.fingerprint))
      .unique();
    if (existing) {
      if (existing.logicalId !== entry.logicalId) {
        throw new Error("studioAssetLibrary: immutable fingerprint collision across logical assets");
      }
      assertStudioAssetLibraryEntry(existing.entry);
      return existing._id;
    }

    const sameLogicalRows = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner_logical_id", (q) => q.eq("ownerId", args.ownerId).eq("logicalId", entry.logicalId))
      .collect();
    const current = currentEntries(sameLogicalRows as AssetRow[]);
    if (entry.supersedesFingerprint) {
      const predecessor = sameLogicalRows.find((row) => row.fingerprint === entry.supersedesFingerprint);
      if (!predecessor || !current.some((candidate) => candidate.fingerprint === entry.supersedesFingerprint)) {
        throw new Error("studioAssetLibrary: an entry may supersede only its current immutable predecessor");
      }
    } else if (current.length > 0) {
      throw new Error("studioAssetLibrary: a new revision requires its exact current predecessor fingerprint");
    }

    return await ctx.db.insert("studioAssetLibraryEntries", {
      ownerId: args.ownerId,
      version: entry.version,
      logicalId: entry.logicalId,
      fingerprint: entry.fingerprint,
      scope: entry.scope,
      channelId: entry.channelId as Id<"channels"> | undefined,
      seriesIdentity: entry.seriesIdentity,
      assetKind: entry.assetKind,
      status: entry.status,
      entry,
      createdAt: entry.approval.approvedAt,
    });
  },
});

/** Owner-visible metadata/recipes only; no signed object URLs or local model paths. */
export const listForChannel = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library channel inventory");
    const rows = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return currentEntries((rows.filter((row) =>
      row.scope === "owned_studio" || row.channelId === args.channelId,
    ) as AssetRow[]));
  },
});

/** Browser-safe owner inventory. It deliberately exposes approval and reuse
 * compatibility, not R2 locations, adapter bytes, or worker-local paths. */
export const listInventory = query({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library inventory");
    const rows = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return studioAssetLibraryInventory(currentEntries(rows as AssetRow[]));
  },
});

/**
 * Server-only preview lookup. The browser inventory stays metadata-only; an
 * authenticated route may use this narrow result to mint one short-lived
 * image preview without ever disclosing an R2 key or model bytes to the UI.
 */
export const resolveApprovedImagePreview = query({
  args: {
    ownerId: v.string(),
    assetEntryFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library image preview");
    const row = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner_fingerprint", (q) =>
        q.eq("ownerId", args.ownerId).eq("fingerprint", args.assetEntryFingerprint),
      )
      .unique();
    if (!row) return null;
    const entry = assertStudioAssetLibraryEntry(row.entry);
    if (entry.status !== "approved" || !entry.resource || !entry.resource.contentType.startsWith("image/")) {
      return null;
    }
    return {
      r2Key: entry.resource.r2Key,
      contentType: entry.resource.contentType,
      contentSha256: entry.resource.contentSha256,
    };
  },
});

/** Browser-safe aggregate of sealed final-master observations. It omits the
 * certificate payload, prompts, media keys, and worker paths; the operator
 * sees only whether an already-approved asset has enough exact evidence to
 * break a future equal-score resolver tie. */
export const listReleaseFeedback = query({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library release feedback");
    const rows = await ctx.db
      .query("studioAssetReleaseUsageObservations")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const byAsset = new Map<string, Map<string, { score?: number; observedAt: number }>>();
    for (const row of rows) {
      try {
        const usage = assertStudioAssetReleaseUsageReceipt(row.usage);
        const masters = byAsset.get(row.assetEntryFingerprint) ?? new Map();
        const prior = masters.get(usage.finalMaster.sha256);
        if (!prior || row.createdAt > prior.observedAt) {
          masters.set(usage.finalMaster.sha256, {
            ...(usage.quality.visualScore === undefined ? {} : { score: usage.quality.visualScore }),
            observedAt: row.createdAt,
          });
        }
        byAsset.set(row.assetEntryFingerprint, masters);
      } catch {
        // A corrupt historical row cannot create a visible quality claim.
      }
    }
    return [...byAsset.entries()]
      .map(([assetEntryFingerprint, masters]) => {
        const observations = [...masters.values()];
        const measured = observations.filter((observation) => observation.score !== undefined);
        const meanVisualScore = measured.length
          ? measured.reduce((sum, observation) => sum + observation.score!, 0) / measured.length
          : null;
        return {
          assetEntryFingerprint,
          sealedFinalMasters: observations.length,
          measuredVisualFinalMasters: measured.length,
          meanVisualScore,
          demonstratedForEqualApprovalTieBreak: measured.length >= 3,
          latestObservedAt: Math.max(...observations.map((observation) => observation.observedAt)),
        };
      })
      .sort((left, right) => right.latestObservedAt - left.latestObservedAt || left.assetEntryFingerprint.localeCompare(right.assetEntryFingerprint));
  },
});

/**
 * Service-only write of a release observation. The immutable certificate has
 * already been R2-reloaded and verified by QA; this table keeps a compact,
 * queryable learning signal without copying video bytes, prompts, or model
 * paths into Convex.
 */
export const recordReleaseUsage = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    certificateFingerprint: v.string(),
    usage: v.any(),
  },
  returns: v.array(v.id("studioAssetReleaseUsageObservations")),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library release observation");
    const usage = assertStudioAssetReleaseUsageReceipt(args.usage);
    const [channel, run] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.runId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("studioAssetLibrary: release-observation channel must belong to the same owner");
    }
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("studioAssetLibrary: release observation must bind an owned run and channel");
    }

    const ids = [];
    for (const use of usage.uses) {
      const assetRow = await ctx.db
        .query("studioAssetLibraryEntries")
        .withIndex("by_owner_fingerprint", (q) =>
          q.eq("ownerId", args.ownerId).eq("fingerprint", use.assetEntryFingerprint),
        )
        .unique();
      if (!assetRow) {
        throw new Error("studioAssetLibrary: release observation references an unknown owned Studio asset");
      }
      const asset = assertStudioAssetLibraryEntry(assetRow.entry);
      if (asset.scope !== "owned_studio" && asset.channelId !== String(args.channelId)) {
        throw new Error("studioAssetLibrary: release observation cannot cross channel asset scope");
      }

      const existing = await ctx.db
        .query("studioAssetReleaseUsageObservations")
        .withIndex("by_owner_certificate_asset_module", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("certificateFingerprint", args.certificateFingerprint)
            .eq("assetEntryFingerprint", use.assetEntryFingerprint)
            .eq("moduleId", use.moduleId),
        )
        .unique();
      if (existing) {
        if (
          existing.usageReceiptFingerprint !== usage.receiptFingerprint ||
          existing.finalMasterSha256 !== usage.finalMaster.sha256
        ) {
          throw new Error("studioAssetLibrary: immutable release observation collision");
        }
        ids.push(existing._id);
        continue;
      }
      ids.push(await ctx.db.insert("studioAssetReleaseUsageObservations", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        runId: args.runId,
        certificateFingerprint: args.certificateFingerprint,
        usageReceiptFingerprint: usage.receiptFingerprint,
        assetEntryFingerprint: use.assetEntryFingerprint,
        moduleId: use.moduleId,
        family: usage.family,
        contentLane: usage.contentLane,
        treatment: usage.treatment,
        finalMasterSha256: usage.finalMaster.sha256,
        visualScore: usage.quality.visualScore,
        visualMinimumScore: usage.quality.visualMinimumScore,
        usage,
        createdAt: Date.now(),
      }));
    }
    return ids;
  },
});

/**
 * Service-only resolver used before any new recipe or control material is
 * created.  A no-match is a deliberate signal to create/promote something;
 * it is never a permission to use another channel's asset.
 */
export const resolveForPipeline = query({
  args: {
    ownerId: v.string(),
    request: v.any(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library pipeline resolution");
    const request = StudioAssetResolveRequestSchema.parse({ ...args.request, ownerId: args.ownerId });
    const rows = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const observations = await ctx.db
      .query("studioAssetReleaseUsageObservations")
      .withIndex("by_owner_context", (q) =>
        q
          .eq("ownerId", args.ownerId)
          .eq("family", request.family)
          .eq("contentLane", request.contentLane)
          .eq("moduleId", request.moduleId),
      )
      .collect();
    return resolveStudioAssetLibrary({
      request,
      entries: currentEntries(rows as AssetRow[]),
      releaseUsageReceipts: observations.map((observation) => observation.usage),
    });
  },
});
