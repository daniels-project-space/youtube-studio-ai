import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { ASSET_RETENTION_MS, isLoFiKeyframeSource, releasedKeyframeKey, YOUTUBE_STUDIO_R2_BUCKET } from "@/lib/r2AssetRetention";
import { getObjectIntegrity, getObjectToFile, headObjectMetadata, putObjectFromFile } from "@/lib/storage";
import type { Id } from "../../convex/_generated/dataModel";

export type ReleasedKeyframeSource = { assetId: Id<"assets">; sourceKey: string };
export type ReleasedKeyframeReceipt = ReleasedKeyframeSource & {
  sourceEtag: string; r2Key: string; sha256: string; byteLength: number;
  releaseAt: number; expiresAt: number;
};

export async function copyReleasedKeyframe(input: {
  keyPrefix: string; runId: string; releaseAt: number; source: ReleasedKeyframeSource;
}): Promise<ReleasedKeyframeReceipt> {
  const { sourceKey, assetId } = input.source;
  if (!isLoFiKeyframeSource(input.keyPrefix, input.runId, sourceKey) || !assetId ||
      !Number.isSafeInteger(input.releaseAt) || input.releaseAt < 0) {
    throw new Error("released keyframe requires an exact marked run-local source");
  }
  const sourceHead = await headObjectMetadata(sourceKey, YOUTUBE_STUDIO_R2_BUCKET);
  if (!sourceHead?.etag || !sourceHead.contentLength || sourceHead.contentLength > 64 * 1024 ** 2) {
    throw new Error("released keyframe source has no bounded byte length and ETag");
  }
  const expiresAt = input.releaseAt + ASSET_RETENTION_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("released keyframe expiry is invalid");
  const tempDir = await makeRunTempDir(`released-keyframe-${input.runId}`);
  try {
    const path = join(tempDir, "keyframe.png");
    await getObjectToFile(sourceKey, path, YOUTUBE_STUDIO_R2_BUCKET, sourceHead.etag);
    const file = await stat(path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    if (file.size !== sourceHead.contentLength) throw new Error("released keyframe source changed during copy");
    const sha256 = hash.digest("hex");
    const receipt: ReleasedKeyframeReceipt = {
      assetId, sourceKey, sourceEtag: sourceHead.etag,
      r2Key: releasedKeyframeKey(input.keyPrefix, input.runId, input.releaseAt, sha256),
      sha256, byteLength: file.size, releaseAt: input.releaseAt, expiresAt,
    };
    const metadata = {
      retentionWriter: "released-keyframe/v1", retentionKeyframeSha256: sha256,
      retentionReleaseAt: String(input.releaseAt), retentionExpiresAt: String(expiresAt),
      retentionSourceKey: sourceKey, retentionSourceEtag: sourceHead.etag,
      retentionAssetId: assetId,
    };
    const verifyExisting = async () => {
      const head = await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
      const meta = Object.fromEntries(Object.entries(head?.metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      if (!head || head.contentLength !== receipt.byteLength ||
          Object.entries(metadata).some(([key, value]) => meta[key.toLowerCase()] !== value)) {
        throw new Error("released keyframe key already exists without matching receipt metadata");
      }
      const integrity = await getObjectIntegrity(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
      if (integrity.sha256 !== sha256 || integrity.byteLength !== receipt.byteLength) {
        throw new Error("released keyframe key already exists with different bytes");
      }
    };
    if (!await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET)) {
      try {
        await putObjectFromFile(receipt.r2Key, path, {
          bucket: YOUTUBE_STUDIO_R2_BUCKET, contentType: "image/png", ifNoneMatch: "*", metadata,
        });
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status !== 409 && status !== 412) throw error;
      }
    }
    await verifyExisting();
    return receipt;
  } finally {
    await cleanupDir(tempDir);
  }
}
