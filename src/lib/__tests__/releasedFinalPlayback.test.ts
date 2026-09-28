import assert from "node:assert/strict";
import { releasedFinalPlaybackKey } from "../releasedFinalPlayback";
import { releasedFinalVideoKey, FINAL_VIDEO_RETENTION_MS } from "../r2AssetRetention";

const now = 1_800_000_000_000;
const releaseAt = now - 1_000;
const ownerId = "daniel";
const channelId = "channel-1";
const runId = "run-1";
const prefix = `owner/${ownerId}/channel/${channelId}/`;
const sourceKey = `${prefix}runs/${runId}/final.mp4`;
const sourceSha256 = "a".repeat(64);
const certificateKey = `${prefix}runs/${runId}/release.json`;
const row = {
  ownerId, channelId, runId, releaseAt, certificateKey,
  certificateFingerprint: "b".repeat(64), sourceKey, sourceSha256,
  sourceByteLength: 100, copyKey: releasedFinalVideoKey(prefix, runId, releaseAt, sourceSha256),
  status: "finished" as const, finishedAt: releaseAt + 100,
  copyEtag: "c".repeat(32), copyLastModifiedAt: releaseAt + 100,
};
const input = { ownerId, channelId, runId, certificateKey, sourceKey,
  keyPrefix: prefix, certifiedSourceKey: sourceKey, publicReleaseObserved: true, releaseAt, now };

assert.equal(releasedFinalPlaybackKey({ ...input, rows: [row] }), row.copyKey);
assert.equal(releasedFinalPlaybackKey({ ...input, rows: [] }), null,
  "a public release without a finished copy must not fall back to the source");
assert.equal(releasedFinalPlaybackKey({ ...input, publicReleaseObserved: false, rows: [] }), sourceKey);
assert.equal(releasedFinalPlaybackKey({ ...input, certifiedSourceKey: undefined, rows: [row] }), null);
for (const changed of [
  { status: "active" as const }, { sourceKey: "other.mp4" },
  { certificateKey: "other.json" }, { copyKey: "other.mp4" },
  { ownerId: "other" }, { releaseAt: releaseAt - 1 },
  { copyEtag: undefined }, { sourceByteLength: 0 },
]) {
  assert.equal(releasedFinalPlaybackKey({ ...input, rows: [{ ...row, ...changed }] }), null);
}
assert.equal(releasedFinalPlaybackKey({ ...input, now: releaseAt + FINAL_VIDEO_RETENTION_MS, rows: [row] }), null);
console.log("released final playback identity and fail-closed selection passed");
