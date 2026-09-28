import assert from "node:assert/strict";
import { test } from "node:test";
import { projectReleasedOrdinaryAssets } from "../ordinaryAssetProjection";
import { ASSET_RETENTION_MS } from "../r2AssetRetention";

test("only finished, live, exact Lo-Fi copies replace reader keys", () => {
  const now = 1_800_000_000_000;
  const source = [
    { _id: "clip1", ownerId: "o", channelId: "c", kind: "clip", r2Key: "run/loopraw.mp4" },
    { _id: "unit1", ownerId: "o", channelId: "c", kind: "loop_unit", r2Key: "run/loopunit_4k.mp4" },
    { _id: "still1", ownerId: "o", channelId: "c", kind: "keyframe", r2Key: "run/lofi-keyframe/images/keyframe-1.png" },
    { _id: "thumb1", ownerId: "o", channelId: "c", kind: "thumbnail", r2Key: "run/nano.png" },
  ];
  const copy = { assetId: "clip1", ownerId: "o", channelId: "c", assetClass: "lofi-clip",
    sourceKey: source[0].r2Key, copyKey: "released-ordinary/v2/clip", releaseAt: now - 1_000,
    status: "finished" };
  const stillCopy = { ...copy, assetId: "still1", assetClass: "lofi-keyframe",
    sourceKey: source[2].r2Key, copyKey: "released-ordinary/v2/still" };
  const result = projectReleasedOrdinaryAssets(source, [copy, { ...copy, assetId: "unit1",
    assetClass: "lofi-loop-unit", sourceKey: source[1].r2Key, copyKey: "released-ordinary/v2/unit" }, stillCopy], now);
  assert.equal(result[0].r2Key, copy.copyKey);
  assert.equal(result[1].r2Key, "released-ordinary/v2/unit");
  assert.equal(result[2].r2Key, stillCopy.copyKey);
  assert.equal(result[3], source[3]);
  for (const invalid of [{ ...stillCopy, status: "active" }, { ...stillCopy, assetId: "other" },
    { ...stillCopy, releaseAt: now - ASSET_RETENTION_MS }]) {
    assert.equal(projectReleasedOrdinaryAssets(source, [invalid], now)[2].r2Key, source[2].r2Key);
  }
  assert.equal(source[0].r2Key, "run/loopraw.mp4", "stored source row remains unchanged");
  for (const invalid of [
    { ...copy, status: "active" },
    { ...copy, ownerId: "other" },
    { ...copy, sourceKey: "other-source" },
    { ...copy, assetClass: "thumbnail" },
    { ...copy, releaseAt: now - ASSET_RETENTION_MS },
  ]) assert.equal(projectReleasedOrdinaryAssets(source, [invalid], now)[0].r2Key, source[0].r2Key);
});
