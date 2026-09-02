import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  assessThumbnailRefreshEvidence,
  type ThumbnailRefreshAsset,
} from "../src/lib/thumbnailRefreshInventory";
import { thumbnailGatePassed, type ThumbnailGateVerdict } from "../src/engine/qualityPolicy";
import { assessThumbnailRefreshReplay } from "../src/lib/thumbnailRefreshReplay";
import { normalizeReleaseEvidenceStatus } from "../src/lib/releaseEvidenceStatus";
import { RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";
import {
  THUMBNAIL_REFRESH_DISPATCH_VERSION,
  THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
  thumbnailErnieBatchImportApprovalSubject,
  thumbnailRefreshDispatchKey,
} from "../src/lib/thumbnailRefreshCandidate";
import {
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "../src/lib/studioActionApproval";
import { assessLegacyVideoCleanup } from "../src/lib/legacyVideoCleanup";
import {
  assessThumbnailRefreshSuccessor,
  type ThumbnailRefreshSuccessorMaterial,
} from "../src/lib/thumbnailRefreshSuccessor";
import type { ThumbnailRefreshReplayMaterial } from "../src/lib/thumbnailRefreshReplay";

const MAX_DISPATCH_ATTEMPTS = 3;
type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function replayForRun(
  ctx: DbCtx,
  ownerId: string,
  run: {
    _id: Id<"runs">;
    channelId: Id<"channels">;
    pipelineInvocationSnapshot?: unknown;
    pipelineInvocationSha256?: string;
  },
) {
  const stages = await ctx.db
    .query("runStages")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  return {
    stages,
    replay: assessThumbnailRefreshReplay({
      ownerId,
      channelId: String(run.channelId),
      runId: String(run._id),
      pipelineInvocationSnapshot: run.pipelineInvocationSnapshot,
      pipelineInvocationSha256: run.pipelineInvocationSha256,
      stages: stages.map((stage) => ({ block: stage.block, outputs: stage.outputs })),
    }),
  };
}

type RefreshMaterial = ThumbnailRefreshReplayMaterial | ThumbnailRefreshSuccessorMaterial;

function assertThumbnailRefreshKeepSource(
  run: { status: string; youtubeVideoId?: string; releaseEvidenceStatus?: string },
  channel: Doc<"channels">,
  title: string,
) {
  const cleanup = assessLegacyVideoCleanup({
    youtubeVideoId: run.youtubeVideoId,
    runStatus: run.status,
    title,
    channelFamily:
      channel.family ??
      channel.contentLane?.family ??
      channel.identity.programBrief?.family,
    releaseEvidenceStatus: run.releaseEvidenceStatus,
  });
  if (cleanup.action !== "keep") {
    throw new Error("Retired legacy videos cannot purchase replacement thumbnails");
  }
}

function stageOutputText(
  stages: readonly { block: string; outputs?: unknown }[],
  blocks: readonly string[],
  key: string,
): string | undefined {
  const values = stages
    .filter((stage) => blocks.includes(stage.block))
    .map((stage) => text(record(stage.outputs)?.[key]))
    .filter((value): value is string => Boolean(value));
  return values.length === 1 ? values[0] : undefined;
}

async function refreshMaterialForRun(
  ctx: DbCtx,
  ownerId: string,
  run: {
    _id: Id<"runs">;
    channelId: Id<"channels">;
    pipelineInvocationSnapshot?: unknown;
    pipelineInvocationSha256?: string;
  },
  prefetched?: {
    channel?: Doc<"channels"> | null;
    assets?: Doc<"assets">[];
  },
): Promise<{
  status: "ready_for_thumbnail_only" | "ready_for_private_successor" | "private_successor_unavailable";
  reason: string;
  material?: RefreshMaterial;
  stages: Array<{ block: string; outputs?: unknown }>;
  title: string;
}> {
  const [{ stages, replay }, channel, assets] = await Promise.all([
    replayForRun(ctx, ownerId, run),
    prefetched?.channel !== undefined ? prefetched.channel : ctx.db.get(run.channelId),
    prefetched?.assets !== undefined
      ? prefetched.assets
      : ctx.db.query("assets").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
  ]);
  const metadataTitle = stageOutputText(stages, ["metadata", "quiz_metadata"], "title");
  const thumbnail = assets.find((asset) => asset.kind === "thumbnail");
  const thumbnailMeta = record(thumbnail?.meta);
  const title = metadataTitle ??
    text(thumbnailMeta?.thumbnailTitle) ??
    text(thumbnailMeta?.title) ??
    channel?.name ??
    "Untitled video";
  if (replay.status === "ready_for_thumbnail_only") {
    return {
      status: replay.status,
      reason: replay.reason,
      material: replay.material,
      stages,
      title,
    };
  }
  if (!channel || channel.ownerId !== ownerId) {
    return {
      status: "private_successor_unavailable",
      reason: "The retained video's channel is unavailable.",
      stages,
      title,
    };
  }
  const video = assets.find((asset) => asset.kind === "video");
  const successor = assessThumbnailRefreshSuccessor({
    ownerId,
    channelId: String(channel._id),
    runId: String(run._id),
    title,
    topic: stageOutputText(stages, ["topic_select", "quiz_topic_plan"], "topic"),
    sourceVideoKey: video?.r2Key,
    channel: {
      ownerId: channel.ownerId,
      channelId: String(channel._id),
      name: channel.name,
      status: channel.status,
      family: channel.family,
      contentLane: channel.contentLane,
      pipeline: channel.pipeline,
      styleDNA: channel.styleDNA,
      thumbnailPlaybook: channel.thumbnailPlaybook,
      identity: channel.identity,
    },
  });
  return {
    status: successor.status,
    reason: successor.reason,
    ...(successor.status === "ready_for_private_successor"
      ? { material: successor.material }
      : {}),
    stages,
    title,
  };
}

async function assertFinishedSource(
  ctx: DbCtx,
  run: { _id: Id<"runs">; status: string; youtubeVideoId?: string },
) {
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  const video = assets.find((asset) => asset.kind === "video");
  if (!run.youtubeVideoId && (!video || run.status === "failed")) {
    throw new Error("thumbnail refresh source is not a retained finished video");
  }
  return assets;
}

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("thumbnail refresh timestamp is invalid");
  }
}

