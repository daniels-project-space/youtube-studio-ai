import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { assertYouTubeStudioR2Bucket, classifyUnboundR2Key,
  hasImmutableAtlasCropProof, hasImmutableIntroCardProof, hasImmutableQuizFinalProof,
  immutableIntroCardDigest, immutableQuizFinalDigest, selectExpiredRunObjects,
  type RunR2RetentionScope } from "../r2AssetRetention";
import { assertYouTubeStudioR2Account } from "../youtubeR2Account";
import { presignUpload, putObject, putObjectFromFile } from "../storage";

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
const cropName = `novita/atlas-crops/shot-123/c01-${"a".repeat(12)}-${"b".repeat(16)}-r1c1.png`;
const quizFinalName = `quiz-year/quiz-year-${"d".repeat(64)}.mp4`;
const introName = `introcard-${"e".repeat(64)}.mp4`;
const records = [
  record("clip.mp4", 31), record(cropName, 31), record(introName, 31), record("new.mp4", 29),
  record("final.mp4", 181), record(quizFinalName, 181),
  record("thumbnail.jpg", 300), record("visual-review/frames/f1.jpg", 300),
  record("library/promoted.png", 300), record("thumbnail-checkpoints/source.png", 300),
];
const selected = selectExpiredRunObjects({
  scope, records, now,
  protectedKeys: new Set([`${prefix}library/promoted.png`]),
  evidenceKeys: new Set([`${prefix}visual-review/frames/f1.jpg`]),
  finalVideoKeys: new Set([`${prefix}final.mp4`, `${prefix}${quizFinalName}`]),
});
assert.deepEqual(selected.expiredAssets.map((item) => item.key), [`${prefix}${introName}`]);
assert.deepEqual(selected.expiredFinals.map((item) => item.key), [`${prefix}final.mp4`, `${prefix}${quizFinalName}`]);
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
assert.equal(hasImmutableAtlasCropProof(`${prefix}${cropName}`, {
  atlasRuntime: "v1", atlasPlan: "plan", cropSha256: "c".repeat(64),
}), true);
assert.equal(hasImmutableAtlasCropProof(`${prefix}final.mp4`, {
  atlasRuntime: "v1", atlasPlan: "plan", cropSha256: "c".repeat(64),
}), false);
assert.equal(immutableIntroCardDigest(`${prefix}${introName}`), "e".repeat(64));
assert.equal(hasImmutableIntroCardProof(`${prefix}${introName}`, {
  retentionIntroSha256: "e".repeat(64), retentionWriter: "intro-card/v1",
}), true);
assert.equal(immutableQuizFinalDigest(`${prefix}${quizFinalName}`), "d".repeat(64));
assert.equal(hasImmutableQuizFinalProof(`${prefix}${quizFinalName}`, {
  retentionFinalSha256: "d".repeat(64), retentionWriter: "quiz-final/v1",
}), true);
assert.equal(hasImmutableQuizFinalProof(`${prefix}${quizFinalName}`, {
  retentionFinalSha256: "e".repeat(64), retentionWriter: "quiz-final/v1",
}), false);
assert.throws(() => assertYouTubeStudioR2Account({ accountId: "a".repeat(32) }), /verified YouTube Studio/);
assert.throws(() => assertYouTubeStudioR2Account({ accountId: "a".repeat(32),
  expectedAccountId: "a".repeat(32), endpoint: "https://other.r2.cloudflarestorage.com" }), /verified YouTube Studio/);
assert.throws(() => assertYouTubeStudioR2Account({ accountId: "a".repeat(32),
  expectedAccountId: "a".repeat(32) }), /verified YouTube Studio/);
assert.doesNotThrow(() => assertYouTubeStudioR2Account({ accountId: "a".repeat(32),
  expectedAccountId: "a".repeat(32), endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` },
  createHash("sha256").update("a".repeat(32)).digest("hex")));
void (async () => {
  await assert.rejects(() => presignUpload(`${prefix}${cropName}`), /overwriteable presigned uploads/);
  await assert.rejects(() => putObject(`${prefix}${cropName}`, "bytes"), /create-only upload/);
  await assert.rejects(() => putObjectFromFile(`${prefix}${cropName}`, "/unused"), /file upload writer/);
  await assert.rejects(() => presignUpload(`${prefix}${introName}`), /overwriteable presigned uploads/);
  await assert.rejects(() => putObject(`${prefix}${introName}`, "bytes"), /create-only upload/);
  await assert.rejects(() => putObjectFromFile(`${prefix}${introName}`, "/unused"), /file upload writer/);
  await assert.rejects(() => presignUpload(`${prefix}${quizFinalName}`), /overwriteable presigned uploads/);
  await assert.rejects(() => putObject(`${prefix}${quizFinalName}`, "bytes"), /create-only file writer/);
  await assert.rejects(() => putObjectFromFile(`${prefix}${quizFinalName}`, "/unused"), /create-only file upload/);
  console.log("R2 asset retention tests passed");
})().catch((error: unknown) => { throw error; });
