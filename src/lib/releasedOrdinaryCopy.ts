import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ASSET_RETENTION_MS, hasUnchangedOrdinarySourceHead, releasedKeyframeKey, releasedOrdinaryAssetKey, type ReleasedOrdinaryClass } from "@/lib/r2AssetRetention";
import { assertStudioRetentionR2Destination } from "@/lib/youtubeR2Account";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { getObjectIntegrity, getObjectToFile, headObjectMetadata, putObjectFromFile } from "@/lib/storage";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { getAccessToken } from "@/lib/youtube";
import { evaluateRunArtifactRelease } from "@/lib/runArtifactRetention";

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function assertFreshPublicRelease(input: {
  ownerId: string; convex: StudioConvexHttpClient; channelId: Id<"channels">;
  videoId: string; youtubeChannelId: string; releaseAt: number;
}): Promise<void> {
  const connector = await requireYouTubeConnector(input.convex,
    { ownerId: input.ownerId, channelId: input.channelId });
  if (connector.ytChannelId !== input.youtubeChannelId) throw new Error("ordinary release YouTube channel changed");
  const params = new URLSearchParams({ part: "snippet,status", id: input.videoId,
    fields: "items(id,snippet(channelId,publishedAt),status(privacyStatus,uploadStatus))" });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`,
    { headers: { Authorization: `Bearer ${await getAccessToken(connector.refreshToken)}` },
      signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ordinary release YouTube observation HTTP ${response.status}`);
  const body = await response.json() as { items?: Array<{ id?: string;
    snippet?: { channelId?: string; publishedAt?: string };
    status?: { privacyStatus?: string; uploadStatus?: string } }> };
  if (!Array.isArray(body.items) || body.items.length !== 1 || body.items[0]?.id !== input.videoId)
    throw new Error("ordinary release YouTube observation is ambiguous");
  const item = body.items[0];
  const observedAt = Date.now();
  const decision = evaluateRunArtifactRelease({ expectedVideoId: input.videoId,
    expectedChannelId: input.youtubeChannelId, observedAt,
    observation: { videoId: item.id!, channelId: item.snippet?.channelId ?? "",
      privacyStatus: item.status?.privacyStatus, uploadStatus: item.status?.uploadStatus,
      publishedAt: item.snippet?.publishedAt } });
  if (!decision.released || decision.releaseAt !== input.releaseAt)
    throw new Error("ordinary release is not freshly public and processed at its bound generation");
}