function validR2Key(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,767}$/.test(value) && !value.includes("..");
}

function validErnieThumbnailQa(value: unknown): value is ThumbnailGateVerdict {
  if (!record(value)) return false;
  const verdict = value as Partial<ThumbnailGateVerdict>;
  return typeof verdict.textOk === "boolean" &&
    typeof verdict.faceClear === "boolean" &&
    Number.isFinite(verdict.punch) &&
    Number.isFinite(verdict.styleMatch) &&
    Number.isFinite(verdict.storyMatch) &&
    typeof verdict.uiClean === "boolean" &&
    typeof verdict.reason === "string" &&
    thumbnailGatePassed(verdict as ThumbnailGateVerdict);
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

    const channels = new Map<string, Doc<"channels"> | null>();
    const channelFor = async (channelId: Id<"channels">) => {
      const cacheKey = String(channelId);
      if (channels.has(cacheKey)) return channels.get(cacheKey)!;
      const channel = await ctx.db.get(channelId);
      channels.set(cacheKey, channel);
      return channel;
    };

    const rows: Array<Record<string, unknown>> = [];
    const candidates = new Map<string, Record<string, unknown>>();
    for await (const run of source) {
      if (rows.length >= limit) break;
      if (run.ownerId !== args.ownerId) continue;

      // Candidate runs are newer than their source and travel through the
      // same owner/channel index. Capture the latest candidate projection,
      // then keep it out of the finished-video inventory itself.
      if (run.thumbnailRefreshSourceRunId) {
        const sourceId = String(run.thumbnailRefreshSourceRunId);
        if (!candidates.has(sourceId)) candidates.set(sourceId, run as unknown as Record<string, unknown>);
        continue;
      }

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

      const channel = await channelFor(run.channelId);
      const refreshMaterial = await refreshMaterialForRun(ctx, args.ownerId, run, {
        channel,
        assets,
      });
      const title = refreshMaterial.title;
      const cleanup = assessLegacyVideoCleanup({
        youtubeVideoId: run.youtubeVideoId,
        runStatus: run.status,
        title,
        channelFamily:
          channel?.family ??
          channel?.contentLane?.family ??
          channel?.identity.programBrief?.family,
        releaseEvidenceStatus: run.releaseEvidenceStatus,
      });
      const retirement = cleanup.action === "retire" && run.youtubeVideoId
        ? await ctx.db
            .query("youtubeVideoRetirements")
            .withIndex("by_owner_video", (q) => q
              .eq("ownerId", args.ownerId)
              .eq("youtubeVideoId", run.youtubeVideoId!))
            .unique()
        : null;
      const candidate = candidates.get(String(run._id));
      const candidateAssets = candidate
        ? await ctx.db
            .query("assets")
            .withIndex("by_run", (q) => q.eq("runId", candidate._id as Id<"runs">))
            .collect()
        : [];
      const candidateThumbnail = candidateAssets.find((asset) => asset.kind === "thumbnail");
      const replacement = candidate
        ? await ctx.db
            .query("youtubeThumbnailReplacements")
            .withIndex("by_owner_candidate", (q) => q
              .eq("ownerId", args.ownerId)
              .eq("candidateRunId", candidate._id as Id<"runs">))
            .unique()
        : null;

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
        thumbnailReplayStatus: refreshMaterial.status,
        thumbnailReplayReason: refreshMaterial.reason,
        legacyCleanupAction: cleanup.action,
        legacyCleanupReason: cleanup.reason,
        legacyCleanupExplanation: cleanup.explanation,
        ...(retirement ? {
          retirementId: String(retirement._id),
          retirementStatus: retirement.status,
          retirementError: retirement.lastError,
          retirementReceiptFingerprint: retirement.deletionReceiptFingerprint,
        } : {}),
        ...(candidate ? {
          candidateRunId: String(candidate._id),
          candidateStatus: candidate.status,
          candidateDispatchState: candidate.thumbnailRefreshDispatchState,
          candidateDispatchLastError: candidate.thumbnailRefreshDispatchLastError,
          candidateCostTotal: candidate.costTotal,
          candidateThumbnailKey: candidateThumbnail?.r2Key ?? null,
        } : {}),
        ...(replacement ? {
          replacementId: String(replacement._id),
          replacementStatus: replacement.status,
          replacementError: replacement.lastError,
          replacementReceiptFingerprint: replacement.applicationReceiptFingerprint,
          replacementAppliedAt: replacement.appliedAt,
        } : {}),
      });
    }

    rows.sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return rows;
  },
});

