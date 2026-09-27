import assert from "node:assert/strict";

import { assertYouTubeStudioR2Bucket, classifyUnboundR2Key, selectExpiredRunObjects,
  type RunR2RetentionScope } from "../r2AssetRetention";

const day = 24 * 60 * 60 * 1_000;
const now = Date.UTC(2026, 8, 27);
const prefix = "owner/daniel/channel/show/runs/run-1/";
const scope: RunR2RetentionScope = {
  runId: "run-1", keyPrefix: "owner/daniel/channel/show/", runStatus: "ok",
  retentionStatus: "completed", releaseAt: now - 200 * day, retainUntil: now - 170 * day,
  finishedAt: now - 200 * day, certificateKey: `${prefix}release-certificates/cert.json`,
  additionalCertificateKeys: [], keepNames: ["final.mp4", "thumbnail.jpg"],
  retainedReleaseEvidence: [],
  assets: [
    { kind: "video", r2Key: `${prefix}final.mp4` },
    { kind: "thumbnail", r2Key: `${prefix}thumbnail.jpg` },
  ],
};
const record = (name: string, days: number) => ({ key: `${prefix}${name}`, lastModified: new Date(now - days * day) });
const records = [
  record("clip.mp4", 31), record("new.mp4", 29), record("final.mp4", 181),
  record("thumbnail.jpg", 300), record("visual-review/frames/f1.jpg", 300),
  record("library/promoted.png", 300), record("thumbnail-checkpoints/source.png", 300),
];
const selected = selectExpiredRunObjects({
  scope, records, now,
  protectedKeys: new Set([`${prefix}library/promoted.png`]),
  evidenceKeys: new Set([`${prefix}visual-review/frames/f1.jpg`]),
  finalVideoKeys: new Set([`${prefix}final.mp4`]),
});
assert.deepEqual(selected.expiredAssets.map((item) => item.key), [`${prefix}clip.mp4`]);
assert.deepEqual(selected.expiredFinals.map((item) => item.key), [`${prefix}final.mp4`]);
assert.equal(selectExpiredRunObjects({
  scope: { ...scope, runStatus: "running" }, records, now,
  protectedKeys: new Set(), evidenceKeys: new Set(), finalVideoKeys: new Set(),
}).expiredAssets.length, 0);
assert.equal(selectExpiredRunObjects({
  scope: { ...scope, retentionStatus: "awaiting_release" }, records, now,
  protectedKeys: new Set(), evidenceKeys: new Set(), finalVideoKeys: new Set(),
}).expiredAssets.length, 0);
assert.equal(selectExpiredRunObjects({
  scope: { ...scope, releaseAt: now - 29 * day, retainUntil: now + day }, records, now,
  protectedKeys: new Set(), evidenceKeys: new Set(), finalVideoKeys: new Set(),
}).expiredAssets.length, 0);
assert.equal(selectExpiredRunObjects({
  scope, records: [{ key: `${prefix}final.mp4`, lastModified: new Date(now - 179 * day) }], now,
  protectedKeys: new Set(), evidenceKeys: new Set(), finalVideoKeys: new Set([`${prefix}final.mp4`]),
}).expiredFinals.length, 0);
assert.throws(() => selectExpiredRunObjects({
  scope, records: [{ key: "models/weight.safetensors", lastModified: new Date(0) }], now,
  protectedKeys: new Set(), evidenceKeys: new Set(), finalVideoKeys: new Set(),
}), /escaped/);
assert.equal(classifyUnboundR2Key("validation/inked-histories/v1/runs/v1/visual-review/frames/f1.jpg"), "evidence");
assert.equal(classifyUnboundR2Key("videocraft/a-dying-art/final_2k.mp4"), "final_video");
assert.equal(classifyUnboundR2Key("models/wan/weights.safetensors"), "outside");
assert.equal(assertYouTubeStudioR2Bucket("youtube-studio-ai"), "youtube-studio-ai");
assert.throws(() => assertYouTubeStudioR2Bucket("travel-film-editor"), /exact YouTube Studio bucket/);
console.log("R2 asset retention tests passed");
