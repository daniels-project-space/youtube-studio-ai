import assert from "node:assert/strict";

import {
  isLofiChannel,
  selectLofiLibraryThumbnail,
} from "../lofiLibraryThumbnail";
import { createLofiThumbnailCurrentCandidateEvidence } from "../thumbnailRefreshInventory";

const ownerId = "owner_daniel";
const channelId = "channel_lofi";
const videoKey = "owner/owner_daniel/channel/gratitude/runs/source/master.mp4";
const sourceRunId = "source-run";
const candidateRunId = "candidate-run";
const hash = "a".repeat(64);

function asset(runId: string, r2Key: string, source = videoKey) {
  return {
    runId,
    r2Key,
    meta: {
      thumbnailCurrentCandidateEvidence: createLofiThumbnailCurrentCandidateEvidence({
        ownerId,
        channelId,
        runId,
        r2Key,
        artifactSha256: hash,
        sourceVideoKey: source,
        sourceFrameSha256: hash,
        sourceFrameTimeSec: 15,
        sourceWidth: 3840,
        sourceHeight: 2160,
        providerRequestSha256: hash,
        providerResponseSha256: hash,
      }),
    },
  };
}

assert.equal(isLofiChannel({ family: "music_loop" }), true);
assert.equal(isLofiChannel({ contentLane: { key: "music_loop" } }), true);
assert.equal(isLofiChannel({ family: "whiteboard" }), false);

const source = asset(sourceRunId, "owner/owner_daniel/channel/gratitude/runs/source/thumbnail.jpg");
const refreshed = asset(candidateRunId, "owner/owner_daniel/channel/gratitude/runs/candidate/thumbnail.jpg");
assert.equal(
  selectLofiLibraryThumbnail({
    ownerId,
    channelId,
    sourceVideoKey: videoKey,
    sourceThumbnail: source,
    refreshCandidates: [{ status: "ok", finishedAt: 2, thumbnail: refreshed }],
  })?.r2Key,
  refreshed.r2Key,
  "a completed, verified source-frame refresh supersedes the older source artifact in Library only",
);

assert.equal(
  selectLofiLibraryThumbnail({
    ownerId,
    channelId,
    sourceVideoKey: videoKey,
    sourceThumbnail: asset(sourceRunId, source.r2Key, "other/master.mp4"),
  }),
  null,
  "a generic or mismatched-video thumbnail cannot masquerade as a Lo-Fi rendered-frame thumbnail",
);

console.log("Lo-Fi Library thumbnail selection contract passed");