/**
 * Allocate one idempotent no-video candidate run for the exact frozen source
 * replay. This mutation is service-only: a browser can express intent through
 * the authenticated API, but cannot manufacture replay material or an outbox.
 */
export const createCandidateShell = mutation({
  args: {
    ownerId: v.string(),
    sourceRunId: v.id("runs"),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh candidate shell");
    assertNow(args.now);
    const source = await ctx.db.get(args.sourceRunId);
    if (!source || source.ownerId !== args.ownerId || source.thumbnailRefreshSourceRunId) {
      throw new Error("thumbnail refresh source is not owned by this operator");
    }
    await assertFinishedSource(ctx, source);
    const refreshMaterial = await refreshMaterialForRun(ctx, args.ownerId, source);
    if (!refreshMaterial.material) throw new Error(refreshMaterial.reason);
    const sourceChannel = await ctx.db.get(source.channelId);
    if (!sourceChannel || sourceChannel.ownerId !== args.ownerId) {
      throw new Error("thumbnail refresh channel is unavailable");
    }
    assertThumbnailRefreshKeepSource(source, sourceChannel, refreshMaterial.title);
    const replayFingerprint = refreshMaterial.material.replayFingerprint;
    const dispatchKey = thumbnailRefreshDispatchKey({
      ownerId: args.ownerId,
      sourceRunId: String(source._id),
      replayFingerprint,
    });
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_source", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshSourceRunId", source._id)
        .eq("thumbnailRefreshReplayFingerprint", replayFingerprint))
      .unique();
    if (existing) {
      if (existing.channelId !== source.channelId || existing.thumbnailRefreshDispatchKey !== dispatchKey) {
        throw new Error("thumbnail refresh candidate identity conflict");
      }
      return {
        state: "reused",
        candidateRunId: existing._id,
        channelId: existing.channelId,
        sourceRunId: source._id,
        replayFingerprint,
        candidateStatus: existing.status,
        dispatchState: existing.thumbnailRefreshDispatchState,
      };
    }
    const candidateRunId = await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: source.channelId,
      status: "queued",
      startedAt: args.now,
      costTotal: 0,
      releaseEvidenceStatus: "not_ready",
      releaseEvidenceUpdatedAt: args.now,
      heartbeatAt: args.now,
      selfHealGeneration: 0,
      leaseExpiresAt: args.now + RUN_QUEUE_LEASE_MS,
      thumbnailRefreshSourceRunId: source._id,
      thumbnailRefreshReplayFingerprint: replayFingerprint,
      thumbnailRefreshDispatchKey: dispatchKey,
      thumbnailRefreshDispatchState: "awaiting_approval",
      thumbnailRefreshDispatchAttempts: 0,
      thumbnailRefreshDispatchUpdatedAt: args.now,
    });
    return {
      state: "created",
      candidateRunId,
      channelId: source.channelId,
      sourceRunId: source._id,
      replayFingerprint,
      candidateStatus: "queued",
      dispatchState: "awaiting_approval",
    };
  },
});

