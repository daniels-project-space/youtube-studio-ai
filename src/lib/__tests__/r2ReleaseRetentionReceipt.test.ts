import assert from "node:assert/strict";
import { ASSET_RETENTION_MS, FINAL_VIDEO_RETENTION_MS,
  releaseRetentionReceiptForWrite } from "../r2AssetRetention";

const prefix = "owner/owner_daniel/channel/quiz/";
const runId = "run_123";
const digest = "a".repeat(64);
const releaseAt = 1_750_000_000_000;
const observedAt = releaseAt + 5_000;
const base = { ownerId: "owner_daniel", channelId: "channel_123", runId,
  keyPrefix: prefix, releaseAt, observedAt, protectedKeys: new Set<string>() };
const write = (r2Key: string) => ({ ownerId: base.ownerId, channelId: base.channelId,
  runId, r2Key, status: "finished", etag: `"${"b".repeat(32)}"`,
  lastModifiedAt: releaseAt - 1_000, byteLength: 400 });

const intro = `${prefix}runs/${runId}/introcard-${digest}.mp4`;
const crop = `${prefix}runs/${runId}/novita/atlas-crops/shot/c01-${"a".repeat(12)}-${"b".repeat(16)}-x-${digest}.png`;
const quiz = `${prefix}runs/${runId}/quiz-year/quiz-year-${digest}.mp4`;
for (const [key, kind, deadline] of [
  [intro, "ordinary", releaseAt + ASSET_RETENTION_MS],
  [crop, "ordinary", releaseAt + ASSET_RETENTION_MS],
  [quiz, "final", releaseAt + FINAL_VIDEO_RETENTION_MS],
] as const) {
  const receipt = releaseRetentionReceiptForWrite({ ...base, write: write(key) });
  assert.equal(receipt?.kind, kind);
  assert.equal(receipt?.retainUntil, deadline);
  assert.equal(receipt?.r2Key, key);
}

for (const key of [
  `${prefix}runs/${runId}/introcard.mp4`,
  `${prefix}runs/${runId}/thumbnail.png`,
  `${prefix}runs/${runId}/travel/final.mp4`,
  `${prefix}library/reusable-media/v1/${digest}.mp4`,
  `unknown/${runId}/quiz-year-${digest}.mp4`,
]) assert.equal(releaseRetentionReceiptForWrite({ ...base, write: write(key) }), null);
assert.equal(releaseRetentionReceiptForWrite({ ...base, protectedKeys: new Set([quiz]), write: write(quiz) }), null);
assert.throws(() => releaseRetentionReceiptForWrite({ ...base,
  write: { ...write(quiz), status: "active" } }), /exact owned immutable write/);
assert.throws(() => releaseRetentionReceiptForWrite({ ...base,
  write: { ...write(quiz), runId: "another_run" } }), /exact owned immutable write/);
console.log("R2 release receipt tests passed");
