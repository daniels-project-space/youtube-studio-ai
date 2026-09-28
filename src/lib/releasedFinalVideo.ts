import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { parseFinalMasterReleaseCertificateBytes } from "@/lib/finalMasterReleaseCertificate";
import { FINAL_VIDEO_RETENTION_MS, releasedFinalVideoKey, YOUTUBE_STUDIO_R2_BUCKET } from "@/lib/r2AssetRetention";
import { getObjectBytes, getObjectIntegrity, getObjectToFile, headObjectMetadata, putObjectFromFile } from "@/lib/storage";

export type ReleasedFinalVideoReceipt = {
  sourceKey: string;
  sourceEtag: string;
  r2Key: string;
  sha256: string;
  byteLength: number;
  releaseAt: number;
  expiresAt: number;
};

/** Copy only a certificate-bound master after YouTube confirms its public release. */
export async function copyReleasedFinalVideo(input: {
  keyPrefix: string; runId: string; certificateKey: string; releaseAt: number;
}): Promise<ReleasedFinalVideoReceipt> {
  const certificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(input.certificateKey));
  const source = certificate.finalMaster;
  const runPrefix = `${input.keyPrefix}runs/${input.runId}/`;
  if (!source.r2Key.startsWith(runPrefix) || !source.byteLength ||
      source.sha256 !== source.sha256.toLowerCase()) {
    throw new Error("release copy source must be the exact run-local certificate master with a byte receipt");
  }
  const sourceHead = await headObjectMetadata(source.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
  if (!sourceHead?.etag || sourceHead.contentLength !== source.byteLength) {
    throw new Error("release copy source has no matching ETag and byte length");
  }
  const receipt: ReleasedFinalVideoReceipt = {
    sourceKey: source.r2Key,
    sourceEtag: sourceHead.etag,
    r2Key: releasedFinalVideoKey(input.keyPrefix, input.runId, input.releaseAt, source.sha256),
    sha256: source.sha256,
    byteLength: source.byteLength,
    releaseAt: input.releaseAt,
    expiresAt: input.releaseAt + FINAL_VIDEO_RETENTION_MS,
  };
  if (!Number.isSafeInteger(receipt.expiresAt)) throw new Error("release copy expiry is invalid");
  const metadata = {
    retentionWriter: "released-final/v2",
    retentionFinalSha256: receipt.sha256,
    retentionReleaseAt: String(receipt.releaseAt),
    retentionExpiresAt: String(receipt.expiresAt),
    retentionSourceKey: receipt.sourceKey,
    retentionSourceEtag: receipt.sourceEtag,
  };
  const verifyExisting = async () => {
    const head = await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
    const meta = Object.fromEntries(Object.entries(head?.metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (!head || head.contentLength !== receipt.byteLength ||
        Object.entries(metadata).some(([key, value]) => meta[key.toLowerCase()] !== value)) {
      throw new Error("released final video key already exists without matching receipt metadata");
    }
    const integrity = await getObjectIntegrity(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
    if (integrity.sha256 !== receipt.sha256 || integrity.byteLength !== receipt.byteLength) {
      throw new Error("released final video key already exists with different bytes");
    }
  };
  if (await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET)) {
    await verifyExisting();
    return receipt;
  }
  const tempDir = await makeRunTempDir(`release-copy-${input.runId}`);
  try {
    const path = join(tempDir, "final.mp4");
    await getObjectToFile(source.r2Key, path, YOUTUBE_STUDIO_R2_BUCKET, sourceHead.etag);
    const file = await stat(path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    if (file.size !== receipt.byteLength || hash.digest("hex") !== receipt.sha256) {
      throw new Error("release copy source differs from the certified final master");
    }
    try {
      await putObjectFromFile(receipt.r2Key, path, {
        bucket: YOUTUBE_STUDIO_R2_BUCKET, contentType: "video/mp4", ifNoneMatch: "*", metadata,
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
      await verifyExisting();
    }
    await verifyExisting();
    return receipt;
  } finally {
    await cleanupDir(tempDir);
  }
}
