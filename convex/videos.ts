import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  normalizeReleaseEvidenceStatus,
  recordedReleaseEvidenceMasterKey,
} from "../src/lib/releaseEvidenceStatus";
import {
  isLofiChannel,
  selectLofiLibraryThumbnail,
} from "../src/lib/lofiLibraryThumbnail";
import { selectLatestCurrentGoldenThumbnail } from "../src/lib/thumbnailRefreshInventory";
import { summarizeLibraryStates } from "../src/lib/librarySummary";
import { createBulkUndoReceipt } from "../src/lib/automaticWorkflow";
import {
  LIBRARY_PAGE_LIMIT,
  validatedReadLimit,
} from "../src/lib/boundedConvexReads";
import {
  libraryRunCreatedAt,
  matchesLibraryRunScope,
  matchesLibraryTitle,
  type LibraryRunScope,
} from "../src/lib/libraryProjection";

/**
 * Finished-videos library (Tranche 4).
 *
 * A "finished" video = a run that has either a `youtubeVideoId` (published) OR
 * at least one asset of `kind === "video"` (rendered, maybe not yet uploaded).
 *
 * Each row is enriched for the client so the Library page can render a card +
 * lightbox without any further round-trips:
 *   - channelName / channelSlug   (join the channels table)
 *   - youtubeVideoId              (free YouTube thumb + embed when present)
 *   - thumbnailKey                (r2Key of the run's `kind === "thumbnail"`
 *                                  asset — the client presigns it via the
 *                                  /api/asset-url route; null when absent)
 *   - videoKey                    (r2Key of the run's `kind === "video"` asset
 *                                  — used by the lightbox <video> fallback)
 *   - title                       (REAL SEO title from the `metadata` runStage,
 *                                  falling back to asset meta → channel name)
 *   - description / tags          (metadata runStage outputs, trimmed for the
 *                                  list payload — full text via getVideoDetail)
 *   - thumbnailTitle / visualRationale  (claude_flux thumbnail intelligence,
 *                                  surfaced in the lightbox detail)
 *   - estimatedViews / estimatedViewsSource  (metadata stage, run fallback)
 *   - durationSec                 (when present on an asset/run meta)
 *   - createdAt / status
 *
 * Newest first. Streams the runs index in desc order and STOPS once `limit`
 * finished rows are found — the old shape collected EVERY owner run (the 16MB
 * query problem) before filtering.
 */

/** The `metadata` block's persisted stage outputs for a run (or {}). */
async function metadataOutputs(
  ctx: QueryCtx,
  runId: Id<"runs">,
): Promise<Record<string, unknown>> {
  const stage = await ctx.db
    .query("runStages")
    .withIndex("by_run_block", (q) => q.eq("runId", runId).eq("block", "metadata"))
    .first();
  const out = stage?.outputs;
  return out && typeof out === "object" ? (out as Record<string, unknown>) : {};
}

/**
 * The asset table can retain several intermediate `video` objects for a run.
 * Re-evaluate the compact QA lineage before using the certificate's master as
 * a Library playback source; an old or malformed green status must not select
 * an arbitrary first asset as though it were approved.
 */
async function recordedMasterKey(
  ctx: QueryCtx,
  runId: Id<"runs">,
): Promise<string | undefined> {
  const [qaStage, artifacts] = await Promise.all([
    ctx.db
      .query("runStages")
      .withIndex("by_run_block", (q) => q.eq("runId", runId).eq("block", "qa_visual"))
      .first(),
    ctx.db
      .query("runArtifacts")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect(),
  ]);
  return recordedReleaseEvidenceMasterKey({
    runId,
    qaStage: qaStage ? { status: qaStage.status, outputs: qaStage.outputs } : null,
    artifacts,
  });
}

type LibraryChannelIdentity = { family?: unknown; contentLane?: unknown } | null;

/**
 * Resolve sibling thumbnail candidates once and apply the channel-specific
 * presentation contract. A completed, evidence-bound candidate supersedes the
 * legacy source thumbnail in Studio immediately; no browser approval state is
 * part of this read path.
 */