/**
 * Admit one ERNIE-Novita batch result as a private thumbnail candidate.
 *
 * This is intentionally not a shortcut around the refresh or YouTube flows:
 * the source remains unchanged, the final artifact must carry exact ERNIE and
 * typography provenance, QA must pass, and an immutable signed owner receipt
 * names this one candidate/artifact.  Applying it to YouTube remains the
 * separate `youtubeThumbnailReplacements` approval path.
 */
export const importErnieBatchCandidate = mutation({
  args: {
    ownerId: v.string(),
    sourceRunId: v.id("runs"),
    candidateRunId: v.id("runs"),
    r2Key: v.string(),
    evidence: v.any(),
    qa: v.any(),
    batchReceiptKey: v.string(),
    batchResultKey: v.string(),
    costTotal: v.number(),
    approval: v.any(),
    approvalFingerprint: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "ERNIE thumbnail batch candidate import");
    assertNow(args.now);
    if (
      !validR2Key(args.r2Key) ||
      !validR2Key(args.batchReceiptKey) ||
      !validR2Key(args.batchResultKey) ||
      !Number.isFinite(args.costTotal) || args.costTotal < 0 ||
      args.costTotal > THUMBNAIL_REFRESH_MAXIMUM_COST_USD ||
      !/^[a-f0-9]{64}$/.test(args.approvalFingerprint) ||
      !validErnieThumbnailQa(args.qa)
    ) throw new Error("ERNIE thumbnail batch import payload is invalid or did not pass production QA");
    const [source, candidate] = await Promise.all([
      ctx.db.get(args.sourceRunId),
      ctx.db.get(args.candidateRunId),
    ]);
    if (
      !source || source.ownerId !== args.ownerId ||
      !candidate || candidate.ownerId !== args.ownerId ||
      candidate.channelId !== source.channelId ||
      candidate.thumbnailRefreshSourceRunId !== source._id ||
      candidate.status !== "queued" ||
      candidate.thumbnailRefreshDispatchState !== "awaiting_approval" ||
      !candidate.thumbnailRefreshReplayFingerprint
    ) throw new Error("ERNIE thumbnail batch candidate/source binding is invalid or no longer importable");
    const channel = await ctx.db.get(candidate.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("ERNIE thumbnail batch candidate channel is unavailable");
    }
    const refreshMaterial = await refreshMaterialForRun(ctx, args.ownerId, source, { channel });
    if (
      !refreshMaterial.material ||
      refreshMaterial.material.replayFingerprint !== candidate.thumbnailRefreshReplayFingerprint
    ) throw new Error("ERNIE thumbnail batch source material changed after candidate allocation");
    assertThumbnailRefreshKeepSource(source, channel, refreshMaterial.title);
    // ERNIE owns the complete native thumbnail, including typography. Keep the
    // verified source PNG intact: this route never sends it through a local
    // title compositor or visual reinterpretation step.
    const expectedKey = `owner/${args.ownerId}/channel/${channel.slug}/runs/${candidate._id}/thumbnail.png`;
    if (args.r2Key !== expectedKey) {
      throw new Error("ERNIE thumbnail batch artifact key is not bound to this candidate run");
    }
    const assessment = assessThumbnailRefreshEvidence({
      ownerId: args.ownerId,
      channelId: String(channel._id),
      runId: String(candidate._id),
      kind: "thumbnail",
      r2Key: args.r2Key,
      meta: { thumbnailCurrentCandidateEvidence: args.evidence },
    } satisfies ThumbnailRefreshAsset);
    const proof = record(args.evidence);
    const artifactSha256 = typeof proof?.artifactSha256 === "string" ? proof.artifactSha256 : "";
    const providerRequestSha256 = typeof proof?.providerRequestSha256 === "string"
      ? proof.providerRequestSha256
      : "";
    const providerResponseSha256 = typeof proof?.providerResponseSha256 === "string"
      ? proof.providerResponseSha256
      : "";
    if (
      assessment.status !== "current_golden_candidate" ||
      proof?.providerRoute !== "ernie-image-novita-4090" ||
      !/^[a-f0-9]{64}$/.test(artifactSha256) ||
      !/^[a-f0-9]{64}$/.test(providerRequestSha256) ||
      !/^[a-f0-9]{64}$/.test(providerResponseSha256)
    ) throw new Error("ERNIE thumbnail batch evidence is not an admitted native ERNIE candidate");
    const approval = args.approval as StudioActionApprovalReceipt;
    const subject = thumbnailErnieBatchImportApprovalSubject({
      ownerId: args.ownerId,
      channelId: String(channel._id),
      sourceRunId: String(source._id),
      candidateRunId: String(candidate._id),
      replayFingerprint: candidate.thumbnailRefreshReplayFingerprint,
      r2Key: args.r2Key,
      artifactSha256,
      providerRequestSha256,
      providerResponseSha256,
    });
    if (
      studioActionApprovalFingerprint(approval) !== args.approvalFingerprint ||
      !verifyStudioActionApproval(approval, {
        action: "thumbnail-ernie-batch-import",
        ownerId: args.ownerId,
        subject,
        persistedReceiptFingerprint: args.approvalFingerprint,
      })
    ) throw new Error("ERNIE thumbnail batch import owner approval is invalid or changed");
    const existing = (await ctx.db
      .query("assets")
      .withIndex("by_run", (q) => q.eq("runId", candidate._id))
      .collect())
      .filter((asset) => asset.kind === "thumbnail");
    if (existing.length) throw new Error("ERNIE thumbnail batch candidate already has a thumbnail artifact");
    const assetId = await ctx.db.insert("assets", {
      ownerId: args.ownerId,
      channelId: channel._id,
      runId: candidate._id,
      kind: "thumbnail",
      r2Key: args.r2Key,
      meta: {
        strategy: "ernie_novita_batch",
        contentType: "image/png",
        thumbnailTitle: refreshMaterial.title,
        providerRoute: "ernie-image-novita-4090",
        providerRequestSha256,
        providerResponseSha256,
        batchReceiptKey: args.batchReceiptKey,
        batchResultKey: args.batchResultKey,
        qa: args.qa,
        thumbnailCurrentCandidateEvidence: args.evidence,
      },
    });
    await ctx.db.patch(candidate._id, {
      status: "ok",
      finishedAt: args.now,
      costTotal: args.costTotal,
      error: undefined,
      leaseExpiresAt: undefined,
      thumbnailRefreshDispatchState: "consumed",
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: undefined,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return { assetId, candidateRunId: candidate._id, status: "ok" };
  },
});

export const claimCandidateApproval = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    sourceRunId: v.id("runs"),
    candidateRunId: v.id("runs"),
    replayFingerprint: v.string(),
    maximumCostUsd: v.number(),
    approval: v.any(),
    approvalFingerprint: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh owner approval claim");
    assertNow(args.now);
    if (
      !/^[a-f0-9]{64}$/.test(args.replayFingerprint) ||
      !/^[a-f0-9]{64}$/.test(args.approvalFingerprint) ||
      !Number.isFinite(args.maximumCostUsd) ||
      args.maximumCostUsd <= 0 ||
      args.maximumCostUsd > THUMBNAIL_REFRESH_MAXIMUM_COST_USD
    ) {
      throw new Error("thumbnail refresh owner approval claim is invalid");
    }
    const run = await ctx.db.get(args.candidateRunId);
    if (
      !run ||
      run.ownerId !== args.ownerId ||
      run.channelId !== args.channelId ||
      run.thumbnailRefreshSourceRunId !== args.sourceRunId ||
      run.thumbnailRefreshReplayFingerprint !== args.replayFingerprint
    ) {
      throw new Error("thumbnail refresh candidate approval identity mismatch");
    }
    if (run.thumbnailRefreshApproval !== undefined) {
      if (
        run.thumbnailRefreshApprovalFingerprint !== args.approvalFingerprint ||
        run.thumbnailRefreshMaximumCostUsd !== args.maximumCostUsd
      ) {
        throw new Error("thumbnail refresh candidate is already bound to different authority");
      }
      return run;
    }
    if (run.thumbnailRefreshDispatchState !== "awaiting_approval") {
      throw new Error("thumbnail refresh candidate is not awaiting owner approval");
    }
    await ctx.db.patch(run._id, {
      thumbnailRefreshMaximumCostUsd: args.maximumCostUsd,
      thumbnailRefreshApproval: args.approval,
      thumbnailRefreshApprovalFingerprint: args.approvalFingerprint,
      thumbnailRefreshDispatchState: "pending",
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const getCandidateDispatch = query({
  args: { ownerId: v.string(), candidateRunId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh dispatch read");
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) return null;
    if (
      !run.thumbnailRefreshSourceRunId ||
      !run.thumbnailRefreshReplayFingerprint ||
      !run.thumbnailRefreshDispatchKey ||
      !run.thumbnailRefreshMaximumCostUsd ||
      !run.thumbnailRefreshApproval ||
      !run.thumbnailRefreshApprovalFingerprint
    ) return null;
    return {
      version: THUMBNAIL_REFRESH_DISPATCH_VERSION,
      ownerId: run.ownerId,
      channelId: String(run.channelId),
      sourceRunId: String(run.thumbnailRefreshSourceRunId),
      candidateRunId: String(run._id),
      replayFingerprint: run.thumbnailRefreshReplayFingerprint,
      maximumCostUsd: run.thumbnailRefreshMaximumCostUsd,
      approval: run.thumbnailRefreshApproval,
      approvalFingerprint: run.thumbnailRefreshApprovalFingerprint,
      dispatchKey: run.thumbnailRefreshDispatchKey,
      dispatchAttempt: run.thumbnailRefreshDispatchAttempts ?? 0,
    };
  },
});

export const listPendingCandidateDispatches = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh pending dispatch list");
    const limit = Math.max(1, Math.min(25, Math.floor(args.limit ?? 10)));
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshDispatchState", "pending"))
      .take(limit);
    return rows.map((run) => ({ candidateRunId: run._id }));
  },
});

