import { isLoFiKeyframeSource, releasedKeyframeKey } from "@/lib/r2AssetRetention";
import {
  copyReleaseBoundRunAsset, type ReleasedRunAssetReceipt, type ReleasedRunAssetSource,
} from "@/lib/releasedRunAsset";

export type ReleasedKeyframeSource = ReleasedRunAssetSource;
export type ReleasedKeyframeReceipt = ReleasedRunAssetReceipt;

export async function copyReleasedKeyframe(input: {
  keyPrefix: string; runId: string; releaseAt: number; source: ReleasedKeyframeSource;
}): Promise<ReleasedKeyframeReceipt> {
  return copyReleaseBoundRunAsset({
    ...input,
    acceptsSource: isLoFiKeyframeSource,
    destinationKey: (keyPrefix, runId, _assetId, releaseAt, sha256) =>
      releasedKeyframeKey(keyPrefix, runId, releaseAt, sha256),
    retentionWriter: "released-keyframe/v1",
    digestMetadataKey: "retentionKeyframeSha256",
    contentType: "image/png", extension: "png", maxByteLength: 64 * 1024 ** 2,
  });
}
