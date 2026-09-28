import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { parseFinalMasterReleaseCertificateBytes, retainedFinalMasterReleaseObjectKeys } from "@/lib/finalMasterReleaseCertificate";
import { FINAL_VIDEO_RETENTION_MS, releasedFinalVideoKey } from "@/lib/r2AssetRetention";
import { assertStudioRetentionR2Destination } from "@/lib/youtubeR2Account";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { getObjectBytes, getObjectIntegrity, getObjectToFile, headObjectMetadata, putObjectFromFile } from "@/lib/storage";

type Candidate = { retentionId: Id<"runArtifactRetentions">; runId: Id<"runs">;
  channelId: Id<"channels">; keyPrefix: string; certificateKey: string; releaseAt: number };

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Public release is the only trigger. This never mutates the certified source. */
export async function createVerifiedReleasedFinalCopy(input: {
  ownerId: string; candidate: Candidate; convex: StudioConvexHttpClient;
}): Promise<string> {
  assertStudioRetentionR2Destination({ bucket: process.env.R2_BUCKET,
    accountId: process.env.R2_ACCOUNT_ID,
    expectedAccountId: process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID,
    endpoint: process.env.R2_ENDPOINT });
  const { candidate, convex, ownerId } = input;
  const certificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(candidate.certificateKey));
  retainedFinalMasterReleaseObjectKeys({ keyPrefix: candidate.keyPrefix, runId: String(candidate.runId),
    certificateKey: candidate.certificateKey, certificate });
  const sourceKey = certificate.finalMaster.r2Key;
  if (!Number.isSafeInteger(certificate.finalMaster.byteLength) ||
      !certificate.finalMaster.byteLength || certificate.finalMaster.byteLength < 1) {
    throw new Error("released final certificate has no exact source byte length");
  }
  const sourceByteLength = certificate.finalMaster.byteLength;
  const source = await headObjectMetadata(sourceKey);
  if (!source?.etag || !source.lastModified || source.contentLength !== sourceByteLength) {
    throw new Error("released final source has no exact certified R2 head");
  }
  const copyKey = releasedFinalVideoKey(candidate.keyPrefix, String(candidate.runId),
    candidate.releaseAt, certificate.finalMaster.sha256);
  const claimId = (() => {
    const hex = createHash("sha256").update(JSON.stringify([ownerId, String(candidate.runId),
      candidate.releaseAt, sourceKey, copyKey, certificate.certificateFingerprint])).digest("hex").slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  })();
  const identity = { ownerId, retentionId: candidate.retentionId, releaseAt: candidate.releaseAt,
    certificateKey: candidate.certificateKey, certificateFingerprint: certificate.certificateFingerprint,
    sourceKey, sourceSha256: certificate.finalMaster.sha256,
    sourceByteLength,
    sourceEtag: source.etag, sourceLastModifiedAt: source.lastModified.getTime(), copyKey, claimId };
  const reservation = await convex.mutation(api.releasedFinalMasters.begin, identity);
  const temporary = await makeRunTempDir(`released-final-${String(candidate.runId)}`);
  try {
    const local = join(temporary, "certified-master.mp4");
    await getObjectToFile(sourceKey, local, undefined, source.etag);
    const [localSha, localStat] = await Promise.all([hashFile(local), stat(local)]);
    if (localSha !== identity.sourceSha256 ||
        localStat.size !== identity.sourceByteLength) throw new Error("released final source bytes changed or disagree with certificate");
    const sourceAfter = await headObjectMetadata(sourceKey);
    if (!sourceAfter || sourceAfter.etag !== source.etag ||
        sourceAfter.lastModified?.getTime() !== source.lastModified.getTime() ||
        sourceAfter.contentLength !== source.contentLength) throw new Error("released final source changed during copy");
    if (reservation.status !== "finished") {
      try {
        await putObjectFromFile(copyKey, local, { contentType: "video/mp4", ifNoneMatch: "*",
          metadata: { retentionWriter: "released-final/v2", retentionFinalSha256: identity.sourceSha256,
            retentionSourceKey: sourceKey, retentionSourceEtag: source.etag,
            retentionCertificateKey: candidate.certificateKey,
            retentionCertificateFingerprint: certificate.certificateFingerprint,
            retentionReleaseAt: String(candidate.releaseAt),
            retentionExpiresAt: String(candidate.releaseAt + FINAL_VIDEO_RETENTION_MS) } });
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status !== 409 && status !== 412) throw error;
      }
    }
    const [copy, integrity] = await Promise.all([headObjectMetadata(copyKey), getObjectIntegrity(copyKey)]);
    const meta = Object.fromEntries(Object.entries(copy?.metadata ?? {}).map(([k, value]) => [k.toLowerCase(), value]));
    if (!copy?.etag || !copy.lastModified || copy.contentLength !== identity.sourceByteLength ||
        integrity.sha256 !== identity.sourceSha256 || integrity.byteLength !== identity.sourceByteLength ||
        meta.retentionwriter !== "released-final/v2" || meta.retentionfinalsha256 !== identity.sourceSha256 ||
        meta.retentionsourcekey !== sourceKey || meta.retentionsourceetag !== source.etag ||
        meta.retentioncertificatekey !== candidate.certificateKey ||
        meta.retentioncertificatefingerprint !== certificate.certificateFingerprint ||
        meta.retentionreleaseat !== String(candidate.releaseAt) ||
        meta.retentionexpiresat !== String(candidate.releaseAt + FINAL_VIDEO_RETENTION_MS)) {
      throw new Error("released final copy bytes or immutable metadata disagree with certified source");
    }
    await convex.mutation(api.releasedFinalMasters.finish, { ...identity,
      copyEtag: copy.etag, copyLastModifiedAt: copy.lastModified.getTime(), finishedAt: Date.now() });
    return copyKey;
  } finally {
    await cleanupDir(temporary);
  }
}