export const reapExpiredCandidateDispatches = mutation({
  args: { ownerId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh queued dispatch recovery");
    assertNow(args.now);
    const limit = Math.max(1, Math.min(25, Math.floor(args.limit ?? 10)));
    const expired = await ctx.db
      .query("runs")
      .withIndex("by_owner_thumbnail_refresh_dispatch", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("thumbnailRefreshDispatchState", "queued")
        .lte("thumbnailRefreshDispatchQueueDeadlineAt", args.now))
      .take(limit);
    let requeued = 0;
    let blocked = 0;
    for (const run of expired) {
      const attempts = run.thumbnailRefreshDispatchAttempts ?? 0;
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        const error = "thumbnail refresh candidate delivery exhausted before the worker claimed it";
        await ctx.db.patch(run._id, {
          status: "failed",
          finishedAt: args.now,
          error,
          leaseExpiresAt: undefined,
          thumbnailRefreshDispatchState: "blocked",
          thumbnailRefreshDispatchUpdatedAt: args.now,
          thumbnailRefreshDispatchQueueDeadlineAt: undefined,
          thumbnailRefreshDispatchLastError: error,
        });
        blocked++;
      } else {
        await ctx.db.patch(run._id, {
          thumbnailRefreshDispatchState: "pending",
          thumbnailRefreshDispatchUpdatedAt: args.now,
          thumbnailRefreshDispatchQueueDeadlineAt: undefined,
          thumbnailRefreshDispatchLastError: "queued delivery was not claimed before its bounded deadline",
        });
        requeued++;
      }
    }
    return { checked: expired.length, requeued, blocked };
  },
});