export async function currentLibraryThumbnail(
  ctx: QueryCtx,
  input: {
    ownerId: string;
    runId: Id<"runs">;
    channelId: Id<"channels">;
    channel: LibraryChannelIdentity;
    sourceThumbnail?: Doc<"assets">;
    sourceVideoKey: string | null;
  },
): Promise<{
  key: string | null;
  presentation?: "current_golden_candidate" | "lofi_rendered_frame" | "lofi_frame_pending";
}> {
  const refreshRuns = await ctx.db
    .query("runs")
    .withIndex("by_channel_status_thumbnail_refresh_source", (q) => q
      .eq("channelId", input.channelId)
      .eq("status", "ok")
      .eq("thumbnailRefreshSourceRunId", input.runId))
    .collect();
  const refreshCandidates = await Promise.all(refreshRuns.map(async (candidate) => {
    const candidateThumbnail = (await ctx.db
      .query("assets")
      .withIndex("by_run_kind", (q) => q.eq("runId", candidate._id).eq("kind", "thumbnail"))
      .first());
    return {
      status: candidate.status,
      finishedAt: candidate.finishedAt,
      startedAt: candidate.startedAt,
      thumbnail: candidateThumbnail
        ? {
            ownerId: candidateThumbnail.ownerId,
            channelId: String(candidateThumbnail.channelId),
            runId: String(candidate._id),
            kind: candidateThumbnail.kind,
            r2Key: candidateThumbnail.r2Key,
            meta: candidateThumbnail.meta,
          }
        : null,
    };
  }));

  if (isLofiChannel(input.channel ?? {})) {
    const exactFrame = selectLofiLibraryThumbnail({
      ownerId: input.ownerId,
      channelId: String(input.channelId),
      sourceVideoKey: input.sourceVideoKey,
      sourceThumbnail: input.sourceThumbnail
        ? {
            runId: String(input.runId),
            r2Key: input.sourceThumbnail.r2Key,
            meta: input.sourceThumbnail.meta,
          }
        : null,
      refreshCandidates,
    });
    return exactFrame
      ? { key: exactFrame.r2Key, presentation: "lofi_rendered_frame" }
      : { key: null, presentation: "lofi_frame_pending" };
  }

  const current = selectLatestCurrentGoldenThumbnail({
    ownerId: input.ownerId,
    channelId: String(input.channelId),
    candidates: refreshCandidates,
  });
  return current
    ? { key: current.r2Key, presentation: "current_golden_candidate" }
    : { key: input.sourceThumbnail?.r2Key ?? null };
}

/**
 * The exact retained-media boundary shared by the run workbench and the full
 * Library lightbox. Keep original asset records intact; current packaging is
 * a separate projection using the same master/provenance/Lo-Fi rules.
 */
async function retainedRunMedia(ctx: QueryCtx, run: Doc<"runs">) {
  const [assets, channel, sealedMasterKey] = await Promise.all([
    ctx.db.query("assets").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
    ctx.db.get(run.channelId),
    normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus) === "release_evidence_recorded"
      ? recordedMasterKey(ctx, run._id)
      : Promise.resolve(undefined),
  ]);
  const fallbackVideoAsset = assets.find((asset) => asset.kind === "video");
  const videoAsset = sealedMasterKey
    ? assets.find((asset) => asset.kind === "video" && asset.r2Key === sealedMasterKey) ?? fallbackVideoAsset
    : fallbackVideoAsset;
  const thumbAsset = assets.find((asset) => asset.kind === "thumbnail");
  const videoKey = sealedMasterKey ?? fallbackVideoAsset?.r2Key ?? null;
  const thumbnail = await currentLibraryThumbnail(ctx, {
    ownerId: run.ownerId,
    runId: run._id,
    channelId: run.channelId,
    channel,
    sourceThumbnail: thumbAsset,
    sourceVideoKey: videoKey,
  });
  return {
    assets,
    channel,
    videoAsset,
    thumbAsset,
    currentThumbnail: {
      thumbnailKey: thumbnail.key,
      ...(thumbnail.presentation ? { thumbnailPresentation: thumbnail.presentation } : {}),
      videoKey,
    },
  };
}

/**
 * Project the current packaging thumbnail for a scheduled run.  Plan rows are
 * intentionally immutable editorial inputs, but a run may later receive a
 * reviewed thumbnail successor (or the exact Lo-Fi source frame).  Channel
 * schedule surfaces must read that same projection as Library and the run
 * workbench instead of resurrecting the plan-time key.
 */
