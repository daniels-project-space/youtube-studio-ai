import assert from "node:assert/strict";

import { assessLegacyVideoCleanup } from "@/lib/legacyVideoCleanup";

assert.deepEqual(
  assessLegacyVideoCleanup({
    youtubeVideoId: undefined,
    runStatus: "ok",
    title: "Anything",
    channelFamily: "music_loop",
  }).action,
  "keep",
);

const failed = assessLegacyVideoCleanup({
  youtubeVideoId: "failed-video",
  runStatus: "failed",
  title: "A failed upload",
  channelFamily: "narrated_stock",
});
assert.equal(failed.action, "retire");
assert.equal(failed.reason, "failed_run_uploaded");

for (const title of ["LoFi Beats for Marcus Aurelius", "LO-FI focus", "lo fi study"]) {
  const mismatch = assessLegacyVideoCleanup({
    youtubeVideoId: "identity-video",
    runStatus: "ok",
    title,
    channelFamily: "narrated_stock",
  });
  assert.equal(mismatch.action, "retire");
  assert.equal(mismatch.reason, "channel_identity_mismatch");
}

const oldLoop = assessLegacyVideoCleanup({
  youtubeVideoId: "old-loop",
  runStatus: "ok",
  title: "Rain on the window",
  channelFamily: "music_loop",
  releaseEvidenceStatus: "legacy_unverified",
});
assert.equal(oldLoop.action, "retire");
assert.equal(oldLoop.reason, "unqualified_family_legacy");

const qualifiedLoop = assessLegacyVideoCleanup({
  youtubeVideoId: "qualified-loop",
  runStatus: "ok",
  title: "Rain on the window",
  channelFamily: "music_loop",
  releaseEvidenceStatus: "release_evidence_recorded",
});
assert.equal(qualifiedLoop.action, "keep");

const retained = assessLegacyVideoCleanup({
  youtubeVideoId: "retained-video",
  runStatus: "ok",
  title: "How Stoics Handle Anger",
  channelFamily: "narrated_stock",
  releaseEvidenceStatus: "legacy_unverified",
});
assert.equal(retained.action, "keep", "age and legacy provenance alone never authorize deletion");

console.log("Legacy video cleanup classification tests passed");