export const markCandidateDispatchQueued = mutation({
  args: {
    ownerId: v.string(),
    candidateRunId: v.id("runs"),
    triggerRunId: v.string(),
    attempt: v.number(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh queue acknowledgement");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (run.thumbnailRefreshDispatchState === "consumed") return run;
    const current = run.thumbnailRefreshDispatchAttempts ?? 0;
    if (run.thumbnailRefreshDispatchState === "queued" && args.attempt <= current) return run;
    if (
      run.thumbnailRefreshDispatchState !== "pending" ||
      !Number.isSafeInteger(args.attempt) ||
      args.attempt !== current + 1 ||
      !args.triggerRunId.trim()
    ) throw new Error("thumbnail refresh queue acknowledgement is stale or invalid");
    await ctx.db.patch(run._id, {
      thumbnailRefreshDispatchState: "queued",
      thumbnailRefreshDispatchAttempts: args.attempt,
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueuedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: args.now + RUN_QUEUE_LEASE_MS,
      thumbnailRefreshDispatchTriggerRunId: args.triggerRunId,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const recordCandidateDispatchFailure = mutation({
  args: {
    ownerId: v.string(),
    candidateRunId: v.id("runs"),
    attempt: v.number(),
    error: v.string(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh enqueue failure");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (["queued", "consumed", "blocked"].includes(run.thumbnailRefreshDispatchState ?? "")) return run;
    const current = run.thumbnailRefreshDispatchAttempts ?? 0;
    if (run.thumbnailRefreshDispatchState !== "pending" || args.attempt !== current + 1) {
      return run;
    }
    const error = args.error.trim().slice(0, 1_000) || "thumbnail refresh Trigger enqueue failed";
    const blocked = args.attempt >= MAX_DISPATCH_ATTEMPTS;
    await ctx.db.patch(run._id, {
      ...(blocked ? { status: "failed", finishedAt: args.now, leaseExpiresAt: undefined } : {}),
      thumbnailRefreshDispatchState: blocked ? "blocked" : "pending",
      thumbnailRefreshDispatchAttempts: args.attempt,
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: undefined,
      thumbnailRefreshDispatchLastError: error,
      ...(blocked ? { error } : {}),
    });
    return await ctx.db.get(run._id);
  },
});

export const consumeCandidateDispatch = mutation({
  args: { ownerId: v.string(), candidateRunId: v.id("runs"), now: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh dispatch consumption");
    assertNow(args.now);
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("thumbnail refresh candidate not found");
    if (run.thumbnailRefreshDispatchState === "consumed") return run;
    if (!run.thumbnailRefreshApproval || !["pending", "queued"].includes(run.thumbnailRefreshDispatchState ?? "")) {
      throw new Error("thumbnail refresh candidate has no consumable owner-approved dispatch");
    }
    await ctx.db.patch(run._id, {
      thumbnailRefreshDispatchState: "consumed",
      thumbnailRefreshDispatchUpdatedAt: args.now,
      thumbnailRefreshDispatchQueueDeadlineAt: undefined,
      thumbnailRefreshDispatchLastError: undefined,
    });
    return await ctx.db.get(run._id);
  },
});

export const getCandidateExecution = query({
  args: { ownerId: v.string(), candidateRunId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "thumbnail refresh execution reload");
    const candidate = await ctx.db.get(args.candidateRunId);
    if (!candidate || candidate.ownerId !== args.ownerId || !candidate.thumbnailRefreshSourceRunId) return null;
    const source = await ctx.db.get(candidate.thumbnailRefreshSourceRunId);
    if (!source || source.ownerId !== args.ownerId || source.channelId !== candidate.channelId) {
      throw new Error("thumbnail refresh source/candidate binding is invalid");
    }
    await assertFinishedSource(ctx, source);
    const channel = await ctx.db.get(candidate.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("thumbnail refresh channel is unavailable");
    }
    const refreshMaterial = await refreshMaterialForRun(ctx, args.ownerId, source, { channel });
    if (
      !refreshMaterial.material ||
      refreshMaterial.material.replayFingerprint !== candidate.thumbnailRefreshReplayFingerprint
    ) {
      throw new Error("thumbnail refresh source or snapshotted successor changed from the candidate claim");
    }
    assertThumbnailRefreshKeepSource(source, channel, refreshMaterial.title);
    return { candidate, source, channelSlug: channel.slug, material: refreshMaterial.material };
  },
});
