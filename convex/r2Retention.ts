import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { assertStudioAssetLibraryEntry } from "../src/engine/studioAssetLibrary";
import { assertStudioReusableMediaEntry } from "../src/engine/studioReusableMedia";
import { isChannelLocked } from "./channelLock";
import { assertManagedWriterAndReferences, assertNoReusableReference } from "./r2ExpirationFence";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { evaluateRunArtifactRelease, RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS,
  RUN_ARTIFACT_RETENTION_MS } from "../src/lib/runArtifactRetention";
import type { Doc } from "./_generated/dataModel";
import { immutableAtlasCropDigest, immutableIntroCardDigest, immutableQuizFinalDigest } from "../src/lib/r2AssetRetention";

function assertCompletedRelease(row: Doc<"runArtifactRetentions"> | null, run: Doc<"runs">, now: number, age: number): void {
  if (!row || row.ownerId !== run.ownerId || row.channelId !== run.channelId || row.runId !== run._id ||
      !row.certificateKey || run.releaseEvidenceStatus !== "release_evidence_recorded" ||
      run.releaseEvidenceCertificateKey !== row.certificateKey ||
      row.status !== "completed" || !Number.isSafeInteger(row.releaseAt) ||
      !Number.isSafeInteger(row.retainUntil) || row.retainUntil! > now ||
      !row.releaseConfirmedAt || !row.completedAt || !row.releaseVideoId || !row.releaseYouTubeChannelId ||
      run.youtubeVideoId !== row.releaseVideoId || row.releaseAt! > now - age ||
      row.releaseAt! > now - RUN_ARTIFACT_RETENTION_MS) {
    throw new Error("R2 expiration requires completed, exact-video release retention");
  }
}

/** All revisions are protected: deprecation does not prove bytes are unused. */
export const protectedKeysPage = query({
  args: {
    ownerId: v.string(),
    source: v.union(v.literal("library"), v.literal("reusable_media")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 retention protected inventory");
    if (args.source === "library") {
      const page = await ctx.db.query("studioAssetLibraryEntries")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .paginate(args.paginationOpts);
      return { ...page, page: page.page.flatMap((row) => {
        const key = assertStudioAssetLibraryEntry(row.entry).resource?.r2Key;
        return key ? [key] : [];
      }) };
    }
    const page = await ctx.db.query("studioReusableMediaAssets")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map((row) => assertStudioReusableMediaEntry(row.entry).resource.r2Key) };
  },
});