export async function currentLibraryThumbnailForRun(
  ctx: QueryCtx,
  run: Doc<"runs">,
): Promise<Awaited<ReturnType<typeof currentLibraryThumbnail>>> {
  const { currentThumbnail } = await retainedRunMedia(ctx, run);
  return {
    key: currentThumbnail.thumbnailKey,
    ...(currentThumbnail.thumbnailPresentation
      ? { presentation: currentThumbnail.thumbnailPresentation }
      : {}),
  };
}

/**
 * One reactive read for the run page's media and current packaging. Script
 * and SEO remain in the on-demand lightbox query, not every thumbnail view.
 */
export const getRunMediaPresentation = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const { assets, currentThumbnail } = await retainedRunMedia(ctx, run);
    return { assets, currentThumbnail };
  },
});

/**
 * Small title-only history projection for the metadata module.
 *
 * `listVideos` is intentionally rich: it resolves masters, thumbnails and
 * playback state for the Library. Title generation needs none of that. Keeping
 * this read owner- and channel-scoped avoids paying those joins merely to stop
 * a new episode from reusing an already released or queued title.
 */
export const listRecentChannelTitles = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    limit: v.optional(v.number()),
    excludePlanItemId: v.optional(v.id("contentPlan")),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) return [];
    const limit = Math.min(32, Math.max(1, Math.floor(args.limit ?? 16)));
    const seen = new Set<string>();
    const titles: string[] = [];
    const add = (value: unknown) => {
      if (typeof value !== "string") return;
      const title = value.trim();
      if (!title) return;
      const key = title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return;
      seen.add(key);
      titles.push(title);
    };

    // Upcoming rows are already authored titles, so include them before a
    // model proposes another episode. Used rows are represented by their run
    // receipt below and must not crowd out a current queue item.
    const [readyPlans, generatingPlans] = await Promise.all([
      ctx.db
        .query("contentPlan")
        .withIndex("by_channel_status_order", (q) => q.eq("channelId", args.channelId).eq("status", "ready"))
        .order("desc")
        .take(limit),
      ctx.db
        .query("contentPlan")
        .withIndex("by_channel_status_order", (q) => q.eq("channelId", args.channelId).eq("status", "generating"))
        .order("desc")
        .take(limit),
    ]);
    for (const item of [...readyPlans, ...generatingPlans].sort((left, right) => right.order - left.order)) {
      if (item._id === args.excludePlanItemId) continue;
      add(item.title);
    }

    // Scan a bounded multiple because historic/failed runs often have no
    // accepted metadata title. This remains title-only; no asset, master or
    // thumbnail joins are permitted on this hot path.
    const maxRunScan = limit * 4;
    let scanned = 0;
    const runs = ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc");
    for await (const run of runs) {
      if (titles.length >= limit || scanned >= maxRunScan) break;
      scanned++;
      if (run.ownerId !== args.ownerId || run.status === "failed") continue;
      const metadata = await metadataOutputs(ctx, run._id);
      add(metadata.title);
    }
    return titles.slice(0, limit);
  },
});

type LibraryVideoFilters = LibraryRunScope & {
  search?: string;
};

type LibraryChannel = {
  name: string;
  slug: string;
  family?: string;
  contentLane?: unknown;
};

/**
 * One evidence-preserving card projection for the cursor page (kept separate
 * from the legacy list until its startedAt ordering is retired). Run-level
 * filters happen before media joins;
 * title search happens only after the canonical metadata title is known.
 */