/** Explicit, create-only copy for an observed released Lo-Fi asset. No source mutation. */
export async function createVerifiedReleasedOrdinaryCopy(input: {
  ownerId: string; assetId: Id<"assets">; convex: StudioConvexHttpClient;
}): Promise<string | null> {
  assertStudioRetentionR2Destination({ bucket: process.env.R2_BUCKET,
    accountId: process.env.R2_ACCOUNT_ID,
    expectedAccountId: process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID,
    endpoint: process.env.R2_ENDPOINT });
  const { ownerId, assetId, convex } = input;
  const candidate = await convex.query(api.releasedOrdinaryAssets.candidate, { ownerId, assetId, now: Date.now() });
  if (!candidate) return null;
  const source = await headObjectMetadata(candidate.sourceKey);
  if (!source?.etag || !source.lastModified || !source.contentLength || source.contentLength < 1)
    throw new Error("ordinary release source lacks exact R2 head");
  const temporary = await makeRunTempDir(`released-ordinary-${String(candidate.runId)}`);
  try {
    const keyframe = candidate.assetClass === "lofi-keyframe";
    const local = join(temporary, keyframe ? "source.png" : "source.mp4");
    await getObjectToFile(candidate.sourceKey, local, undefined, source.etag);
    const [sha256, file] = await Promise.all([hashFile(local), stat(local)]);
    if (file.size !== source.contentLength) throw new Error("ordinary release source bytes changed");
    const assetClass = candidate.assetClass as ReleasedOrdinaryClass | "lofi-keyframe";
    const copyKey = keyframe
      ? releasedKeyframeKey(candidate.keyPrefix, String(candidate.runId), String(assetId), candidate.releaseAt, sha256)
      : releasedOrdinaryAssetKey(candidate.keyPrefix, String(candidate.runId),
          assetClass as ReleasedOrdinaryClass, String(assetId), candidate.releaseAt, sha256);
    const identity = { ownerId, assetId, releaseAt: candidate.releaseAt, assetClass,
      sourceKey: candidate.sourceKey, sourceEtag: source.etag,
      sourceLastModifiedAt: source.lastModified.getTime(), sourceSha256: sha256,
      sourceByteLength: file.size, copyKey };
    const reservation = await convex.mutation(api.releasedOrdinaryAssets.begin, identity);
    if (reservation.status !== "finished") {
      const current = await convex.query(api.releasedOrdinaryAssets.candidate,
        { ownerId, assetId, now: Date.now() });
      if (!current || current.sourceKey !== identity.sourceKey ||
          current.releaseAt !== identity.releaseAt || current.assetClass !== identity.assetClass)
        throw new Error("ordinary release changed before conditional PUT");
      await assertFreshPublicRelease({ ownerId, convex, channelId: current.channelId,
        videoId: current.videoId, youtubeChannelId: current.youtubeChannelId,
        releaseAt: current.releaseAt });
      try {
        await putObjectFromFile(copyKey, local, { contentType: keyframe ? "image/png" : "video/mp4", ifNoneMatch: "*",
          metadata: { retentionWriter: "released-ordinary/v2", ...(keyframe
              ? { retentionKeyframeSha256: sha256 } : { retentionAssetSha256: sha256 }),
            retentionAssetId: String(assetId), retentionAssetClass: assetClass,
            retentionSourceKey: candidate.sourceKey, retentionSourceEtag: source.etag,
            retentionReleaseAt: String(candidate.releaseAt),
            retentionExpiresAt: String(candidate.releaseAt + ASSET_RETENTION_MS) } });
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status !== 409 && status !== 412) throw error;
      }
    }
    const [copy, integrity] = await Promise.all([headObjectMetadata(copyKey), getObjectIntegrity(copyKey)]);
    const metadata = Object.fromEntries(Object.entries(copy?.metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (!copy?.etag || !copy.lastModified || copy.contentLength !== file.size ||
        integrity.sha256 !== sha256 || integrity.byteLength !== file.size ||
        metadata.retentionwriter !== "released-ordinary/v2" ||
        metadata[keyframe ? "retentionkeyframesha256" : "retentionassetsha256"] !== sha256 ||
        metadata.retentionassetid !== String(assetId) ||
        metadata.retentionassetclass !== assetClass || metadata.retentionsourcekey !== candidate.sourceKey ||
        metadata.retentionsourceetag !== source.etag ||
        metadata.retentionreleaseat !== String(candidate.releaseAt) ||
        metadata.retentionexpiresat !== String(candidate.releaseAt + ASSET_RETENTION_MS))
      throw new Error("ordinary release copy bytes or provenance disagree with source");
    if (reservation.status !== "finished") {
      await assertFreshPublicRelease({ ownerId, convex, channelId: candidate.channelId,
        videoId: candidate.videoId, youtubeChannelId: candidate.youtubeChannelId,
        releaseAt: candidate.releaseAt });
      // The source is a mutable run key. The conditional GET proved which
      // bytes we copied; re-HEAD it before committing the ledger so a later
      // overwrite cannot be described as the same source generation.
      const sourceAfterCopy = await headObjectMetadata(candidate.sourceKey);
      if (!hasUnchangedOrdinarySourceHead({ etag: identity.sourceEtag,
        lastModifiedAt: identity.sourceLastModifiedAt, byteLength: identity.sourceByteLength }, sourceAfterCopy))
        throw new Error("ordinary release source changed after conditional GET");
      await convex.mutation(api.releasedOrdinaryAssets.finish, {
        ...identity, copyEtag: copy.etag, copyLastModifiedAt: copy.lastModified.getTime(), finishedAt: Date.now(),
      });
    }
    return copyKey;
  } finally {
    await cleanupDir(temporary);
  }
}