/** Only a scheduled, owned run supplies authority for its exact R2 namespace. */
export const runScopesPage = query({
  args: { ownerId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 retention run inventory");
    const page = await ctx.db.query("runArtifactRetentions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .paginate(args.paginationOpts);
    const scopes = await Promise.all(page.page.map(async (row) => {
      const [run, channel, assets] = await Promise.all([
        ctx.db.get(row.runId),
        ctx.db.get(row.channelId),
        ctx.db.query("assets").withIndex("by_run", (q) => q.eq("runId", row.runId)).collect(),
      ]);
      if (!run || !channel || run.ownerId !== args.ownerId || channel.ownerId !== args.ownerId ||
          run.channelId !== row.channelId || row.ownerId !== args.ownerId ||
          run.releaseEvidenceCertificateKey !== row.certificateKey) {
        throw new Error("R2 retention run scope no longer matches release evidence");
      }
      if (assets.some((asset) => asset.ownerId !== args.ownerId || asset.channelId !== row.channelId)) {
        throw new Error("R2 retention asset owner/channel mismatch");
      }
      return {
        runId: String(row.runId), channelId: String(row.channelId), releaseVideoId: row.releaseVideoId,
        keyPrefix: row.keyPrefix,
        runStatus: run.status, finishedAt: run.finishedAt,
        retentionStatus: row.status, releaseAt: row.releaseAt, retainUntil: row.retainUntil,
        channelLocked: isChannelLocked(channel),
        certificateKey: row.certificateKey,
        additionalCertificateKeys: row.additionalCertificateKeys,
        keepNames: row.keepNames,
        retainedReleaseEvidence: row.retainedReleaseEvidence ?? [],
        assets: assets.map((asset) => ({ kind: asset.kind, r2Key: asset.r2Key })),
      };
    }));
    return { ...page, page: scopes };
  },
});

/** Exact owner/channel/run binding for the older footage/run media layout. */
export const footageRunScope = query({
  args: { ownerId: v.string(), channelSlug: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 footage retention run lookup");
    const id = ctx.db.normalizeId("runs", args.runId);
    if (!id) return null;
    const run = await ctx.db.get(id);
    if (!run || run.ownerId !== args.ownerId) return null;
    const channel = await ctx.db.get(run.channelId);
    if (!channel || channel.ownerId !== args.ownerId || channel.slug !== args.channelSlug) return null;
    const retention = await ctx.db.query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", id)).unique();
    return { status: run.status, finishedAt: run.finishedAt, channelLocked: isChannelLocked(channel),
      retentionStatus: retention?.status, releaseAt: retention?.releaseAt, retainUntil: retention?.retainUntil,
      channelId: String(run.channelId), releaseVideoId: retention?.releaseVideoId };
  },
});

const expirationKind = v.union(v.literal("asset"), v.literal("final_video"), v.literal("footage"));
const releaseObservation = v.object({
  videoId: v.string(), channelId: v.string(),
  privacyStatus: v.optional(v.string()), uploadStatus: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
});
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Persist an intent before the cross-provider delete; a crash leaves a retryable row. */
export const prepareExpiration = mutation({
  args: { ownerId: v.string(), runId: v.id("runs"), r2Key: v.string(), kind: expirationKind,
    lastModifiedAt: v.number(), etag: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset expiration preparation");
    if (!(args.kind === "asset" && (immutableIntroCardDigest(args.r2Key) || immutableAtlasCropDigest(args.r2Key))) &&
        !(args.kind === "final_video" && immutableQuizFinalDigest(args.r2Key))) {
      throw new Error("R2 expiration requires a proven create-only asset or final writer; other media are report-only");
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("R2 expiration run owner mismatch");
    const channel = await ctx.db.get(run.channelId);
    if (!channel || channel.ownerId !== args.ownerId || isChannelLocked(channel)) {
      throw new Error("R2 expiration channel is missing or locked");
    }
    const now = Date.now();
    const age = (args.kind === "final_video" ? 180 : 30) * DAY_MS;
    const retention = await ctx.db.query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId)).unique();
    assertCompletedRelease(retention, run, now, age);
    if (!["ok", "failed", "canceled"].includes(run.status) ||
        !Number.isSafeInteger(run.finishedAt) || run.finishedAt! > now - age ||
        !Number.isSafeInteger(args.lastModifiedAt) || args.lastModifiedAt > now - age || !/^"[^"\r\n]+"$/u.test(args.etag)) {
      throw new Error("R2 expiration run or object is not old enough");
    }
    const runPrefix = `owner/${args.ownerId}/channel/${channel.slug}/runs/${args.runId}/`;
    if (!args.r2Key.startsWith(runPrefix) || args.r2Key.length <= runPrefix.length) {
      throw new Error("R2 expiration key escapes its exact owned run namespace");
    }
    const assets = await assertManagedWriterAndReferences(ctx, args.ownerId, args.runId, run.channelId, args.r2Key);
    if (args.kind === "final_video" &&
        !assets.some((asset) => asset.kind === "video" || asset.kind === "derived_short")) {
      throw new Error("immutable final has no exact bound video asset");
    }
    await assertNoReusableReference(ctx, args.ownerId, args.r2Key);
    const prior = await ctx.db.query("r2AssetExpirations")
      .withIndex("by_run_key", (q) => q.eq("runId", args.runId).eq("r2Key", args.r2Key))
      .unique();
    if (prior) {
      if (prior.ownerId !== args.ownerId || prior.channelId !== run.channelId ||
          prior.kind !== args.kind || prior.lastModifiedAt !== args.lastModifiedAt || prior.etag !== args.etag) {
        throw new Error("R2 expiration replay conflicts with its immutable intent");
      }
      if (prior.status === "canceled") throw new Error("canceled R2 deletion intent requires manual reconciliation");
      return { id: prior._id, status: prior.status, reused: true };
    }
    const id = await ctx.db.insert("r2AssetExpirations", {
      ownerId: args.ownerId, channelId: run.channelId, runId: args.runId, r2Key: args.r2Key, kind: args.kind,
      etag: args.etag,
      status: "pending", lastModifiedAt: args.lastModifiedAt, preparedAt: now,
    });
    return { id, status: "pending" as const, reused: false };
  },
});

