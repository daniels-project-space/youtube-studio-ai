import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { query } from "./studioFunctions";
import {
  assessThumbnailRefreshEvidence,
  type ThumbnailRefreshAsset,
} from "../src/lib/thumbnailRefreshInventory";
import { assessThumbnailRefreshReplay } from "../src/lib/thumbnailRefreshReplay";
import { normalizeReleaseEvidenceStatus } from "../src/lib/releaseEvidenceStatus";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Read-only inventory for the first, safe stage of a legacy thumbnail refresh.
 *
 * It neither creates a candidate nor records an owner acceptance. The only
 * decision it makes is whether the persisted thumbnail has an exact, run-bound
 * current-Golden provenance marker. Release-evidence status is returned as
 * adjacent context only; a final-master certificate never upgrades thumbnail
 * provenance.
 */
export const listInventory = query({
  args: {
    ownerId: v.string(),
    channelId: v.optional(v.id("channels")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 300));
    const source = args.channelId
      ? ctx.db
          .query("runs")
          .withIndex("by_channel", (q) => q.eq("channelId", args.channelId!))
          .order("desc")
      : ctx.db
          .query("runs")
          .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
          .order("desc");

    const channels = new Map<string, { name: string; slug: string } | null>();
    const channelFor = async (channelId: Id<"channels">) => {
      const cacheKey = String(channelId);
      if (channels.has(cacheKey)) return channels.get(cacheKey)!;
      const channel = await ctx.db.get(channelId);
      const value = channel ? { name: channel.name, slug: channel.slug } : null;
      channels.set(cacheKey, value);
      return value;
    };

    const rows: Array<Record<string, unknown>> = [];
    for await (const run of source) {
      if (rows.length >= limit) break;
      if (run.ownerId !== args.ownerId) continue;

      const assets = await ctx.db
        .query("assets")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      const videoAsset = assets.find((asset) => asset.kind === "video");
      const isFinished = Boolean(run.youtubeVideoId) ||
        (Boolean(videoAsset) && run.status !== "failed");
      if (!isFinished) continue;

      // Keep selection aligned with the Studio's existing video query. This
      // inventory reports provenance for the thumbnail users currently see;
      // it does not choose a newer asset or silently replace anything.
      const thumbnail = assets.find((asset) => asset.kind === "thumbnail");
      const assessment = assessThumbnailRefreshEvidence(
        thumbnail
          ? {
              ownerId: thumbnail.ownerId,
              channelId: String(thumbnail.channelId),
              runId: thumbnail.runId ? String(thumbnail.runId) : undefined,
              kind: thumbnail.kind,
              r2Key: thumbnail.r2Key,
              meta: thumbnail.meta,
            } satisfies ThumbnailRefreshAsset
          : null,
      );

      const [channel, stages] = await Promise.all([
        channelFor(run.channelId),
        ctx.db
          .query("runStages")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect(),
      ]);
      const metadataStage = stages.find((stage) => stage.block === "metadata" || stage.block === "quiz_metadata");
      const metadata = record(metadataStage?.outputs);
      const thumbnailMeta = record(thumbnail?.meta);
      const title =
        text(metadata?.title) ??
        text(thumbnailMeta?.thumbnailTitle) ??
        text(thumbnailMeta?.title) ??
        channel?.name ??
        "Untitled video";

      rows.push({
        runId: run._id,
        channelId: run.channelId,
        channelName: channel?.name ?? "(unknown)",
        channelSlug: channel?.slug ?? "",
        title,
        createdAt: run.startedAt ?? run._creationTime,
        status: run.status,
        youtubeVideoId: run.youtubeVideoId,
        thumbnailKey: thumbnail?.r2Key ?? null,
        thumbnailEvidenceStatus: assessment.status,
        refreshAction: assessment.action,
        evidenceReason: assessment.reason,
        // Deliberately adjacent rather than part of `assessment`: release
        // proof is evidence for the video master, never a thumbnail upgrade.
        releaseEvidenceStatus: normalizeReleaseEvidenceStatus(run.releaseEvidenceStatus),
        // A legacy thumbnail may be regenerated only from the same frozen
        // package/route/style inputs. Never use the current channel config to
        // make a deceptive "refresh" for a historic video.
        ...(() => {
          const replay = assessThumbnailRefreshReplay({
            ownerId: args.ownerId,
            channelId: String(run.channelId),
            runId: String(run._id),
            pipelineInvocationSnapshot: run.pipelineInvocationSnapshot,
            stages: stages.map((stage) => ({ block: stage.block, outputs: stage.outputs })),
          });
          return {
            thumbnailReplayStatus: replay.status,
            thumbnailReplayReason: replay.reason,
          };
        })(),
      });
    }

    rows.sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return rows;
  },
});
