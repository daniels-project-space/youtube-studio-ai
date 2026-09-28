import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { FINAL_VIDEO_RETENTION_MS, releasedFinalVideoKey } from "../src/lib/r2AssetRetention";
import { isChannelLocked } from "./channelLock";
import { evaluateRunArtifactRelease, RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS } from "../src/lib/runArtifactRetention";

const sha = /^[a-f0-9]{64}$/u;
const etag = /^"?[a-f0-9]{32}(?:-[0-9]+)?"?$/iu;
const identity = {
  ownerId: v.string(), retentionId: v.id("runArtifactRetentions"),
  releaseAt: v.number(), certificateKey: v.string(), certificateFingerprint: v.string(),
  sourceKey: v.string(), sourceSha256: v.string(), sourceByteLength: v.number(),
  sourceEtag: v.string(), sourceLastModifiedAt: v.number(), copyKey: v.string(),
  claimId: v.string(),
};
const releaseObservation = v.object({
  videoId: v.string(), channelId: v.string(),
  privacyStatus: v.optional(v.string()), uploadStatus: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
});
const freshProof = { connectorId: v.id("youtubeAuth"), connectorVersion: v.number(),
  observedAt: v.number(), observation: releaseObservation };

async function assertFreshPublicCopyBoundary(ctx: MutationCtx, args: {
  ownerId: string; retentionId: Id<"runArtifactRetentions">; releaseAt: number;
  connectorId: Id<"youtubeAuth">; connectorVersion: number;
  observedAt: number; observation: { videoId: string; channelId: string;
    privacyStatus?: string; uploadStatus?: string; publishedAt?: string };
}, now: number) {
  const row = await ctx.db.get(args.retentionId);
  const [run, channel, connector] = row ? await Promise.all([
    ctx.db.get(row.runId), ctx.db.get(row.channelId), ctx.db.get(args.connectorId),
  ]) : [null, null, null];
  const decision = evaluateRunArtifactRelease({
    expectedVideoId: run?.ownerId === args.ownerId && run.channelId === row?.channelId
      ? run.youtubeVideoId ?? "" : "",
    expectedChannelId: connector?.ownerId === args.ownerId && connector.channelId === row?.channelId &&
      (connector.status ?? "active") === "active" &&
      (connector.tokenVersion ?? 1) === args.connectorVersion ? connector.ytChannelId ?? "" : "",
    observedAt: args.observedAt, observation: args.observation,
  });
  if (!row || !run || !channel || !connector || row.ownerId !== args.ownerId ||
      !["pending", "completed", "blocked"].includes(row.status) ||
      channel.ownerId !== args.ownerId || isChannelLocked(channel) ||
      run.releaseEvidenceStatus !== "release_evidence_recorded" ||
      run.releaseEvidenceCertificateKey !== row.certificateKey ||
      !Number.isSafeInteger(now) || args.observedAt > now ||
      args.observedAt < now - RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS ||
      !decision.released || decision.releaseAt !== args.releaseAt ||
      row.releaseAt !== args.releaseAt ||
      row.releaseVideoId !== args.observation.videoId ||
      row.releaseYouTubeChannelId !== args.observation.channelId ||
      row.releaseObservationAt !== args.observedAt) {
    throw new Error("released final boundary lacks fresh exact public and processed generation");
  }
  return row;
}

/** Service-only work item. A public observation is required again before begin. */
export const candidate = query({
  args: { ownerId: v.string(), retentionId: v.id("runArtifactRetentions"), now: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "released final candidate");
    const row = await ctx.db.get(args.retentionId);
    if (!row || row.ownerId !== args.ownerId ||
        !["pending", "completed", "blocked"].includes(row.status) ||
        !Number.isSafeInteger(row.releaseAt) || !Number.isSafeInteger(row.releaseObservationAt) ||
        row.releaseObservationAt! > args.now || row.releaseObservationAt! < args.now - 5 * 60_000 ||
        row.releaseAt! + FINAL_VIDEO_RETENTION_MS <= args.now) return null;
    const [run, channel, prior] = await Promise.all([
      ctx.db.get(row.runId),
      ctx.db.get(row.channelId),
      ctx.db.query("releasedFinalMasters")
        .withIndex("by_run_release", (q) => q.eq("runId", row.runId).eq("releaseAt", row.releaseAt!)).unique(),
    ]);
    if (!run || !channel || channel.ownerId !== args.ownerId || isChannelLocked(channel) ||
        run.ownerId !== args.ownerId || run.channelId !== row.channelId ||
        run.releaseEvidenceStatus !== "release_evidence_recorded" ||
        run.releaseEvidenceCertificateKey !== row.certificateKey ||
        !run.youtubeVideoId || run.youtubeVideoId !== row.releaseVideoId ||
        prior?.status === "finished") return null;
    return { retentionId: row._id, runId: row.runId, channelId: row.channelId,
      videoId: run.youtubeVideoId, keyPrefix: row.keyPrefix,
      certificateKey: row.certificateKey, releaseAt: row.releaseAt! };
  },
});