/** Last transactional check immediately before the R2 request. */
export const authorizeExpirationDelete = mutation({
  args: { ownerId: v.string(), expirationId: v.id("r2AssetExpirations"),
    connectorId: v.id("youtubeAuth"), connectorVersion: v.number(),
    observedAt: v.number(), observation: releaseObservation },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 expiration deletion authority");
    const row = await ctx.db.get(args.expirationId);
    if (!row || row.ownerId !== args.ownerId || row.status !== "pending") throw new Error("R2 expiration intent is not pending");
    const [run, channel, connector] = await Promise.all([
      ctx.db.get(row.runId), ctx.db.get(row.channelId), ctx.db.get(args.connectorId),
    ]);
    if (!run || !channel || run.ownerId !== args.ownerId || run.channelId !== row.channelId ||
        channel.ownerId !== args.ownerId || isChannelLocked(channel)) throw new Error("R2 expiration scope is locked or changed");
    const retention = await ctx.db.query("runArtifactRetentions")
      .withIndex("by_run", (q) => q.eq("runId", row.runId)).unique();
    assertCompletedRelease(retention, run, Date.now(), (row.kind === "final_video" ? 180 : 30) * DAY_MS);
    const now = Date.now();
    if (!connector || connector.ownerId !== args.ownerId || connector.channelId !== row.channelId ||
        (connector.status ?? "active") !== "active" ||
        (connector.tokenVersion ?? 1) !== args.connectorVersion ||
        !Number.isSafeInteger(args.observedAt) || args.observedAt > now ||
        now - args.observedAt >= RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS) {
      throw new Error("R2 expiration has no fresh bound YouTube connector observation");
    }
    const decision = evaluateRunArtifactRelease({
      expectedVideoId: retention!.releaseVideoId!, expectedChannelId: connector.ytChannelId ?? "",
      observedAt: args.observedAt, observation: args.observation,
    });
    if (!decision.released || decision.releaseAt !== retention!.releaseAt ||
        args.observation.channelId !== retention!.releaseYouTubeChannelId) {
      throw new Error("R2 expiration video is not currently public and processed on its bound channel");
    }
    await assertNoReusableReference(ctx, args.ownerId, row.r2Key);
    const assets = await assertManagedWriterAndReferences(ctx, args.ownerId, row.runId, row.channelId, row.r2Key);
    if (row.kind === "final_video" &&
        !assets.some((asset) => asset.kind === "video" || asset.kind === "derived_short")) {
      throw new Error("immutable final video asset binding changed");
    }
    return { authorizedAt: Date.now() };
  },
});

/** Called only after exact-key R2 deletion acknowledgement or confirmed absence. */
export const confirmExpiration = mutation({
  args: { ownerId: v.string(), expirationId: v.id("r2AssetExpirations") },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset expiration confirmation");
    const row = await ctx.db.get(args.expirationId);
    if (!row || row.ownerId !== args.ownerId) throw new Error("R2 expiration receipt owner mismatch");
    if (row.status === "expired") return row;
    if (row.status !== "pending") throw new Error("R2 expiration confirmation requires pending intent");
    const run = await ctx.db.get(row.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("R2 expiration run owner changed");
    const assets = await ctx.db.query("assets").withIndex("by_run", (q) => q.eq("runId", row.runId)).collect();
    for (const asset of assets) {
      if (asset.r2Key !== row.r2Key) continue;
      if (asset.ownerId !== args.ownerId || asset.channelId !== run.channelId) {
        throw new Error("R2 expiration asset binding changed");
      }
      await ctx.db.delete(asset._id);
      if (run.videoAssetId === asset._id) await ctx.db.patch(run._id, { videoAssetId: undefined });
    }
    await ctx.db.patch(row._id, { status: "expired", expiredAt: Date.now() });
    return await ctx.db.get(row._id);
  },
});

export const pendingExpirationsPage = query({
  args: { ownerId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 expiration pending inventory");
    const page = await ctx.db.query("r2AssetExpirations")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", args.ownerId).eq("status", "pending"))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map((row) => ({ id: row._id, r2Key: row.r2Key,
      etag: row.etag, lastModifiedAt: row.lastModifiedAt, preparedAt: row.preparedAt })) };
  },
});
