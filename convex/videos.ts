import { mutation, query } from "./studioFunctions";
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
async function currentLibraryThumbnail(
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
    .withIndex("by_channel_thumbnail_refresh_source", (q) => q
      .eq("channelId", input.channelId)
      .eq("thumbnailRefreshSourceRunId", input.runId))
    .collect();
  const refreshCandidates = await Promise.all(refreshRuns.map(async (candidate) => {
    const candidateThumbnail = (await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", candidate._id))
      .collect())
      .find((asset) => asset.kind === "thumbnail");
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
    const needle = args.search?.trim().toLowerCase() ?? "";

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

    // Channel-name cache so we join each channel at most once.
    const channelCache = new Map<
      string,
      { name: string; slug: string; family?: string; contentLane?: unknown } | null
    >();
    const getChannel = async (channelId: Id<"channels">) => {
      const key = channelId as string;
      if (channelCache.has(key)) return channelCache.get(key)!;
      const ch = await ctx.db.get(channelId);
      const val = ch
        ? {
            name: ch.name,
            slug: ch.slug,
            family: ch.family,
            contentLane: ch.contentLane,
          }
        : null;
      channelCache.set(key, val);
      return val;
    };

    const rows: Array<Record<string, unknown>> = [];

    for await (const run of source) {
      if (rows.length >= limit) break;
      // Tenancy guard when reading the channel index.
      if (run.ownerId !== args.ownerId) continue;
      const libraryState = run.libraryState ?? "active";
      if (!args.includeArchived && libraryState === "archived") continue;
      // Server-side status filter.
      if (args.status && run.status !== args.status) continue;

      // Pull this run's assets once. A final master with recorded release
      // evidence is selected below from the sealed certificate reference,
      // rather than by whichever `video` asset happened to be inserted first.
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();

      const fallbackVideoAsset = assets.find((a) => a.kind === "video");
      const thumbAsset = assets.find((a) => a.kind === "thumbnail");
      const storedReleaseEvidenceStatus = normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus);
      const sealedMasterKey = storedReleaseEvidenceStatus === "release_evidence_recorded"
        ? await recordedMasterKey(ctx, run._id)
        : undefined;
      // A stored status is a cached projection. If the artifacts no longer
      // reproduce it, downgrade the presentation and retain the legacy asset
      // fallback without pretending that it is the approved master.
      const releaseEvidenceStatus =
        storedReleaseEvidenceStatus === "release_evidence_recorded" && !sealedMasterKey
          ? "evidence_incomplete"
          : storedReleaseEvidenceStatus;
      const videoAsset = sealedMasterKey
        ? assets.find((asset) => asset.kind === "video" && asset.r2Key === sealedMasterKey) ?? fallbackVideoAsset
        : fallbackVideoAsset;
      const videoKey = sealedMasterKey ?? fallbackVideoAsset?.r2Key ?? null;

      // A shippable video = published (youtubeVideoId) OR a rendered video from
      // a run that did NOT fail. A FAILED run that only left an intermediate
      // video asset (e.g. died at qa_visual after the engine uploaded a draft
      // key) is a stranded orphan, not a video — it used to clutter the Library
      // with duplicate rows (3 rows for 1 usable video). Published runs always
      // show regardless of status.
      const isFinished =
        Boolean(run.youtubeVideoId) || (Boolean(videoKey) && run.status !== "failed");
      if (!isFinished) continue;

      const channel = await getChannel(run.channelId);

      // The REAL title/SEO live in the `metadata` stage outputs (they were
      // previously stranded there — asset meta rarely carries a title).
      const mOut = await metadataOutputs(ctx, run._id);
      const vMeta = (videoAsset?.meta ?? {}) as Record<string, unknown>;
      const tMeta = (thumbAsset?.meta ?? {}) as Record<string, unknown>;
      const title =
        (typeof mOut.title === "string" && mOut.title) ||
        (typeof vMeta.title === "string" && vMeta.title) ||
        (typeof tMeta.thumbnailTitle === "string" && tMeta.thumbnailTitle) ||
        (typeof tMeta.title === "string" && tMeta.title) ||
        (channel?.name ?? "Untitled video");

      // Optional title search — must run BEFORE the row counts toward `limit`.
      if (needle && !String(title).toLowerCase().includes(needle)) continue;

      const description =
        typeof mOut.description === "string"
          ? mOut.description.slice(0, 400)
          : undefined;
      const tags = Array.isArray(mOut.tags)
        ? (mOut.tags.filter((t) => typeof t === "string") as string[]).slice(0, 20)
        : undefined;

      // Optional duration from either asset's meta.
      const durationSec =
        typeof vMeta.durationSec === "number"
          ? (vMeta.durationSec as number)
          : typeof vMeta.duration === "number"
            ? (vMeta.duration as number)
            : undefined;

      // Estimated views: metadata stage first, legacy run fields as fallback.
      const runAny = run as unknown as Record<string, unknown>;
      const estimatedViews =
        typeof mOut.estimatedViews === "number"
          ? (mOut.estimatedViews as number)
          : typeof runAny.estimatedViews === "number"
            ? (runAny.estimatedViews as number)
            : undefined;
      const estimatedViewsSource =
        typeof mOut.estimatedViewsSource === "string"
          ? (mOut.estimatedViewsSource as string)
          : typeof runAny.estimatedViewsSource === "string"
            ? (runAny.estimatedViewsSource as string)
            : undefined;

      const thumbnail = await currentLibraryThumbnail(ctx, {
        ownerId: args.ownerId,
        runId: run._id,
        channelId: run.channelId,
        channel,
        sourceThumbnail: thumbAsset,
        sourceVideoKey: videoKey,
      });

      rows.push({
        _id: run._id,
        status: run.status,
        // Execution completion and master provenance are deliberately distinct.
        // Historical rows without a retained certificate remain visible, but
        // must never inherit an implicit quality claim from their `ok` status.
        releaseEvidenceStatus,
        createdAt: run.startedAt ?? run._creationTime,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        youtubeVideoId: run.youtubeVideoId,
        libraryState,
        libraryStateUpdatedAt: run.libraryStateUpdatedAt,
        // Fold the private-draft watch URL into the row so the Library can link
        // straight to the uploaded draft (it used to be stranded in the
        // upload_draft stage outputs, never surfaced to the UI).
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
          typeof tMeta.thumbnailTitle === "string"
            ? (tMeta.thumbnailTitle as string)
            : undefined,
        visualRationale:
          typeof tMeta.visualRationale === "string"
            ? (tMeta.visualRationale as string)
            : undefined,
        estimatedViews,
        estimatedViewsSource,
        durationSec,
      });
    }

    // Newest first (startedAt can drift a hair from _creationTime).
    rows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
    return rows;
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