async function projectLibraryVideo(
  ctx: QueryCtx,
  run: Doc<"runs">,
  filters: LibraryVideoFilters,
  channelCache: Map<string, Promise<LibraryChannel | null>>,
): Promise<Record<string, unknown> | null> {
  if (!matchesLibraryRunScope(run, filters)) return null;

  const getChannel = async (channelId: Id<"channels">) => {
    const key = channelId as string;
    const cached = channelCache.get(key);
    if (cached) return cached;
    const pending = ctx.db.get(channelId).then((ch) => ch
      ? { name: ch.name, slug: ch.slug, family: ch.family, contentLane: ch.contentLane }
      : null);
    channelCache.set(key, pending);
    return pending;
  };

  const [videoAssets, thumbAsset] = await Promise.all([
    ctx.db
      .query("assets")
      .withIndex("by_run_kind", (q) => q.eq("runId", run._id).eq("kind", "video"))
      .collect(),
    ctx.db
      .query("assets")
      .withIndex("by_run_kind", (q) => q.eq("runId", run._id).eq("kind", "thumbnail"))
      .first()
      .then((asset) => asset ?? undefined),
  ]);

  const fallbackVideoAsset = videoAssets[0];
  const storedReleaseEvidenceStatus = normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus);
  const sealedMasterKey = storedReleaseEvidenceStatus === "release_evidence_recorded"
    ? await recordedMasterKey(ctx, run._id)
    : undefined;
  const releaseEvidenceStatus =
    storedReleaseEvidenceStatus === "release_evidence_recorded" && !sealedMasterKey
      ? "evidence_incomplete"
      : storedReleaseEvidenceStatus;
  const videoAsset = sealedMasterKey
    ? videoAssets.find((asset) => asset.r2Key === sealedMasterKey) ?? fallbackVideoAsset
    : fallbackVideoAsset;
  const videoKey = sealedMasterKey ?? fallbackVideoAsset?.r2Key ?? null;

  const isFinished =
    Boolean(run.youtubeVideoId) || (Boolean(videoKey) && run.status !== "failed");
  if (!isFinished) return null;

  const [channel, mOut] = await Promise.all([
    getChannel(run.channelId),
    metadataOutputs(ctx, run._id),
  ]);
  const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
  const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;
  const title =
    (typeof mOut.title === "string" && mOut.title) ||
    (typeof vMeta.title === "string" && vMeta.title) ||
    (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
    (typeof tMeta.title === "string" && tMeta.title) ||
    (channel?.name ?? "Untitled video");
  if (!matchesLibraryTitle(String(title), filters.search)) return null;

  const description = typeof mOut.description === "string"
    ? mOut.description.slice(0, 400)
    : undefined;
  const tags = Array.isArray(mOut.tags)
    ? (mOut.tags.filter((tag) => typeof tag === "string") as string[]).slice(0, 20)
    : undefined;
  const durationSec =
    typeof vMeta.durationSec === "number"
      ? vMeta.durationSec
      : typeof vMeta.duration === "number"
        ? vMeta.duration
        : undefined;
  const runAny = run as unknown as Record<string, unknown>;
  const estimatedViews =
    typeof mOut.estimatedViews === "number"
      ? mOut.estimatedViews
      : typeof runAny.estimatedViews === "number"
        ? runAny.estimatedViews
        : undefined;
  const estimatedViewsSource =
    typeof mOut.estimatedViewsSource === "string"
      ? mOut.estimatedViewsSource
      : typeof runAny.estimatedViewsSource === "string"
        ? runAny.estimatedViewsSource
        : undefined;

  const thumbnail = await currentLibraryThumbnail(ctx, {
    ownerId: filters.ownerId,
    runId: run._id,
    channelId: run.channelId,
    channel,
    sourceThumbnail: thumbAsset,
    sourceVideoKey: videoKey,
  });

  return {
    _id: run._id,
    status: run.status,
    releaseEvidenceStatus,
    createdAt: libraryRunCreatedAt(run),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    youtubeVideoId: run.youtubeVideoId,
    libraryState: run.libraryState ?? "active",
    libraryStateUpdatedAt: run.libraryStateUpdatedAt,
    watchUrl: run.youtubeVideoId
      ? `https://www.youtube.com/watch?v=${run.youtubeVideoId}`
      : undefined,
    channelId: run.channelId,
    channelName: channel?.name ?? "(unknown)",
    channelSlug: channel?.slug ?? "",
    title: title as string,
    description,
    tags,
    thumbnailKey: thumbnail.key,
    ...(thumbnail.presentation ? { thumbnailPresentation: thumbnail.presentation } : {}),
    videoKey,
    thumbnailTitle:
      typeof tMeta.thumbnailTitle === "string" ? tMeta.thumbnailTitle : undefined,
    visualRationale:
      typeof tMeta.visualRationale === "string" ? tMeta.visualRationale : undefined,
    estimatedViews,
    estimatedViewsSource,
    durationSec,
  };
}

