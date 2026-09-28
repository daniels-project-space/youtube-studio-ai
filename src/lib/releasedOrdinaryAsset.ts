import { isLoFiOrdinarySource, releasedOrdinaryAssetKey, type ReleasedOrdinaryClass } from "@/lib/r2AssetRetention";
import {
  copyReleaseBoundRunAsset, type ReleasedRunAssetReceipt, type ReleasedRunAssetSource,
} from "@/lib/releasedRunAsset";

export type ReleasedOrdinarySource = ReleasedRunAssetSource & { kind: ReleasedOrdinaryClass };
export type ReleasedOrdinaryReceipt = ReleasedRunAssetReceipt & { kind: ReleasedOrdinaryClass };

export async function copyReleasedOrdinaryAsset(input: {
  keyPrefix: string; runId: string; releaseAt: number; source: ReleasedOrdinarySource;
}): Promise<ReleasedOrdinaryReceipt> {
  const kind = input.source.kind;
  const receipt = await copyReleaseBoundRunAsset({
    ...input,
    acceptsSource: (keyPrefix, runId, sourceKey) => isLoFiOrdinarySource(kind, keyPrefix, runId, sourceKey),
    destinationKey: (keyPrefix, runId, assetId, releaseAt, sha256) =>
      releasedOrdinaryAssetKey(keyPrefix, runId, kind, assetId, releaseAt, sha256),
    retentionWriter: "released-ordinary/v2",
    digestMetadataKey: "retentionAssetSha256",
    extraMetadata: { retentionAssetClass: kind },
    contentType: "video/mp4", extension: "mp4",
  });
  return { ...receipt, kind };
}
