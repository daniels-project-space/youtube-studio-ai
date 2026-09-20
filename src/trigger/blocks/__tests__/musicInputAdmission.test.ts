import assert from "node:assert/strict";
import Module from "node:module";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import type { StageContext } from "@/engine/types";
import { sha256BytesHex } from "@/lib/sha256";

const ctx: StageContext = {
  ownerId: "owner-admission", channelId: "channel-admission", runId: "run-admission",
  keyPrefix: "owner/owner-admission/", params: {}, store: { topic: "Quiet evening" },
  budgetUsd: 0, log: () => {},
};
const program = createChannelMusicProgram({
  channelId: String(ctx.channelId), channelIdentityFingerprint: "a".repeat(64),
  family: "narrated_stock", contentLaneKey: "narrated_stock", topic: "Quiet evening", providerPreference: "mureka",
});
const master = Buffer.alloc(1000, 7);
const prepared = { ownerId: ctx.ownerId, channelId: ctx.channelId, topic: "Quiet evening", musicProgram: program,
  audioByteLength: master.length, audioSha256: sha256BytesHex(master), musicDurationSec: 10, musicKey: "prepared-master.mp3" };
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
let storageCalls = 0, networkCalls = 0;
let transferMode = false;
const reads: { key: string; options: unknown }[] = [];
loader._load = function (id, ...args) {
  if (id === "@/lib/storage") return {
    putObject: async () => { storageCalls++; if (!transferMode) throw new Error("admitted-first-storage-write"); },
    getObjectBytes: async (key: string, bucket: unknown, options: unknown) => {
      storageCalls++; assert.equal(bucket, undefined); reads.push({ key, options });
      if (!transferMode) throw new Error("unexpected-storage-read");
      if (key === prepared.musicKey) return master;
      if (key === "runtime.json" || key === "quality.json") return Buffer.from("{");
      throw new Error("unexpected native audio download before receipt verification");
    },
    publicUrl: () => "https://fixture.invalid/reused.mp3",
  };
  if (id === "./blockContext") return { ...originalLoad.call(this, id, ...args) as object, recordAsset: async () => {} };
  // This test checks transfer admission, not audio decoding or musical quality.
  if (id === "@/lib/files") return { makeRunTempDir: async () => "/tmp/fixture", writeBytes: async (path: string) => path };
  if (id === "@/lib/ffmpeg") return { probe: async () => ({ durationSec: 10 }) };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { music } = require("../musicBlocks") as typeof import("../musicBlocks");

async function main() {
  for (const provider of ["yue2", "yue_2", "SUNO", " mureka", "", null, false, 3, {}, ["suno"]]) {
    for (const store of [ctx.store, { ...ctx.store, reuseMusicKey: "retained.mp3" }]) {
      await assert.rejects(music.run({ ...ctx, params: { provider }, store }), /unsupported explicit provider/);
    }
  }
  assert.equal(storageCalls, 0); assert.equal(networkCalls, 0);
  for (const provider of [undefined, "mureka", "suno", "minimax_music3"]) {
    const result = await music.run({ ...ctx, params: { provider }, store: { ...ctx.store, reuseMusicKey: "retained.mp3" } });
    assert.equal(result.musicProvider, "reuse");
  }
  for (const patch of [{ ownerId: "foreign" }, { channelId: "foreign" }, { topic: "Other topic" }]) {
    await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, ...patch } } }), /current owner, channel and topic/);
  }
  for (const patch of [{ channelId: "foreign" }, { topic: "Other topic" }]) {
    const foreign = createChannelMusicProgram({
      channelId: String(ctx.channelId), channelIdentityFingerprint: "b".repeat(64),
      family: "narrated_stock", contentLaneKey: "narrated_stock", topic: "Quiet evening", ...patch,
    });
    await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, musicProgram: foreign } } }), /sound program does not match/);
  }
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: {
    ...prepared, musicProgram: { ...program, fingerprint: "b".repeat(64) },
  } } }), /fingerprint/);
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: null } }), /prepared weekly music/);
  for (const patch of [
    ...[undefined, null, NaN, Infinity, -1, 999, 1000.5, 250000001].map(audioByteLength => ({ audioByteLength })),
    { audioSha256: "invalid" }, { audioSha256: [prepared.audioSha256] }, { musicDurationSec: NaN }, { musicDurationSec: 0 },
  ]) {
    await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, ...patch } } }), /audio bounds/);
  }
  assert.equal(storageCalls, 0, "invalid inputs cannot persist a misleading program or read audio");
  assert.equal(networkCalls, 0, "invalid selection cannot silently buy from a default provider");
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: prepared } }), /admitted-first-storage-write/);
  assert.equal(storageCalls, 1, "a matching frozen program reaches the existing storage path");
  assert.equal(networkCalls, 0);
  transferMode = true;
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, musicQualityReceiptKey: "quality.json", preparedMusic: {
    ...prepared, provider: "minimax_music3", minimax: { nativeWavKey: "native.wav", runtimeReceiptKey: "runtime.json", qualityReceiptKey: "quality.json" },
  } } }), /not valid JSON/);
  assert.deepEqual(reads, [
    { key: prepared.musicKey, options: { maxBytes: 1000, timeoutMs: 300000 } },
    { key: "runtime.json", options: { maxBytes: 2 * 1024 * 1024, timeoutMs: 30000 } },
    { key: "quality.json", options: { maxBytes: 2 * 1024 * 1024, timeoutMs: 30000 } },
  ]);
  reads.length = 0;
  const reused = await music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, provider: "mureka" } } });
  assert.equal(reused.musicKey, prepared.musicKey);
  assert.equal(reused.musicProvider, "mureka");
  assert.deepEqual(reads, [{ key: prepared.musicKey, options: { maxBytes: 1000, timeoutMs: 300000 } }]);
  master[0] ^= 1;
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, provider: "mureka" } } }), /master bytes do not match/);
  master[0] ^= 1;
  assert.equal(networkCalls, 0);
  console.log("MUSIC INPUT ADMISSION PASS: exact provider selection, historical reuse, owner/channel/topic binding and fingerprint validation before I/O");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
});
