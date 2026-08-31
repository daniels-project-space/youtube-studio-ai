import assert from "node:assert/strict";
import {
  mediaFacts,
  mediaType,
  orderRunMedia,
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
  verifiedLabel: "0/1",
  activeLabel: "Assemble",
  tone: "active",
});
assert.deepEqual(summarizeStageReceipts([{ block: "qa_visual", status: "failed" }]), {
  verifiedLabel: "0/1",
  activeLabel: "Needs attention",
  tone: "attention",
});

console.log("RUN MEDIA WORKBENCH PASS");
