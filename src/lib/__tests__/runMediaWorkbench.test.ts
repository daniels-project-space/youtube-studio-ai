import assert from "node:assert/strict";
import {
  mediaFacts,
  mediaType,
  orderRunMedia,
  projectReleasedKeyframeAssets,
  projectReleasedOrdinaryAssets,
  selectedRunMaster,
  summarizeStageReceipts,
  visibleRunMedia,
  type RunMediaAsset,
} from "../runMediaWorkbench";

const assets: RunMediaAsset[] = [
  { _id: "old-video", _creationTime: 1, kind: "video", r2Key: "runs/one/old.mp4" },
  { _id: "thumbnail", _creationTime: 3, kind: "thumbnail", r2Key: "runs/one/thumb.png" },
  { _id: "master", _creationTime: 2, kind: "video", r2Key: "runs/one/final.mp4" },
];

const sourceAssets = [
  { _id: "accepted", kind: "keyframe", r2Key: "runs/one/lofi-keyframe/images/a.png" },
  { _id: "other", kind: "keyframe", r2Key: "runs/one/lofi-keyframe/images/b.png" },
  { _id: "thumb", kind: "thumbnail", r2Key: "runs/one/thumb.png" },
];
const keyframeCopy = { assetId: "accepted", sourceKey: sourceAssets[0].r2Key,
  r2Key: "released-ordinary/v2/owner/fixture/channel/show/runs/one/lofi-keyframe/1-abc.png", releaseAt: 1, expiresAt: 10 };
assert.deepEqual(projectReleasedKeyframeAssets(sourceAssets, keyframeCopy, 1, false, 2).map((asset) => asset.r2Key),
  [keyframeCopy.r2Key, sourceAssets[1].r2Key, sourceAssets[2].r2Key]);
assert.deepEqual(projectReleasedKeyframeAssets(sourceAssets, keyframeCopy, 1, true, 2).map((asset) => asset._id),
  ["other", "thumb"]);
assert.deepEqual(projectReleasedKeyframeAssets(sourceAssets, { ...keyframeCopy, sourceKey: "wrong" }, 1, false, 2), sourceAssets);
assert.deepEqual(projectReleasedKeyframeAssets(sourceAssets, keyframeCopy, 2, false, 2), sourceAssets);
assert.deepEqual(projectReleasedKeyframeAssets(sourceAssets, keyframeCopy, 1, false, 10).map((asset) => asset._id),
  ["other", "thumb"]);

const ordinary = [
  { _id: "clip", kind: "clip", r2Key: "runs/one/loopraw.mp4" },
  { _id: "unit", kind: "loop_unit", r2Key: "runs/one/loopunit_4k.mp4" },
  { _id: "legacy", kind: "clip", r2Key: "runs/one/old.mp4" },
  { _id: "thumb", kind: "thumbnail", r2Key: "runs/one/thumbnail.png" },
];
const ordinaryCopies = [
  { kind: "lofi-clip" as const, assetId: "clip", sourceKey: ordinary[0].r2Key,
    r2Key: "released-ordinary/v2/owner/fixture/channel/show/runs/one/lofi-clip/clip/copy.mp4", releaseAt: 1, expiresAt: 10 },
  { kind: "lofi-loop-unit" as const, assetId: "unit", sourceKey: ordinary[1].r2Key,
    r2Key: "released-ordinary/v2/owner/fixture/channel/show/runs/one/lofi-loop-unit/unit/copy.mp4", releaseAt: 1, expiresAt: 10 },
];
assert.deepEqual(projectReleasedOrdinaryAssets(ordinary, ordinaryCopies, 1, new Set(), 2).map((asset) => asset.r2Key),
  [ordinaryCopies[0].r2Key, ordinaryCopies[1].r2Key, ordinary[2].r2Key, ordinary[3].r2Key]);
assert.deepEqual(projectReleasedOrdinaryAssets(ordinary, ordinaryCopies, 1, new Set(["clip"]), 2)
  .map((asset) => asset._id), ["unit", "legacy", "thumb"]);
