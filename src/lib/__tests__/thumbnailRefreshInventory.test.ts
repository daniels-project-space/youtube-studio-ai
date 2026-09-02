import assert from "node:assert/strict";

import {
  assessThumbnailRefreshEvidence,
  createErnieNovitaThumbnailCurrentCandidateEvidence,
  createLofiThumbnailCurrentCandidateEvidence,
  createThumbnailCurrentCandidateEvidence,
} from "@/lib/thumbnailRefreshInventory";

const ownerId = "owner-alice";
const channelId = "channel-history";
const runId = "run-2026-08-22";
const r2Key = "owner/owner-alice/channel/history/runs/run-2026-08-22/thumbnail.jpg";

const evidence = createThumbnailCurrentCandidateEvidence({
  ownerId,
  channelId,
  runId,
  r2Key,
  artifactSha256: "a".repeat(64),
  providerRequestSha256: "b".repeat(64),
  providerResponseSha256: "c".repeat(64),
});

assert.deepEqual(
  assessThumbnailRefreshEvidence({
    ownerId,
    channelId,
    runId,
    kind: "thumbnail",
    r2Key,
    meta: { thumbnailCurrentCandidateEvidence: evidence },
  }),
  {
    status: "current_golden_candidate",
    action: "no_refresh_action",
    reason: "Current Golden generator provenance is recorded. This is still not an owner acceptance or an external thumbnail replacement.",
  },
  "only an exact owner/run/key-bound current marker is recognised as a current candidate",
);

assert.deepEqual(
  assessThumbnailRefreshEvidence({
    ownerId,
    channelId,
    runId,
    kind: "thumbnail",
    r2Key,
    meta: {
      providerRoute: "nano-banana-flash",
      publishable: true,
    },
  }),
  {
    status: "legacy_unverified",
    action: "owner_review_required",
    reason: "No current Golden thumbnail provenance marker is recorded for this asset.",
  },
  "old provider-looking metadata must not inherit current-Golden status without the new bound marker",
);

assert.deepEqual(
  assessThumbnailRefreshEvidence({
    ownerId,
    channelId,
    runId: "different-run",
    kind: "thumbnail",
    r2Key,
    meta: { thumbnailCurrentCandidateEvidence: evidence },
  }),
  {
    status: "evidence_invalid",
    action: "owner_review_required",
    reason: "The current-candidate marker does not match this asset's owner, run, channel, or R2 key.",
  },
  "a valid marker copied onto another run must remain a refresh-review candidate",
);

assert.deepEqual(
  assessThumbnailRefreshEvidence(null),
  {
    status: "missing_thumbnail",
    action: "owner_review_required",
    reason: "No thumbnail asset is recorded for this finished video.",
  },
  "missing thumbnails are inventoried without pretending a replacement exists",
);

assert.throws(
  () => createThumbnailCurrentCandidateEvidence({
    ownerId,
    channelId,
    runId,
    r2Key,
    artifactSha256: "not-a-receipt",
    providerRequestSha256: "b".repeat(64),
    providerResponseSha256: "c".repeat(64),
  }),
  /SHA-256 receipts/,
  "current provenance cannot be minted without byte and provider receipts",
);

const lofiEvidence = createLofiThumbnailCurrentCandidateEvidence({
  ownerId,
  channelId,
  runId,
  r2Key,
  artifactSha256: "d".repeat(64),
  sourceVideoKey: "owner/owner-alice/channel/lofi/runs/run-2026-08-22/loop-unit-4k.mp4",
  sourceFrameSha256: "e".repeat(64),
  sourceFrameTimeSec: 12,
  sourceWidth: 3_840,
  sourceHeight: 2_160,
  providerRequestSha256: "f".repeat(64),
  providerResponseSha256: "1".repeat(64),
});
assert.equal(
  assessThumbnailRefreshEvidence({
    ownerId,
    channelId,
    runId,
    kind: "thumbnail",
    r2Key,
    meta: { thumbnailCurrentCandidateEvidence: lofiEvidence },
  }).status,
  "current_golden_candidate",
  "a truthful 4K Lo-Fi render-frame receipt is admitted without pretending Nano Banana generated it",
);
assert.throws(
  () => createLofiThumbnailCurrentCandidateEvidence({
    ownerId,
    channelId,
    runId,
    r2Key,
    artifactSha256: "d".repeat(64),
    sourceVideoKey: "lofi-1080p.mp4",
    sourceFrameSha256: "e".repeat(64),
    sourceFrameTimeSec: 12,
    sourceWidth: 1_920,
    sourceHeight: 1_080,
    providerRequestSha256: "f".repeat(64),
    providerResponseSha256: "1".repeat(64),
  }),
  /truthful 4K/,
  "the Lo-Fi route must not label a sub-4K source as 4K",
);

const ernieEvidence = createErnieNovitaThumbnailCurrentCandidateEvidence({
  ownerId,
  channelId,
  runId,
  r2Key,
  artifactSha256: "2".repeat(64),
  providerRequestSha256: "3".repeat(64),
  providerResponseSha256: "4".repeat(64),
  modelRevision: "5".repeat(40),
});
assert.equal(
  assessThumbnailRefreshEvidence({
    ownerId,
    channelId,
    runId,
    kind: "thumbnail",
    r2Key,
    meta: { thumbnailCurrentCandidateEvidence: ernieEvidence },
  }).status,
  "current_golden_candidate",
  "a fully native ERNIE thumbnail may enter the same replacement gate only with exact receipt evidence",
);
assert.throws(
  () => createErnieNovitaThumbnailCurrentCandidateEvidence({
    ownerId,
    channelId,
    runId,
    r2Key,
    artifactSha256: "2".repeat(64),
    providerRequestSha256: "3".repeat(64),
    providerResponseSha256: "4".repeat(64),
    modelRevision: "not-immutable",
  }),
  /immutable request\/receipt hashes/,
  "the ERNIE marker requires a pinned model revision rather than a mutable model name",
);

console.log("THUMBNAIL REFRESH INVENTORY PASS");
