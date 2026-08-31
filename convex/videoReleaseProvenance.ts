import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import {
  assertVideoReleaseProvenanceDatabaseBinding,
  assertVideoReleaseProvenanceWrite,
  sameRetryableVideoReleaseProvenance,
} from "../src/lib/videoReleaseProvenanceIntegrity";

const evidenceStatus = v.union(
  v.literal("complete"),
  v.literal("partial"),
  v.literal("unmeasured"),
);

const storyMeasurementCoverage = v.union(
  v.literal("unmeasured"),
  v.literal("plan_only"),
  v.literal("final_master"),
  v.literal("scope_undeclared"),
);

const programRoute = v.object({
  routeFingerprint: v.string(),
  family: v.string(),
  contentLaneKey: v.string(),
  programBriefFingerprint: v.optional(v.string()),
});

function assertInternalSecret(secret: string, operation: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error(`${operation}: invalid internal secret`);
  }
}

/** Read-only provenance for analytics/UI; it is not a quality or outcome claim. */
export const get = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    youtubeVideoId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("videoReleaseProvenance")
      .withIndex("by_owner_youtube_video", (q) =>
        q.eq("ownerId", args.ownerId).eq("youtubeVideoId", args.youtubeVideoId),
      )
      .unique();
    if (row && row.channelId !== args.channelId) {
      throw new Error("videoReleaseProvenance.get: channel provenance mismatch");
    }
    return row;
  },
});

/**
 * Install a write-once mapping only after the publish ledger and run have both
 * recorded the same uploaded YouTube video. The worker parsed the certificate
 * before this call; Convex independently verifies every database-side join.
 */
export const record = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    publishIntentId: v.id("publishIntents"),
    youtubeVideoId: v.string(),
    releaseCertificateKey: v.string(),
    releaseCertificateFingerprint: v.string(),
    finalMasterSha256: v.string(),
    qualityBindingVersion: v.string(),
    qualityBindingFingerprint: v.string(),
    qualityEvidenceFingerprint: v.string(),
    contentLaneKey: v.string(),
    renderer: v.string(),
    programRoute: v.optional(programRoute),
    evidenceStatus,
    storyMeasurementCoverage: v.optional(storyMeasurementCoverage),
  },
  returns: v.id("videoReleaseProvenance"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "videoReleaseProvenance.record");
    const write = {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      publishIntentId: args.publishIntentId,
      youtubeVideoId: args.youtubeVideoId,
      releaseCertificateKey: args.releaseCertificateKey,
      releaseCertificateFingerprint: args.releaseCertificateFingerprint,
      finalMasterSha256: args.finalMasterSha256,
      qualityBindingVersion: args.qualityBindingVersion,
      qualityBindingFingerprint: args.qualityBindingFingerprint,
      qualityEvidenceFingerprint: args.qualityEvidenceFingerprint,
      contentLaneKey: args.contentLaneKey,
      renderer: args.renderer,
      programRoute: args.programRoute,
      evidenceStatus: args.evidenceStatus,
      ...(args.storyMeasurementCoverage === undefined
        ? {}
        : { storyMeasurementCoverage: args.storyMeasurementCoverage }),
    };
    assertVideoReleaseProvenanceWrite(write);

    const [channel, run, intent] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.runId),
      ctx.db.get(args.publishIntentId),
    ]);
    const { uploadedAt } = assertVideoReleaseProvenanceDatabaseBinding({
      write,
      channel,
      run,
      intent,
    });

    const rowsForVideo = await ctx.db
      .query("videoReleaseProvenance")
      .withIndex("by_youtube_video", (q) => q.eq("youtubeVideoId", args.youtubeVideoId))
      .collect();
    if (rowsForVideo.length > 1) {
      throw new Error("videoReleaseProvenance.record: duplicate YouTube video provenance rows");
    }
    const existing = rowsForVideo[0];
    if (existing) {
      if (!sameRetryableVideoReleaseProvenance(existing, write)) {
        throw new Error("videoReleaseProvenance.record: immutable provenance conflict");
      }
      return existing._id;
    }

    const rowsForRun = await ctx.db
      .query("videoReleaseProvenance")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    if (rowsForRun.length > 0) {
      throw new Error("videoReleaseProvenance.record: run already maps a different YouTube video");
    }

    return await ctx.db.insert("videoReleaseProvenance", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      publishIntentId: args.publishIntentId,
      youtubeVideoId: args.youtubeVideoId,
      version: "video-release-provenance/v1",
      releaseCertificateKey: args.releaseCertificateKey,
      releaseCertificateFingerprint: args.releaseCertificateFingerprint,
      finalMasterSha256: args.finalMasterSha256,
      qualityBindingVersion: args.qualityBindingVersion,
      qualityBindingFingerprint: args.qualityBindingFingerprint,
      qualityEvidenceFingerprint: args.qualityEvidenceFingerprint,
      contentLaneKey: args.contentLaneKey,
      renderer: args.renderer,
      programRoute: args.programRoute,
      releaseEvidenceStatus: "release_evidence_recorded",
      evidenceStatus: args.evidenceStatus,
      ...(args.storyMeasurementCoverage === undefined
        ? {}
        : { storyMeasurementCoverage: args.storyMeasurementCoverage }),
      uploadedAt,
      recordedAt: Date.now(),
    });
  },
});