assert.deepEqual(projectReleasedOrdinaryAssets(ordinary, ordinaryCopies, 2, new Set(), 2), ordinary);
assert.deepEqual(projectReleasedOrdinaryAssets(ordinary, ordinaryCopies, 1, new Set(), 10).map((asset) => asset._id),
  ["legacy", "thumb"]);

assert.deepEqual(orderRunMedia(assets).map((asset) => asset._id), ["thumbnail", "master", "old-video"]);
assert.equal(selectedRunMaster(assets, "master")?._id, "master");
assert.equal(
  selectedRunMaster(assets, "thumbnail")?._id,
  "master",
  "a non-video selected asset must not be presented as the video master",
);
assert.equal(mediaType(assets[1]!), "image");
assert.equal(mediaType(assets[2]!), "video");
assert.equal(mediaType({ kind: "narration", r2Key: "runs/one/narration.mp3" }), "audio");

const many = Array.from({ length: 14 }, (_, index) => ({
  _id: `asset-${index}`,
  _creationTime: index,
  kind: "keyframe",
  r2Key: `runs/one/${index}.png`,
}));
const masterOutsideRecent: RunMediaAsset = {
  _id: "selected-master",
  _creationTime: -1,
  kind: "video",
  r2Key: "runs/one/final.mp4",
};
assert.equal(
  visibleRunMedia([...many, masterOutsideRecent], masterOutsideRecent, false).length,
  12,
  "the first view must cap preview requests while preserving the selected master",
);
assert.equal(
  visibleRunMedia([...many, masterOutsideRecent], masterOutsideRecent, false)[0]?._id,
  "selected-master",
);

assert.deepEqual(mediaFacts({ durationSec: 42, width: 1920, height: 1080, engine: "ffmpeg" }), [
  "Duration 42s",
  "1920 × 1080",
  "Engine ffmpeg",
]);
assert.deepEqual(summarizeStageReceipts([{ block: "assemble", status: "running" }]), {
  completedLabel: "0/1",
  skippedLabel: "0",
  activeLabel: "Assemble",
  tone: "active",
});
assert.deepEqual(summarizeStageReceipts([{ block: "qa_visual", status: "failed" }]), {
  completedLabel: "0/1",
  skippedLabel: "0",
  activeLabel: "Needs attention",
  tone: "attention",
});
assert.deepEqual(summarizeStageReceipts(undefined), {
  completedLabel: "…", skippedLabel: "…", activeLabel: "Loading", tone: "neutral",
});
assert.deepEqual(summarizeStageReceipts([]), {
  completedLabel: "0/0", skippedLabel: "0", activeLabel: "Awaiting receipt", tone: "neutral",
});
assert.deepEqual(summarizeStageReceipts([{ block: "assemble", status: "ok" }]), {
  completedLabel: "1/1", skippedLabel: "0", activeLabel: "No active stage", tone: "complete",
});
assert.deepEqual(summarizeStageReceipts([{ block: "qa_visual", status: "skipped" }]), {
  completedLabel: "0/1", skippedLabel: "1", activeLabel: "No active stage", tone: "complete",
}, "a skipped check is terminal progress, not completed or verified work");
assert.deepEqual(summarizeStageReceipts([
  { block: "assemble", status: "ok" }, { block: "qa_visual", status: "skipped" },
]), {
  completedLabel: "1/2", skippedLabel: "1", activeLabel: "No active stage", tone: "complete",
});
assert.deepEqual(summarizeStageReceipts([
  { block: "assemble", status: "ok" }, { block: "qa_visual", status: "pending" },
]), {
  completedLabel: "1/2", skippedLabel: "0", activeLabel: "Awaiting receipt", tone: "neutral",
});
assert.deepEqual(summarizeStageReceipts([
  { block: "assemble", status: "ok" }, { block: "thumbnail", status: "skipped" },
  { block: "qa_visual", status: "failed" }, { block: "metadata", status: "running" },
]), {
  completedLabel: "1/4", skippedLabel: "1", activeLabel: "Metadata", tone: "active",
}, "active and attention selection preserve existing execution behavior");

console.log("RUN MEDIA WORKBENCH PASS");
