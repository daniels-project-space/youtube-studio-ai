import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { ASSET_RETENTION_MS, isLoFiKeyframeSource, isLoFiOrdinarySource, releasedKeyframeKey, releasedOrdinaryAssetKey } from "../src/lib/r2AssetRetention";
import { isChannelLocked } from "./channelLock";
import { assertStudioAssetLibraryEntry } from "../src/engine/studioAssetLibrary";
import { assertStudioReusableMediaEntry } from "../src/engine/studioReusableMedia";

const MAX_PROTECTED_REVISIONS = 2_000;

const assetClass = v.union(v.literal("lofi-clip"), v.literal("lofi-loop-unit"), v.literal("lofi-keyframe"));
const sourceAllowed = (kind: "lofi-clip" | "lofi-loop-unit" | "lofi-keyframe",
  prefix: string, runId: string, key: string) => kind === "lofi-keyframe"
    ? isLoFiKeyframeSource(prefix, runId, key) : isLoFiOrdinarySource(kind, prefix, runId, key);
const copyKeyFor = (kind: "lofi-clip" | "lofi-loop-unit" | "lofi-keyframe",
  prefix: string, runId: string, assetId: string, releaseAt: number, sha: string) => kind === "lofi-keyframe"
    ? releasedKeyframeKey(prefix, runId, assetId, releaseAt, sha)
    : releasedOrdinaryAssetKey(prefix, runId, kind, assetId, releaseAt, sha);
const identity = {
  ownerId: v.string(), assetId: v.id("assets"), releaseAt: v.number(),
  assetClass, sourceKey: v.string(), sourceEtag: v.string(), sourceLastModifiedAt: v.number(),
  sourceSha256: v.string(), sourceByteLength: v.number(), copyKey: v.string(),
};

/** Explicit service work item. No cron or automatic copy is installed. */
export const candidate = query({
  args: { ownerId: v.string(), assetId: v.id("assets"), now: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "ordinary release candidate");
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.ownerId !== args.ownerId || !asset.runId ||
        !["clip", "loop_unit", "keyframe"].includes(asset.kind)) return null;
    const [channel, run, retentions] = await Promise.all([
      ctx.db.get(asset.channelId),
      ctx.db.get(asset.runId),
      ctx.db.query("runArtifactRetentions").withIndex("by_run", q => q.eq("runId", asset.runId!)).collect(),
    ]);
    const row = retentions.find(r => r.ownerId === args.ownerId && r.channelId === asset.channelId &&
      r.finalCopyReleaseAt !== undefined && r.finalCopyObservationAt !== undefined &&
      Boolean(r.finalCopyVideoId && r.finalCopyYouTubeChannelId) &&
      r.finalCopyObservationAt <= args.now && r.finalCopyObservationAt >= args.now - 5 * 60_000 &&
      r.finalCopyReleaseAt <= args.now && r.finalCopyReleaseAt + ASSET_RETENTION_MS > args.now);
    const finalCopy = row ? await ctx.db.query("releasedFinalMasters")
      .withIndex("by_run_release", q => q.eq("runId", asset.runId!).eq("releaseAt", row.finalCopyReleaseAt!)).unique() : null;
    const kind = asset.kind === "clip" ? "lofi-clip" : asset.kind === "keyframe" ? "lofi-keyframe" : "lofi-loop-unit";
    if (!row || finalCopy?.status !== "finished" || !channel || channel.ownerId !== args.ownerId || isChannelLocked(channel) ||
        !run || run.ownerId !== args.ownerId || run.channelId !== asset.channelId ||
        run.releaseEvidenceStatus !== "release_evidence_recorded" ||
        run.releaseEvidenceCertificateKey !== row.certificateKey ||
        run.youtubeVideoId !== row.finalCopyVideoId ||
        !sourceAllowed(kind, row.keyPrefix, String(asset.runId), asset.r2Key)) return null;
    return { assetId: asset._id, sourceKey: asset.r2Key, assetClass: kind,
      releaseAt: row.finalCopyReleaseAt!, keyPrefix: row.keyPrefix, runId: asset.runId,
      channelId: asset.channelId, videoId: row.finalCopyVideoId!,
      youtubeChannelId: row.finalCopyYouTubeChannelId! };
  },
});

