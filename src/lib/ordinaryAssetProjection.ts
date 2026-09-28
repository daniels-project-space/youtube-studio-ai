import { ASSET_RETENTION_MS } from "@/lib/r2AssetRetention";

type Asset = { _id: string; ownerId: string; channelId: string; kind: string; r2Key: string };
type Copy = { assetId: string; ownerId: string; channelId: string; assetClass: string;
  sourceKey: string; copyKey: string; releaseAt: number; status: string };

/** Read-only projection; source rows, stage outputs and protected media remain intact. */
export function projectReleasedOrdinaryAssets<T extends Asset>(
  assets: readonly T[], copies: readonly Copy[], now: number,
): T[] {
  const byAsset = new Map<string, Copy>();
  for (const copy of copies) {
    if (copy.status !== "finished" || copy.releaseAt + ASSET_RETENTION_MS <= now) continue;
    const prior = byAsset.get(String(copy.assetId));
    if (!prior || copy.releaseAt > prior.releaseAt) byAsset.set(String(copy.assetId), copy);
  }
  return assets.map(asset => {
    const copy = byAsset.get(String(asset._id));
    const expected = asset.kind === "clip" ? "lofi-clip" : asset.kind === "loop_unit" ? "lofi-loop-unit" : null;
    return copy && expected === copy.assetClass && copy.ownerId === asset.ownerId &&
      copy.channelId === asset.channelId && copy.sourceKey === asset.r2Key
      ? { ...asset, r2Key: copy.copyKey } : asset;
  });
}
