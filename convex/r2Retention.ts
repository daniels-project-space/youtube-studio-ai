import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { assertStudioAssetLibraryEntry } from "../src/engine/studioAssetLibrary";
import { assertStudioReusableMediaEntry } from "../src/engine/studioReusableMedia";
import { isChannelLocked } from "./channelLock";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";

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
        runId: String(row.runId), keyPrefix: row.keyPrefix,
        runStatus: run.status, finishedAt: run.finishedAt,
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
    return { status: run.status, finishedAt: run.finishedAt, channelLocked: isChannelLocked(channel) };
  },
});

const expirationKind = v.union(v.literal("asset"), v.literal("final_video"), v.literal("footage"));
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Persist an intent before the cross-provider delete; a crash leaves a retryable row. */
export const prepareExpiration = mutation({
  args: { ownerId: v.string(), runId: v.id("runs"), r2Key: v.string(), kind: expirationKind, lastModifiedAt: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "R2 asset expiration preparation");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("R2 expiration run owner mismatch");
    const channel = await ctx.db.get(run.channelId);
    if (!channel || channel.ownerId !== args.ownerId || isChannelLocked(channel)) {
      throw new Error("R2 expiration channel is missing or locked");
    }
    const now = Date.now();
    const age = (args.kind === "final_video" ? 180 : 30) * DAY_MS;
    if (!["ok", "failed", "canceled"].includes(run.status) ||
        !Number.isSafeInteger(run.finishedAt) || run.finishedAt! > now - age ||
        !Number.isSafeInteger(args.lastModifiedAt) || args.lastModifiedAt > now - age) {
      throw new Error("R2 expiration run or object is not old enough");
    }
    const runPrefix = `owner/${args.ownerId}/channel/${channel.slug}/runs/${args.runId}/`;
    const footagePrefix = `owner/${args.ownerId}/channel/${channel.slug}/footage/run/${args.runId}/`;
    if (args.kind === "footage"
      ? !args.r2Key.startsWith(footagePrefix) || !/^clip_[0-9]+\.mp4$/u.test(args.r2Key.slice(footagePrefix.length))
      : !args.r2Key.startsWith(runPrefix) || args.r2Key.length <= runPrefix.length) {
      throw new Error("R2 expiration key escapes its exact owned run namespace");
    }
    const prior = await ctx.db.query("r2AssetExpirations")
      .withIndex("by_run_key", (q) => q.eq("runId", args.runId).eq("r2Key", args.r2Key))
      .unique();
    if (prior) {
      if (prior.ownerId !== args.ownerId || prior.kind !== args.kind || prior.lastModifiedAt !== args.lastModifiedAt) {
        throw new Error("R2 expiration replay conflicts with its immutable intent");
      }
      return { id: prior._id, status: prior.status };
    }
    const id = await ctx.db.insert("r2AssetExpirations", {
      ownerId: args.ownerId, runId: args.runId, r2Key: args.r2Key, kind: args.kind,
      status: "pending", lastModifiedAt: args.lastModifiedAt, preparedAt: now,
    });
    return { id, status: "pending" as const };
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
    return { ...page, page: page.page.map((row) => ({ id: row._id, r2Key: row.r2Key })) };
  },
});