export const listVideos = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Bound the scan even when the caller passes no limit (all current
    // callers do); early termination below keeps the common case cheap.
    const limit = args.limit ?? 200;
    // Narrowest index first: by_channel when filtered, else by_owner. desc =
    // newest _creationTime first (≈ startedAt order; runs stamp startedAt at
    // insert), so we can stop as soon as `limit` finished rows are collected.
    const source = args.channelId
      ? ctx.db
          .query("runs")
          .withIndex("by_channel", (q) => q.eq("channelId", args.channelId!))
          .order("desc")
      : ctx.db
          .query("runs")
          .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
          .order("desc");

    // Reuse the same evidence-preserving projection as the cursor endpoint so
    // the compatibility list cannot drift from the future paginated surface.
    const filters: LibraryVideoFilters = {
      ownerId: args.ownerId,
      status: args.status,
      search: args.search,
      includeArchived: args.includeArchived,
    };
    const channelCache = new Map<string, Promise<LibraryChannel | null>>();
    const rows: Array<Record<string, unknown>> = [];

    for await (const run of source) {
      if (rows.length >= limit) break;
      const projected = await projectLibraryVideo(ctx, run, filters, channelCache);
      if (projected) rows.push(projected);
    }

    // Newest first (startedAt can drift a hair from _creationTime).
    rows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
    return rows;
  },
});

/**
 * Cursor-backed Library projection.
 *
 * The cursor is over the owner/channel Library-order index, before expensive asset,
 * release-certificate, metadata, and thumbnail-candidate joins. Filters are
 * applied in the same order as the legacy projection, so an invalid/failed
 * run consumes cursor space but cannot crowd a finished card out of the
 * returned page forever. The indexed key is the historical displayed
 * `startedAt ?? _creationTime` value, filled on older rows by the bounded
 * service-only migration below.
 *
 * The UI can adopt this endpoint only after the migration-readiness check and
 * live tie-order comparison pass. Until then the existing list is retained.
 */
export const listVideosPage = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
    libraryState: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    order: v.optional(v.union(v.literal("date"), v.literal("oldest"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    validatedReadLimit(args.paginationOpts.numItems, LIBRARY_PAGE_LIMIT);
    for (const [label, value] of [["from", args.from], ["to", args.to]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`library ${label} timestamp is invalid`);
      }
    }
    if (args.from !== undefined && args.to !== undefined && args.from > args.to) {
      throw new Error("library date range is invalid");
    }

    // A partially migrated owner would interleave undefined keys with real
    // timestamps. Fail closed rather than returning a plausible wrong page.
    const missingOrder = await ctx.db
      .query("runs")
      .withIndex("by_owner_library_order", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("libraryOrderAt", undefined))
      .first();
    if (missingOrder) throw new Error("Library ordering migration is incomplete");

    const source = args.channelId
      ? ctx.db
          .query("runs")
          .withIndex("by_channel_library_order", (q) => q.eq("channelId", args.channelId!))
          .order(args.order === "oldest" ? "asc" : "desc")
      : ctx.db
          .query("runs")
          .withIndex("by_owner_library_order", (q) => q.eq("ownerId", args.ownerId))
          .order(args.order === "oldest" ? "asc" : "desc");
    const runPage = await source.paginate(args.paginationOpts);
    const filters: LibraryVideoFilters = {
      ownerId: args.ownerId,
      status: args.status,
      search: args.search,
      includeArchived: args.includeArchived,
      libraryState: args.libraryState,
      from: args.from,
      to: args.to,
    };
    const channelCache = new Map<string, Promise<LibraryChannel | null>>();
    const projected = await Promise.all(
      runPage.page.map((run) => projectLibraryVideo(ctx, run, filters, channelCache)),
    );
    // Index order is the cursor contract; sorting an individual page again
    // would let an item cross an unobserved page boundary.
    return {
      ...runPage,
      page: projected.filter((row): row is Record<string, unknown> => row !== null),
    };
  },
});

/**
 * Fill only missing Library presentation keys in bounded, idempotent waves.
 * The predicate index shrinks after each wave, so no long-lived migration
 * cursor can skip a row while concurrent inserts arrive with their own key.
 * This operation never touches execution timing or release evidence.
 */
export const backfillLibraryOrderPage = mutation({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Library order backfill");
    const batch = await ctx.db
      .query("runs")
      .withIndex("by_owner_library_order", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("libraryOrderAt", undefined))
      .take(65);
    const target = batch.slice(0, 64);
    await Promise.all(target.map((run) => ctx.db.patch(run._id, {
      libraryOrderAt: libraryRunCreatedAt(run),
    })));
    return { patched: target.length, hasMore: batch.length > target.length };
  },
});

/** Owner-scoped, indexed readiness check; no full-run collection. */
export const libraryOrderReady = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const missing = await ctx.db
      .query("runs")
      .withIndex("by_owner_library_order", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("libraryOrderAt", undefined))
      .first();
    return { ready: missing === null };
  },
});