/** Reserve the exact generation before R2 writes. Every mismatch fails closed. */
export const begin = mutation({
  args: identity,
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "ordinary release reservation");
    const now = Date.now();
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.ownerId !== args.ownerId || !asset.runId || asset.r2Key !== args.sourceKey ||
        asset.kind !== (args.assetClass === "lofi-clip" ? "clip" : args.assetClass === "lofi-keyframe" ? "keyframe" : "loop_unit") ||
        !/^[a-f0-9]{64}$/u.test(args.sourceSha256) ||
        !/^"?[a-f0-9]{32}(?:-[0-9]+)?"?$/iu.test(args.sourceEtag) ||
        !Number.isSafeInteger(args.sourceByteLength) || args.sourceByteLength < 1 ||
        !Number.isSafeInteger(args.sourceLastModifiedAt) || args.sourceLastModifiedAt > now ||
        !Number.isSafeInteger(args.releaseAt) || args.releaseAt + ASSET_RETENTION_MS <= now) {
      throw new Error("ordinary release lacks exact owned source evidence");
    }
    const [channel, run, retentions, library, reusable] = await Promise.all([
      ctx.db.get(asset.channelId),
      ctx.db.get(asset.runId),
      ctx.db.query("runArtifactRetentions").withIndex("by_run", q => q.eq("runId", asset.runId!)).collect(),
      ctx.db.query("studioAssetLibraryEntries").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).take(MAX_PROTECTED_REVISIONS + 1),
      ctx.db.query("studioReusableMediaAssets").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).take(MAX_PROTECTED_REVISIONS + 1),
    ]);
    if (library.length > MAX_PROTECTED_REVISIONS || reusable.length > MAX_PROTECTED_REVISIONS)
      throw new Error("protected media inventory exceeds verified bound");
    const protectedKeys = [
      ...library.flatMap(x => {
        const key = assertStudioAssetLibraryEntry(x.entry).resource?.r2Key;
        return key ? [key] : [];
      }),
      ...reusable.map(x => assertStudioReusableMediaEntry(x.entry).resource.r2Key),
    ];
    const row = retentions.find(r => r.ownerId === args.ownerId && r.channelId === asset.channelId &&
      r.finalCopyReleaseAt === args.releaseAt && r.finalCopyObservationAt !== undefined &&
      Boolean(r.finalCopyVideoId && r.finalCopyYouTubeChannelId) &&
      r.finalCopyObservationAt <= now && r.finalCopyObservationAt >= now - 5 * 60_000);
    const finalCopy = row ? await ctx.db.query("releasedFinalMasters")
      .withIndex("by_run_release", q => q.eq("runId", asset.runId!).eq("releaseAt", args.releaseAt)).unique() : null;
    if (!channel || channel.ownerId !== args.ownerId || isChannelLocked(channel) ||
        !run || run.ownerId !== args.ownerId || run.channelId !== asset.channelId ||
        run.releaseEvidenceStatus !== "release_evidence_recorded" ||
        run.releaseEvidenceCertificateKey !== row?.certificateKey ||
        run.youtubeVideoId !== row?.finalCopyVideoId || !row || finalCopy?.status !== "finished" ||
        protectedKeys.includes(args.sourceKey) ||
        !sourceAllowed(args.assetClass, row.keyPrefix, String(asset.runId), args.sourceKey) ||
        args.copyKey !== copyKeyFor(args.assetClass, row.keyPrefix, String(asset.runId),
          String(args.assetId), args.releaseAt, args.sourceSha256)) {
      throw new Error("ordinary release source is protected or copy identity mismatches");
    }
    const prior = await ctx.db.query("releasedOrdinaryAssets")
      .withIndex("by_asset_release", q => q.eq("assetId", args.assetId).eq("releaseAt", args.releaseAt)).unique();
    if (prior) {
      if (Object.entries(args).some(([key, value]) => prior[key as keyof typeof prior] !== value))
        throw new Error("ordinary release generation conflicts with immutable ledger");
      return { status: prior.status };
    }
    await ctx.db.insert("releasedOrdinaryAssets", { ...args, channelId: asset.channelId,
      runId: asset.runId, status: "active", startedAt: now });
    return { status: "active" as const };
  },
});

export const finish = mutation({
  args: { ...identity, copyEtag: v.string(), copyLastModifiedAt: v.number(), finishedAt: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "ordinary release completion");
    const prior = await ctx.db.query("releasedOrdinaryAssets")
      .withIndex("by_asset_release", q => q.eq("assetId", args.assetId).eq("releaseAt", args.releaseAt)).unique();
    if (!prior || Object.entries(args).some(([key, value]) =>
        !["copyEtag", "copyLastModifiedAt", "finishedAt"].includes(key) && prior[key as keyof typeof prior] !== value) ||
        !/^"?[a-f0-9]{32}(?:-[0-9]+)?"?$/iu.test(args.copyEtag) ||
        !Number.isSafeInteger(args.copyLastModifiedAt) ||
        !Number.isSafeInteger(args.finishedAt) || args.copyLastModifiedAt > args.finishedAt ||
        args.finishedAt < prior.startedAt) throw new Error("ordinary release completion identity changed");
    if (prior.status === "finished") {
      if (prior.copyEtag !== args.copyEtag || prior.copyLastModifiedAt !== args.copyLastModifiedAt)
        throw new Error("ordinary release copy identity changed");
    } else await ctx.db.patch(prior._id, { status: "finished", copyEtag: args.copyEtag,
      copyLastModifiedAt: args.copyLastModifiedAt, finishedAt: args.finishedAt });
    return { status: "finished" as const };
  },
});
