import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Id } from "../../convex/_generated/dataModel";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { ASSET_RETENTION_MS, YOUTUBE_STUDIO_R2_BUCKET } from "@/lib/r2AssetRetention";
import { getObjectIntegrity, getObjectToFile, headObjectMetadata, putObjectFromFile } from "@/lib/storage";

export type ReleasedRunAssetSource = { assetId: Id<"assets">; sourceKey: string };
export type ReleasedRunAssetReceipt = ReleasedRunAssetSource & {
  sourceEtag: string; r2Key: string; sha256: string; byteLength: number;
  releaseAt: number; expiresAt: number;
};

/** Shared byte and lineage proof for explicitly admitted run-local release classes. */
export async function copyReleaseBoundRunAsset(input: {
  keyPrefix: string; runId: string; releaseAt: number; source: ReleasedRunAssetSource;
  acceptsSource: (keyPrefix: string, runId: string, sourceKey: string) => boolean;
  destinationKey: (keyPrefix: string, runId: string, assetId: string, releaseAt: number, sha256: string) => string;
  retentionWriter: string; digestMetadataKey: string; contentType: string; extension: string;
  extraMetadata?: Record<string, string>;
  maxByteLength?: number;
}): Promise<ReleasedRunAssetReceipt> {
  const { sourceKey, assetId } = input.source;
  if (!input.acceptsSource(input.keyPrefix, input.runId, sourceKey) || !assetId ||
      !Number.isSafeInteger(input.releaseAt) || input.releaseAt < 0) {
    throw new Error("release copy requires an exact marked run-local source");
  }
  const sourceHead = await headObjectMetadata(sourceKey, YOUTUBE_STUDIO_R2_BUCKET);
  if (!sourceHead?.etag || !sourceHead.contentLength ||
      (input.maxByteLength !== undefined && sourceHead.contentLength > input.maxByteLength)) {
    throw new Error("release copy source has no permitted byte length and ETag");
  }
  const expiresAt = input.releaseAt + ASSET_RETENTION_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("release copy expiry is invalid");
  const tempDir = await makeRunTempDir(`released-asset-${input.runId}`);
  try {
    const path = join(tempDir, `asset.${input.extension}`);
    await getObjectToFile(sourceKey, path, YOUTUBE_STUDIO_R2_BUCKET, sourceHead.etag);
    const file = await stat(path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    if (file.size !== sourceHead.contentLength) throw new Error("release copy source changed during copy");
    const sha256 = hash.digest("hex");
    const receipt: ReleasedRunAssetReceipt = {
      assetId, sourceKey, sourceEtag: sourceHead.etag,
      r2Key: input.destinationKey(input.keyPrefix, input.runId, assetId, input.releaseAt, sha256),
      sha256, byteLength: file.size, releaseAt: input.releaseAt, expiresAt,
    };
    const metadata = {
      retentionWriter: input.retentionWriter,
      [input.digestMetadataKey]: sha256,
      retentionReleaseAt: String(input.releaseAt), retentionExpiresAt: String(expiresAt),
      retentionSourceKey: sourceKey, retentionSourceEtag: sourceHead.etag,
      retentionAssetId: assetId,
      ...input.extraMetadata,
    };
    const verifyExisting = async () => {
      const head = await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
      const meta = Object.fromEntries(Object.entries(head?.metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      if (!head || head.contentLength !== receipt.byteLength ||
          Object.entries(metadata).some(([key, value]) => meta[key.toLowerCase()] !== value)) {
        throw new Error("release copy key already exists without matching receipt metadata");
      }
      const integrity = await getObjectIntegrity(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
      if (integrity.sha256 !== sha256 || integrity.byteLength !== receipt.byteLength) {
        throw new Error("release copy key already exists with different bytes");
      }
    };
    if (!await headObjectMetadata(receipt.r2Key, YOUTUBE_STUDIO_R2_BUCKET)) {
      try {
        await putObjectFromFile(receipt.r2Key, path, {
          bucket: YOUTUBE_STUDIO_R2_BUCKET, contentType: input.contentType, ifNoneMatch: "*", metadata,
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