/** Reserve one exact source→copy generation before any R2 write. */
export const begin = mutation({
  args: identity,
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "released final reservation");
    const now = Date.now();
    const row = await ctx.db.get(args.retentionId);
    const [run, channel] = row ? await Promise.all([ctx.db.get(row.runId), ctx.db.get(row.channelId)]) : [null, null];
    if (!row || !run || !channel || channel.ownerId !== args.ownerId || isChannelLocked(channel) ||
        row.ownerId !== args.ownerId || !["pending", "completed", "blocked"].includes(row.status) ||
        run.ownerId !== args.ownerId || run.channelId !== row.channelId ||
        run.releaseEvidenceStatus !== "release_evidence_recorded" ||
        run.releaseEvidenceCertificateKey !== args.certificateKey ||
        run.youtubeVideoId !== row.releaseVideoId ||
        row.certificateKey !== args.certificateKey || row.releaseAt !== args.releaseAt ||
        !Number.isSafeInteger(row.releaseObservationAt) ||
        row.releaseObservationAt! < now - 5 * 60_000 || row.releaseObservationAt! > now ||
        args.releaseAt + FINAL_VIDEO_RETENTION_MS <= now ||
        !args.sourceKey.startsWith(`${row.keyPrefix}runs/${row.runId}/`) ||
        args.copyKey !== releasedFinalVideoKey(row.keyPrefix, String(row.runId), args.releaseAt, args.sourceSha256) ||
        !sha.test(args.sourceSha256) || !sha.test(args.certificateFingerprint) ||
        !etag.test(args.sourceEtag) || !Number.isSafeInteger(args.sourceByteLength) || args.sourceByteLength < 1 ||
        !Number.isSafeInteger(args.sourceLastModifiedAt) || args.sourceLastModifiedAt > now ||
        !/^[a-f0-9-]{36}$/iu.test(args.claimId)) throw new Error("released final reservation lacks exact public, source, or certificate binding");
    const prior = await ctx.db.query("releasedFinalMasters")
      .withIndex("by_run_release", (q) => q.eq("runId", row.runId).eq("releaseAt", args.releaseAt)).unique();
    if (prior) {
      if (Object.entries(args).some(([key, value]) => key !== "retentionId" && prior[key as keyof typeof prior] !== value) ||
          prior.channelId !== row.channelId || prior.runId !== row.runId ||
          prior.status === "active" && prior.claimId !== args.claimId) throw new Error("released final generation conflicts with immutable reservation");
      return { status: prior.status };
    }
    const { retentionId: _retentionId, ...fields } = args;
    void _retentionId;
    await ctx.db.insert("releasedFinalMasters", { ...fields, channelId: row.channelId,
      runId: row.runId, status: "active", startedAt: now });
    return { status: "active" as const };
  },
});

/** A fresh YouTube read is committed immediately before the conditional PUT. */
export const authorizeWrite = mutation({
  args: { ownerId: v.string(), retentionId: v.id("runArtifactRetentions"),
    releaseAt: v.number(), copyKey: v.string(), claimId: v.string(), ...freshProof },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "released final PUT authorization");
    const now = Date.now();
    const row = await assertFreshPublicCopyBoundary(ctx, args, now);
    const prior = await ctx.db.query("releasedFinalMasters")
      .withIndex("by_run_release", (q) => q.eq("runId", row.runId).eq("releaseAt", args.releaseAt)).unique();
    if (!prior || prior.status !== "active" || prior.ownerId !== args.ownerId ||
        prior.copyKey !== args.copyKey || prior.claimId !== args.claimId ||
        args.releaseAt + FINAL_VIDEO_RETENTION_MS <= now) {
      throw new Error("released final conditional PUT lacks its active exact generation");
    }
    return { expiresAt: args.observedAt + RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS };
  },
});

export const finish = mutation({
  args: { ...identity, ...freshProof,
    copyEtag: v.string(), copyLastModifiedAt: v.number(), finishedAt: v.number() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "released final completion");
    const now = Date.now();
    const row = await assertFreshPublicCopyBoundary(ctx, args, now);
    const prior = await ctx.db.query("releasedFinalMasters")
      .withIndex("by_run_release", (q) => q.eq("runId", row.runId).eq("releaseAt", args.releaseAt)).unique();
    if (!prior || row.certificateKey !== args.certificateKey ||
        Object.entries(args).some(([key, value]) => !["retentionId", "connectorId", "connectorVersion", "observedAt", "observation", "copyEtag", "copyLastModifiedAt", "finishedAt"].includes(key) &&
          prior[key as keyof typeof prior] !== value) ||
        !etag.test(args.copyEtag) || !Number.isSafeInteger(args.copyLastModifiedAt) ||
        args.copyLastModifiedAt < prior.startedAt - 1_000 || args.copyLastModifiedAt > args.finishedAt ||
        !Number.isSafeInteger(args.finishedAt) || args.finishedAt < prior.startedAt) {
      throw new Error("released final completion changed its exact source or release generation");
    }
    if (prior.status === "finished") {
      if (prior.copyEtag !== args.copyEtag || prior.copyLastModifiedAt !== args.copyLastModifiedAt) {
        throw new Error("released final copy identity changed");
      }
    } else await ctx.db.patch(prior._id, { status: "finished", finishedAt: args.finishedAt,
      copyEtag: args.copyEtag, copyLastModifiedAt: args.copyLastModifiedAt });
    await ctx.db.patch(row._id, { nextFinalCopyCheckAt: now + 24 * 60 * 60_000 });
    return { status: "finished" as const };
  },
});
