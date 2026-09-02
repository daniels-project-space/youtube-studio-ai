import assert from "node:assert/strict";

import {
  ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT,
  ERNIE_THUMBNAIL_REFRESH_BATCH_IMAGE_PREFIX,
  ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION,
  ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  assertErnieThumbnailRefreshBatchManifest,
  ernieThumbnailBatchApplyApprovalSubject,
  ernieThumbnailRefreshBatchFingerprint,
  ernieThumbnailRefreshCandidateCost,
} from "@/lib/ernieThumbnailRefreshBatch";

const digest = (seed: number) => seed.toString(16).padStart(64, "0");
const sourceRunId = (index: number) => `source-run-${String(index).padStart(3, "0")}-verified`;

const manifest = {
  version: 1,
  ownerId: ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  modelRevision: ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION,
  candidates: Array.from({ length: ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT }, (_, index) => ({
    sourceRunId: sourceRunId(index),
    channelId: `channel-${index}`,
    channelSlug: `channel-${index}`,
    youtubeVideoId: `video-${String(index).padStart(3, "0")}`,
    ernieSceneKey: `${ERNIE_THUMBNAIL_REFRESH_BATCH_IMAGE_PREFIX}${sourceRunId(index)}.png`,
    artifactSha256: digest(index + 1),
    providerRequestSha256: digest(index + 101),
    providerResponseSha256: digest(index + 201),
    batchReceiptKey: `projects/novita-thumbnail-batch/jobs/review-${index}/receipts/1-terminal.json`,
    batchResultKey: `projects/novita-thumbnail-batch/jobs/review-${index}/artifacts/batch-result.json`,
    elapsedSeconds: 600,
    sourceReviewCount: 4,
    qa: {
      textOk: true,
      faceClear: true,
      punch: 8,
      styleMatch: 8,
      storyMatch: 8,
      uiClean: true,
      reason: "Passed independent thumbnail QA",
    },
  })),
} as const;

const parsed = assertErnieThumbnailRefreshBatchManifest(manifest);
assert.equal(parsed.candidates.length, 30);
assert.equal(ernieThumbnailRefreshBatchFingerprint(parsed).length, 64);
assert.equal(ernieThumbnailBatchApplyApprovalSubject({
  ownerId: ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  batchFingerprint: ernieThumbnailRefreshBatchFingerprint(parsed),
}).startsWith("thumbnail-ernie-batch-apply:"), true);
assert.equal(ernieThumbnailRefreshCandidateCost(parsed.candidates[0]), 0.013958);

assert.throws(() => assertErnieThumbnailRefreshBatchManifest({
  ...manifest,
  candidates: manifest.candidates.slice(0, 29),
}), /candidate count changed/);
assert.throws(() => assertErnieThumbnailRefreshBatchManifest({
  ...manifest,
  candidates: manifest.candidates.map((candidate, index) => index === 1
    ? { ...candidate, youtubeVideoId: manifest.candidates[0].youtubeVideoId }
    : candidate),
}), /duplicate run or video bindings/);
assert.throws(() => assertErnieThumbnailRefreshBatchManifest({
  ...manifest,
  candidates: manifest.candidates.map((candidate, index) => index === 0
    ? { ...candidate, ernieSceneKey: "projects/unbound.png" }
    : candidate),
}), /image key is not bound/);

console.log("ERNIE thumbnail refresh batch contracts passed");