/**
 * Exact collection badges for the Library. This intentionally avoids the
 * enriched card projection above: counts avoid per-run metadata, certificate,
 * thumbnail and Lo-Fi candidate joins and return only three numbers, while
 * listVideos remains bounded for browser payloads.
 */
export const librarySummary = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const [runs, videoAssets] = await Promise.all([
      ctx.db
        .query("runs")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_owner_kind", (q) => q.eq("ownerId", args.ownerId).eq("kind", "video"))
        .collect(),
    ]);
    const videoRunIds = new Set(
      videoAssets.flatMap((asset) => asset.runId ? [String(asset.runId)] : []),
    );
    return summarizeLibraryStates(
      runs.map((run) => ({
        id: String(run._id),
        status: run.status,
        youtubeVideoId: run.youtubeVideoId,
        libraryState: run.libraryState,
      })),
      videoRunIds,
    );
  },
});

/**
 * Reversible Library organization. Archiving changes only presentation state;
 * retained masters, evidence, costs, run history, and YouTube records remain
 * untouched and the same mutation restores the row.
 */
export const setLibraryState = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    state: v.union(v.literal("active"), v.literal("archived")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) return null;
    await ctx.db.patch(run._id, {
      libraryState: args.state,
      libraryStateUpdatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Automatic-friendly bulk organization. The receipt stores the exact prior
 * state for every run, so a lost browser response or a later Undo can never
 * guess what the operator's library looked like before the action.
 */
export const applyBulkLibraryState = mutation({
  args: {
    ownerId: v.string(),
    runIds: v.array(v.id("runs")),
    state: v.union(v.literal("active"), v.literal("archived")),
    actionKey: v.string(),
  },
  returns: v.object({
    actionId: v.id("libraryActionReceipts"),
    reused: v.boolean(),
    state: v.union(v.literal("active"), v.literal("undone")),
  }),
  handler: async (ctx, args) => {
    const ids = [...new Set(args.runIds.map(String))];
    if (ids.length === 0 || ids.length > 100 || ids.length !== args.runIds.length) throw new Error("bulk library action must contain 1 to 100 unique runs");
    const actionKey = args.actionKey.trim();
    if (!actionKey || actionKey.length > 160) throw new Error("bulk library action key is invalid");
    const existing = await ctx.db.query("libraryActionReceipts")
      .withIndex("by_owner_action", (q) => q.eq("ownerId", args.ownerId).eq("actionKey", actionKey))
      .unique();
    if (existing) {
      if (existing.nextState !== args.state || existing.runIds.map(String).sort().join(",") !== [...ids].sort().join(",")) {
        throw new Error("bulk library action key was reused with different targets");
      }
      return { actionId: existing._id, reused: true, state: existing.status };
    }
    const runs = await Promise.all(args.runIds.map((id) => ctx.db.get(id)));
    if (runs.some((run) => !run || run.ownerId !== args.ownerId)) throw new Error("bulk library action ownership mismatch");
    const previousStates = runs.map((run) => ({ runId: run!._id, state: (run!.libraryState ?? "active") as "active" | "archived" }));
    const receipt = createBulkUndoReceipt({ actionKey, runIds: ids, previousStates: previousStates.map((row) => ({ runId: String(row.runId), state: row.state })), nextState: args.state });
    for (const run of runs) await ctx.db.patch(run!._id, { libraryState: args.state, libraryStateUpdatedAt: Date.now() });
    const actionId = await ctx.db.insert("libraryActionReceipts", {
      ownerId: args.ownerId,
      actionKey,
      fingerprint: receipt.fingerprint,
      runIds: args.runIds,
      previousStates,
      nextState: args.state,
      status: "active",
      createdAt: Date.now(),
    });
    return { actionId, reused: false, state: "active" as const };
  },
});

export const undoBulkLibraryState = mutation({
  args: { ownerId: v.string(), actionId: v.id("libraryActionReceipts") },
  returns: v.object({ reused: v.boolean(), state: v.union(v.literal("active"), v.literal("undone")) }),
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.actionId);
    if (!receipt || receipt.ownerId !== args.ownerId) throw new Error("bulk library action not found");
    if (receipt.status === "undone") return { reused: true, state: "undone" as const };
    const runs = await Promise.all(receipt.previousStates.map((row) => ctx.db.get(row.runId)));
    if (runs.some((run) => !run || run.ownerId !== args.ownerId)) throw new Error("bulk library undo ownership mismatch");
    for (const row of receipt.previousStates) {
      await ctx.db.patch(row.runId, { libraryState: row.state, libraryStateUpdatedAt: Date.now() });
    }
    await ctx.db.patch(receipt._id, { status: "undone", undoneAt: Date.now() });
    return { reused: false, state: "undone" as const };
  },
});

