import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ASSET_RETENTION_MS, FINAL_VIDEO_RETENTION_MS,
  releaseClockUpdate, releaseReceiptReplay, releaseRetentionReceiptForWrite } from "../r2AssetRetention";
import { immutableR2ClaimId, writeReservedImmutableR2Object } from "../reservedImmutableR2Write";
import { assertStudioRetentionR2Destination } from "../youtubeR2Account";

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

const first = releaseRetentionReceiptForWrite({ ...base, write: write(quiz) });
assert.ok(first);
assert.equal(releaseClockUpdate(undefined, releaseAt), "advance");
assert.equal(releaseClockUpdate(releaseAt, releaseAt), "same");
assert.equal(releaseClockUpdate(releaseAt, releaseAt + 1_000), "advance");
assert.equal(releaseClockUpdate(releaseAt, releaseAt - 1_000), "regression");
assert.equal(releaseReceiptReplay([first], first), "existing");
const later = { ...first, releaseAt: releaseAt + 1_000,
  retainUntil: first.retainUntil + 1_000, observedAt: observedAt + 1_000 };
assert.equal(releaseReceiptReplay([first], later), "append");
assert.equal(releaseReceiptReplay([later], first), "conflict");
assert.equal(releaseReceiptReplay([first], { ...first, etag: `"${"c".repeat(32)}"` }), "conflict");

const claim = immutableR2ClaimId({ ...base, r2Key: intro });
assert.match(claim, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
assert.equal(claim, immutableR2ClaimId({ ...base, r2Key: intro }));
assert.notEqual(claim, immutableR2ClaimId({ ...base, r2Key: quiz }));

const accountId = "a".repeat(32);
const accountHash = createHash("sha256").update(accountId).digest("hex");
const destination = { bucket: "youtube-studio-ai", accountId, expectedAccountId: accountId,
  endpoint: `https://${accountId}.r2.cloudflarestorage.com` };
assert.doesNotThrow(() => assertStudioRetentionR2Destination(destination, accountHash));
assert.throws(() => assertStudioRetentionR2Destination({ ...destination, bucket: "another-bucket" }, accountHash), /exact YouTube Studio bucket/);
assert.throws(() => assertStudioRetentionR2Destination({ ...destination, endpoint: "https://wrong.example" }, accountHash), /verified YouTube Studio Cloudflare account/);

const savedBucket = process.env.R2_BUCKET;
process.env.R2_BUCKET = "another-bucket";
assertDestinationGuard().then(() => console.log("R2 release receipt tests passed"));

async function assertDestinationGuard(): Promise<void> {
  try {
    await assert.rejects(() => writeReservedImmutableR2Object({
  ownerId: base.ownerId, channelId: base.channelId, runId, r2Key: intro,
  write: async () => { throw new Error("R2 side effect reached"); },
  verifyStoredBytes: async () => { throw new Error("R2 readback reached"); },
    }), /exact YouTube Studio bucket/);
  } finally {
    if (savedBucket === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = savedBucket;
  }
}
