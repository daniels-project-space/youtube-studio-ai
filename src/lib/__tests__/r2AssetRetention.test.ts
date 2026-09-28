import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { assertYouTubeStudioR2Bucket, classifyUnboundR2Key,
  hasImmutableAtlasCropProof, hasImmutableIntroCardProof, hasImmutableQuizFinalProof,
  immutableAtlasCropDigest, immutableIntroCardDigest, immutableQuizFinalDigest, permanentReusableMediaDigest,
  permanentReusableMediaKey, releasedFinalVideoIdentity, releasedFinalVideoKey, FINAL_VIDEO_RETENTION_MS,
  ASSET_RETENTION_MS, isLoFiKeyframeSource, releasedKeyframeIdentity, releasedKeyframeKey,
  isLoFiOrdinarySource, releasedOrdinaryAssetIdentity, releasedOrdinaryAssetKey,
  classedReleaseCopyExpiresAt, classedReleaseCopyIsReadable,
  hasExactScheduledClassedProof, isOwnedReleasedCopyKey,
  selectExpiredRunObjects,
  type RunR2RetentionScope } from "../r2AssetRetention";
import { assertYouTubeStudioR2Account } from "../youtubeR2Account";
import { presignUpload, putObject, putObjectFromFile } from "../storage";

const day = 24 * 60 * 60 * 1_000;
const now = Date.UTC(2026, 8, 27);
const prefix = "owner/daniel/channel/show/runs/run-1/";
const releasedAt = now - 2 * day;
const releasedKey = releasedFinalVideoKey("owner/daniel/channel/show/", "run-1", releasedAt, "f".repeat(64));
assert.deepEqual(releasedFinalVideoIdentity(releasedKey), { releaseAt: releasedAt, sha256: "f".repeat(64) });
assert.ok(releasedKey.startsWith("released-final/v2/owner/daniel/"));
assert.equal(isOwnedReleasedCopyKey(releasedKey, "daniel"), true);
assert.equal(isOwnedReleasedCopyKey(releasedKey, "other"), false);
assert.equal(classedReleaseCopyIsReadable(releasedKey, releasedAt + FINAL_VIDEO_RETENTION_MS), false);
assert.equal(releasedFinalVideoIdentity(`${prefix}final.mp4`), null);
test("released finals reject overwriteable writers and mismatched expiry", async () => {
  await assert.rejects(() => presignUpload(releasedKey), /released copies cannot use presigned uploads/);
  await assert.rejects(() => putObject(releasedKey, "bytes"), /released final video requires its create-only file writer/);
  await assert.rejects(() => putObjectFromFile(releasedKey, "/missing", {
    ifNoneMatch: "*", metadata: { retentionWriter: "released-final/v2", retentionFinalSha256: "f".repeat(64),
      retentionReleaseAt: String(releasedAt), retentionExpiresAt: String(releasedAt + FINAL_VIDEO_RETENTION_MS - 1) },
  }), /expiry-bound/);
});
test("only marked Lo-Fi run stills can be release-copy sources and destination cannot be overwritten", async () => {
  const keyPrefix = "owner/daniel/channel/show/";
  const source = `${keyPrefix}runs/run-1/lofi-keyframe/images/keyframe-1.png`;
  assert.equal(isLoFiKeyframeSource(keyPrefix, "run-1", source), true);
  for (const other of [
    `${keyPrefix}runs/run-2/lofi-keyframe/images/keyframe-1.png`,
    `${keyPrefix}runs/run-1/thumbnail/images/hero.png`,
    `${keyPrefix}library/lofi-keyframe/images/keyframe-1.png`,
    `${keyPrefix}runs/run-1/lofi-keyframe/images/keyframe-1.jpg`,
  ]) assert.equal(isLoFiKeyframeSource(keyPrefix, "run-1", other), false);
  const key = releasedKeyframeKey(keyPrefix, "run-1", releasedAt, "a".repeat(64));
  assert.ok(key.startsWith("released-ordinary/v2/owner/daniel/"));
  assert.equal(isOwnedReleasedCopyKey(key, "daniel"), true);
  assert.deepEqual(releasedKeyframeIdentity(key), { releaseAt: releasedAt, sha256: "a".repeat(64) });
  await assert.rejects(() => presignUpload(key), /released copies cannot use presigned uploads/);
  await assert.rejects(() => putObject(key, "bytes"), /released keyframe requires its create-only file writer/);
  await assert.rejects(() => putObjectFromFile(key, "/missing", {
    ifNoneMatch: "*", metadata: { retentionWriter: "released-ordinary/v2", retentionKeyframeSha256: "a".repeat(64),
      retentionReleaseAt: String(releasedAt), retentionExpiresAt: String(releasedAt + ASSET_RETENTION_MS - 1) },
  }), /expiry-bound/);
});
test("Lo-Fi clip and loop unit copies have exact run, row, class and expiry guards", async () => {
  const channel = "owner/daniel/channel/show/";
  const run = `${channel}runs/run-1/`;
  assert.equal(isLoFiOrdinarySource("lofi-clip", channel, "run-1", `${run}loopraw.mp4`), true);
  assert.equal(isLoFiOrdinarySource("lofi-loop-unit", channel, "run-1", `${run}loopunit_4k.mp4`), true);
  for (const source of [`${run}thumbnail.mp4`, `${channel}runs/run-2/loopraw.mp4`,
    `${channel}library/loopraw.mp4`]) {
    assert.equal(isLoFiOrdinarySource("lofi-clip", channel, "run-1", source), false);
  }
  const key = releasedOrdinaryAssetKey(channel, "run-1", "lofi-clip", "asset_1", releasedAt, "a".repeat(64));
  assert.ok(key.startsWith("released-ordinary/v2/owner/daniel/"));
  assert.equal(isOwnedReleasedCopyKey(key, "daniel"), true);
  assert.equal(isOwnedReleasedCopyKey(key.replace("/owner/daniel/", "/owner/other/"), "daniel"), false);
  assert.deepEqual(releasedOrdinaryAssetIdentity(key), {
    kind: "lofi-clip", assetId: "asset_1", releaseAt: releasedAt, sha256: "a".repeat(64),
  });
  assert.equal(classedReleaseCopyExpiresAt(key), releasedAt + ASSET_RETENTION_MS);
  assert.equal(classedReleaseCopyIsReadable(key, releasedAt + ASSET_RETENTION_MS - 1), true);
  assert.equal(classedReleaseCopyIsReadable(key, releasedAt + ASSET_RETENTION_MS), false);
  assert.equal(classedReleaseCopyIsReadable(`released-ordinary/v2/${channel}runs/run-1/bad.mp4`, releasedAt), false);
  assert.equal(classedReleaseCopyIsReadable(`${channel}runs/run-1/thumbnail.png`, releasedAt + ASSET_RETENTION_MS), true);
  await assert.rejects(() => presignUpload(key), /released copies cannot use presigned uploads/);
  await assert.rejects(() => putObject(key, "bytes"), /released ordinary asset requires its create-only file writer/);
  await assert.rejects(() => putObjectFromFile(key, "/missing", {
    ifNoneMatch: "*", metadata: { retentionWriter: "released-ordinary/v2", retentionAssetSha256: "a".repeat(64),
      retentionAssetClass: "lofi-clip", retentionAssetId: "asset_1",
      retentionReleaseAt: String(releasedAt), retentionExpiresAt: String(releasedAt + ASSET_RETENTION_MS - 1) },
  }), /expiry-bound/);
});
test("scheduled classed proof binds exact source, destination identity, digest and deadline", () => {
  const channel = "owner/daniel/channel/show/";
  const sourceKey = `${channel}runs/run-1/loopraw.mp4`;
  const sha256 = "a".repeat(64);
  const expiresAt = releasedAt + ASSET_RETENTION_MS;
  const row = {
    r2Key: releasedOrdinaryAssetKey(channel, "run-1", "lofi-clip", "asset_1", releasedAt, sha256),
    etag: '"destination"', lastModifiedAt: releasedAt + 1_000, expiresAt,
    classedProof: { class: "lofi-clip" as const, assetId: "asset_1", sourceKey,
      sourceEtag: '"source"', sha256, byteLength: 123, releaseAt: releasedAt },
  };
  const head = { etag: row.etag, lastModified: new Date(row.lastModifiedAt), contentLength: 123,
    metadata: { retentionWriter: "released-ordinary/v2", retentionAssetSha256: sha256,
      retentionAssetClass: "lofi-clip", retentionSourceKey: sourceKey,
      retentionSourceEtag: '"source"', retentionAssetId: "asset_1",
      retentionReleaseAt: String(releasedAt), retentionExpiresAt: String(expiresAt) } };
  assert.equal(hasExactScheduledClassedProof(row, head, expiresAt), false,
    "R2 upload must also age thirty days before it is a due candidate");
  const due = row.lastModifiedAt + ASSET_RETENTION_MS;
  assert.equal(hasExactScheduledClassedProof(row, head, due), true);
  assert.equal(hasExactScheduledClassedProof({ ...row, etag: '"other"' }, head, due), false);
  assert.equal(hasExactScheduledClassedProof({ ...row, classedProof: { ...row.classedProof,
    sourceKey: `${channel}runs/run-1/thumbnail.png` } }, head, due), false);
  assert.equal(hasExactScheduledClassedProof(row, { ...head, metadata: { ...head.metadata,
    retentionAssetSha256: "b".repeat(64) } }, due), false);
  assert.equal(hasExactScheduledClassedProof({ ...row, classedProof: { ...row.classedProof,
    assetId: "bad/id" } }, head, due), false, "malformed proof is a failed report, not a crash");
  const loopSource = `${channel}runs/run-1/loopunit_4k.mp4`;
  const loopRow = { ...row,
    r2Key: releasedOrdinaryAssetKey(channel, "run-1", "lofi-loop-unit", "unit_1", releasedAt, sha256),
    classedProof: { ...row.classedProof, class: "lofi-loop-unit" as const,
      assetId: "unit_1", sourceKey: loopSource } };
  const loopHead = { ...head, metadata: { ...head.metadata, retentionAssetClass: "lofi-loop-unit",
    retentionAssetId: "unit_1", retentionSourceKey: loopSource } };
  assert.equal(hasExactScheduledClassedProof(loopRow, loopHead, due), true);
  const stillSource = `${channel}runs/run-1/lofi-keyframe/images/one.png`;
  const stillRow = { ...row,
    r2Key: releasedKeyframeKey(channel, "run-1", releasedAt, sha256),
    classedProof: { ...row.classedProof, class: "lofi-keyframe" as const,
      sourceKey: stillSource } };
  const stillHead = { ...head, metadata: { ...head.metadata, retentionKeyframeSha256: sha256,
    retentionSourceKey: stillSource } };
  assert.equal(hasExactScheduledClassedProof(stillRow, stillHead, due), true);
});
test("exact nested v1 receipts remain readable until their original deadline", () => {
  const root = "owner/daniel/channel/show/runs/run-1/";
  const sha = "a".repeat(64);
  for (const key of [
    `${root}released-keyframe/v1/${releasedAt}-${sha}.png`,
    `${root}released-ordinary/v1/lofi-clip/asset_1/${releasedAt}-${sha}.mp4`,
    `${root}released-ordinary/v1/lofi-loop-unit/asset_2/${releasedAt}-${sha}.mp4`,
  ]) {
    assert.equal(classedReleaseCopyExpiresAt(key), releasedAt + ASSET_RETENTION_MS);
    assert.equal(classedReleaseCopyIsReadable(key, releasedAt + ASSET_RETENTION_MS - 1), true);
    assert.equal(classedReleaseCopyIsReadable(key, releasedAt + ASSET_RETENTION_MS), false);
  }
  const final = `${root}released-final/v1/${releasedAt}-${sha}.mp4`;
  assert.equal(classedReleaseCopyExpiresAt(final), releasedAt + FINAL_VIDEO_RETENTION_MS);
  assert.equal(classedReleaseCopyIsReadable(final, releasedAt + FINAL_VIDEO_RETENTION_MS - 1), true);
  assert.equal(classedReleaseCopyIsReadable(final, releasedAt + FINAL_VIDEO_RETENTION_MS), false);
  assert.equal(classedReleaseCopyIsReadable(`${root}released-keyframe/v1/bad.png`, releasedAt), false);
  assert.equal(classedReleaseCopyIsReadable(`${root}released-final/v1/${releasedAt}-${sha}.png`, releasedAt), false);
});
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
const managedCropName = `novita/atlas-crops/shot-123/c01-${"a".repeat(12)}-${"b".repeat(16)}-r1c1-${"c".repeat(64)}.png`;
const quizFinalName = `quiz-year/quiz-year-${"d".repeat(64)}.mp4`;
const introName = `introcard-${"e".repeat(64)}.mp4`;
const records = [
  record("clip.mp4", 31), record(cropName, 31), record(managedCropName, 31), record(introName, 31), record("new.mp4", 29),
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
assert.deepEqual(selected.expiredAssets.map((item) => item.key), [`${prefix}${managedCropName}`, `${prefix}${introName}`]);
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
const permanentKey = permanentReusableMediaKey("owner/daniel/channel/show/", "f".repeat(64));
assert.equal(permanentKey, `owner/daniel/channel/show/library/reusable-media/v1/${"f".repeat(64)}.mp4`);
assert.equal(permanentReusableMediaDigest(permanentKey), "f".repeat(64));
assert.equal(permanentReusableMediaDigest(`${prefix}studio-media/${"f".repeat(64)}.mp4`), null);
assert.throws(() => permanentReusableMediaKey("owner/daniel/channel/show/runs/r1/", "f".repeat(64)), /owned channel/);
assert.throws(() => permanentReusableMediaKey("owner/daniel/channel/show/", "F".repeat(64)), /SHA-256/);
assert.throws(() => assertYouTubeStudioR2Bucket("travel-film-editor"), /exact YouTube Studio bucket/);
assert.equal(immutableAtlasCropDigest(`${prefix}${managedCropName}`), "c".repeat(64));
assert.equal(immutableAtlasCropDigest(`${prefix}${cropName}`), null);
assert.equal(hasImmutableAtlasCropProof(`${prefix}${managedCropName}`, {
  atlasRuntime: "v1", atlasPlan: "plan", cropSha256: "c".repeat(64), retentionWriter: "atlas-crop/v1",
}), true);
assert.equal(hasImmutableAtlasCropProof(`${prefix}${cropName}`, {
  atlasRuntime: "v1", atlasPlan: "plan", cropSha256: "c".repeat(64), retentionWriter: "atlas-crop/v1",
}), false);
assert.equal(hasImmutableAtlasCropProof(`${prefix}${managedCropName}`, {
  atlasRuntime: "v1", atlasPlan: "plan", cropSha256: "d".repeat(64), retentionWriter: "atlas-crop/v1",
}), false);
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
  await assert.rejects(() => presignUpload(permanentKey), /overwriteable presigned uploads/);
  await assert.rejects(() => putObject(permanentKey, "bytes"), /create-only digest-bound upload/);
  await assert.rejects(() => putObjectFromFile(permanentKey, "/unused"), /verified byte writer/);
  console.log("R2 asset retention tests passed");
})().catch((error: unknown) => { throw error; });