/**
 * On-demand detail for one finished run's lightbox: FULL description, tags,
 * and the narration script (stranded in runStages outputs until now). Small
 * targeted reads — one stage row per block via by_run_block.
 */
export const getVideoDetail = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;

    const stageOutputs = async (block: string) => {
      const stage = await ctx.db
        .query("runStages")
        .withIndex("by_run_block", (q) =>
          q.eq("runId", args.runId).eq("block", block),
        )
        .first();
      const out = stage?.outputs;
      return out && typeof out === "object"
        ? (out as Record<string, unknown>)
        : {};
    };

    const mOut = await stageOutputs("metadata");

    // Script text: script_gen first, then the self-contained narration engines.
    let script: string | null = null;
    for (const block of ["script_gen", "whiteboard_scribe", "motion_comic"]) {
      const out = await stageOutputs(block);
      if (typeof out.narrationText === "string" && out.narrationText.trim()) {
        script = out.narrationText;
        break;
      }
    }

    // The story-spine receipt is the canonical handoff for timed visual work.
    // Keep this projection deliberately small: the full prompts and continuity
    // ledger remain in the stage receipt, while the run page gets enough real
    // timing/content to verify that the scheduled package is actually usable.
    const spineOut = await stageOutputs("story_spine");
    const rawShotList = Array.isArray(spineOut.shotList) ? spineOut.shotList : [];
    const boundedText = (value: unknown, max = 180): string | null =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    const shotList = rawShotList.slice(0, 64).flatMap((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const shot = value as Record<string, unknown>;
      const t0 = typeof shot.t0 === "number" && Number.isFinite(shot.t0) ? shot.t0 : null;
      const t1 = typeof shot.t1 === "number" && Number.isFinite(shot.t1) ? shot.t1 : null;
      if (t0 === null || t1 === null || t1 <= t0) return [];
      return [{
        id: typeof shot.id === "string" && shot.id.trim() ? shot.id.trim().slice(0, 80) : `shot-${index + 1}`,
        t0,
        t1,
        coveragePurpose: boundedText(shot.coveragePurpose),
        literalContent: boundedText(shot.literalContent),
        cameraMove: boundedText(shot.cameraMove, 100),
        shotScale: boundedText(shot.shotScale, 80),
      }];
    });

    const { assets, videoAsset, thumbAsset, channel, currentThumbnail } = await retainedRunMedia(ctx, run);
    const subtitleAsset = assets.find((asset) => ["captions", "subtitle", "subtitles"].includes(asset.kind));
    const subtitleMeta = (subtitleAsset?.meta ?? {}) as Record<string, unknown>;
    const subtitleCueCount = typeof subtitleMeta.cues === "number" && Number.isFinite(subtitleMeta.cues)
      ? subtitleMeta.cues
      : null;
    const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
    const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;
    const title =
      (typeof mOut.title === "string" && mOut.title) ||
      (typeof vMeta.title === "string" && vMeta.title) ||
      (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
      (channel?.name ?? "Untitled video");

    return {
      title: title as string,
      description:
        typeof mOut.description === "string" ? mOut.description : null,
      tags: Array.isArray(mOut.tags)
        ? (mOut.tags.filter((t) => typeof t === "string") as string[])
        : [],
      script,
      ...currentThumbnail,
      estimatedViews:
        typeof mOut.estimatedViews === "number"
          ? (mOut.estimatedViews as number)
          : null,
      estimatedViewsSource:
        typeof mOut.estimatedViewsSource === "string"
          ? (mOut.estimatedViewsSource as string)
          : null,
      pinnedComment:
        typeof mOut.pinnedComment === "string" ? mOut.pinnedComment : null,
      titleAlternate:
        typeof mOut.titleAlternate === "string" ? mOut.titleAlternate : null,
      shotList,
      shotListCount: rawShotList.length,
      shotListTruncated: rawShotList.length > 64,
      subtitleSaved: Boolean(subtitleAsset),
      subtitleCueCount,
    };
  },
});
