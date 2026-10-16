import assert from "node:assert/strict";
import Module from "node:module";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import type { ModuleManifest } from "@/engine/moduleManifest";
import type { StageContext } from "@/engine/types";
import { sha256BytesHex } from "@/lib/sha256";
import { musicReuseTestReceipt, musicReuseTestStyleDNA } from "./musicReuseFixtures";

const ctx: StageContext = {
  ownerId: "owner-admission", channelId: "channel-admission", runId: "run-admission",
  keyPrefix: "owner/owner-admission/", params: {}, store: { topic: "Quiet evening", styleDNA: musicReuseTestStyleDNA },
  budgetUsd: 0, log: () => {},
};
const program = createChannelMusicProgram({
  channelId: String(ctx.channelId), channelIdentityFingerprint: "a".repeat(64),
  family: "narrated_stock", contentLaneKey: "narrated_stock", topic: "Quiet evening", providerPreference: "mureka",
});
const master = Buffer.alloc(1000, 7);
const reusedKey = "retained.mp3";
const reuseReceipt = musicReuseTestReceipt({ ownerId: ctx.ownerId, baseRunId: "base-run",
  baseChannelId: "base-channel", siblingChannelId: String(ctx.channelId), family: "narrated_stock",
  contentLaneKey: "narrated_stock", provider: "mureka", musicKey: reusedKey });
const prepared = { ownerId: ctx.ownerId, channelId: ctx.channelId, topic: "Quiet evening", musicProgram: program,
  provider: "mureka",
  audioByteLength: master.length, audioSha256: sha256BytesHex(master), musicDurationSec: 10,
  musicKey: `${ctx.keyPrefix}runs/${ctx.runId}/audio/prepared-master.mp3` };
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
let storageCalls = 0, networkCalls = 0;
let transferMode = false;
const reads: { key: string; options: unknown }[] = [];
const writtenObjects = new Map<string, Uint8Array>();
loader._load = function (id, ...args) {
  if (id === "@/lib/storage") return {
    putObject: async (key: string, bytes: Uint8Array) => {
      storageCalls++;
      if (!transferMode) throw new Error("admitted-first-storage-write");
      writtenObjects.set(key, bytes);
    },
    getObjectBytes: async (key: string, bucket: unknown, options: unknown) => {
      storageCalls++; assert.equal(bucket, undefined); reads.push({ key, options });
      if (!transferMode) throw new Error("unexpected-storage-read");
      if (writtenObjects.has(key)) return writtenObjects.get(key)!;
      if (key === prepared.musicKey) return master;
      if (key === "runtime.json" || key === "quality.json") return Buffer.from("{");
      throw new Error("unexpected native audio download before receipt verification");
    },
    publicUrl: () => "https://fixture.invalid/reused.mp3",
  };
  if (id === "@/lib/music") return {
    generateMureka: async () => { throw new Error("provider boundary reached; no generation in this contract test"); },
    MusicError: class MusicError extends Error {
      safeToFallback = false;
      acceptedUnits = 0;
    },
    withMusicGenerationCost: (error: unknown) => error,
  };
  if (id === "./blockContext") return { ...originalLoad.call(this, id, ...args) as object, recordAsset: async () => {} };
  // This test checks transfer admission, not audio decoding or musical quality.
  if (id === "@/lib/files") return {
    makeRunTempDir: async () => "/tmp/fixture",
    writeBytes: async (path: string) => path,
    readBytes: async () => Buffer.alloc(44),
  };
  if (id === "@/lib/ffmpeg") return {
    probe: async () => ({ durationSec: 10 }),
    decodeMusicAuditionPcmWav: async (_input: string, output: string, durationSec: number) => ({
      durationSec, byteLength: 44, output,
    }),
  };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { music } = require("../musicBlocks") as typeof import("../musicBlocks");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createComposerAwareAssemblyManifest } = require("../composerAwareAssembly") as typeof import("../composerAwareAssembly");

async function main() {
  for (const provider of ["yue2", "yue_2", "SUNO", " mureka", "", null, false, 3, {}, ["suno"]]) {
    for (const store of [ctx.store, { ...ctx.store, reuseMusicKey: "retained.mp3" }]) {
      await assert.rejects(music.run({ ...ctx, params: { provider }, store }), /unsupported explicit provider/);
    }
  }
  assert.equal(storageCalls, 0); assert.equal(networkCalls, 0);
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, reuseMusicKey: reusedKey } }),
    /admitted-first-storage-write/u, "raw reuse keys without a sibling-scoped receipt fall through to channel-specific generation");
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, reuseMusicKey: reusedKey,
    reuseMusicReceipt: { ...reuseReceipt, siblingChannelId: "foreign-sibling" } } }),
  /admitted-first-storage-write/u, "a foreign sibling receipt cannot reuse audio and falls back to channel-specific generation");
  assert.equal(storageCalls, 2); assert.equal(networkCalls, 0);
  assert.deepEqual(reads, [], "untrusted reuse keys are never downloaded or accepted");
  storageCalls = 0;
  const conflictingSleepStore = {
    topic: "Steady rain through a quiet night",
    musicBrief: { musicIntent: { role: "sleep_sound_bed" } },
    styleDNA: { audio: { genre: "ambient", instrumentation: ["soft sustained pad", "boom-bap drums"] } },
  };
  const sleepContext = { ...ctx, params: { provider: "suno" }, store: conflictingSleepStore };
  await assert.rejects(music.run(sleepContext), /sleep soundscape cannot use rhythmic instrumentation: boom-bap drums/u);
  assert.equal(storageCalls, 0, "a role-conflicting brief must fail before writing its sound program");
  assert.equal(networkCalls, 0, "a role-conflicting brief must fail before a provider request");
  const rhythmicSleepGenreStore = {
    topic: "Steady rain through a quiet night",
    musicBrief: { musicIntent: { role: "sleep_sound_bed" } },
    styleDNA: { audio: { genre: "minimal drum and bass", instrumentation: ["soft sustained pad"] } },
  };
  await assert.rejects(
    music.run({ ...ctx, params: { provider: "suno" }, store: rhythmicSleepGenreStore }),
    /sleep soundscape cannot use a rhythmic genre: minimal drum and bass/u,
  );
  assert.equal(storageCalls, 0, "a role-conflicting channel genre must fail before writing its sound program");
  assert.equal(networkCalls, 0, "a role-conflicting channel genre must fail before a provider request");
  for (const provider of ["mureka", "suno"] as const) {
    const result = await music.run({ ...ctx, params: { provider }, store: { ...ctx.store,
      reuseMusicKey: reusedKey,
      reuseMusicReceipt: musicReuseTestReceipt({ ownerId: ctx.ownerId, baseRunId: "base-run",
        baseChannelId: "base-channel", siblingChannelId: String(ctx.channelId), family: "narrated_stock",
        contentLaneKey: "narrated_stock", provider: provider ?? "mureka", musicKey: reusedKey }) } });
    assert.equal(result.musicProvider, "reuse");
  }
  await assert.rejects(music.run({ ...ctx, params: { provider: "minimax_music3" }, store: { ...ctx.store,
    reuseMusicKey: reusedKey,
    reuseMusicReceipt: musicReuseTestReceipt({ ownerId: ctx.ownerId, baseRunId: "base-run",
      baseChannelId: "base-channel", siblingChannelId: String(ctx.channelId), family: "narrated_stock",
      contentLaneKey: "narrated_stock", provider: "minimax_music3", musicKey: reusedKey }) } }), /admitted-first-storage-write/u,
  "MiniMax reuse is rejected and follows its own generation path until worker review evidence is portable");
  storageCalls = 0;
  networkCalls = 0;
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
  for (const provider of ["suno", "minimax_music3", "yue2", undefined]) {
    await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: { ...prepared, provider } } }), /provider does not match/);
  }
  await assert.rejects(music.run({ ...ctx, params: { provider: "suno" }, store: { ...ctx.store, preparedMusic: prepared } }), /provider does not match/);
  assert.equal(storageCalls, 0, "mismatched provider evidence cannot write or download anything");
  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, preparedMusic: prepared } }), /admitted-first-storage-write/);
  assert.equal(storageCalls, 1, "a matching frozen program reaches the existing storage path");
  assert.equal(networkCalls, 0);
  transferMode = true;
  const styleDNA = {
    audio: {
      role: "meditation_bed" as const,
      genre: "quiet contemplative score", bpmRange: [60, 72], instrumentation: ["felt piano"],
      textures: ["soft room tone"], moodArc: "stillness toward reassurance", loudnessLufs: -18,
      bodyMusicVol: 0.37, loopable: false,
    },
  };
  const programBrief = createChannelProgramBrief({
    nicheKey: "health", subcategory: "sleep-recovery", locale: "en",
    concept: "Sleep recovery science with calm guided meditation.", family: "sleep",
  });
  const route = resolveChannelProgramRoute(programBrief);
  const channelProgramRoute = channelProgramRouteRunSeed({ route, programBrief });
  await assert.rejects(music.run({
    ...ctx,
    params: { provider: "mureka" },
    store: { ...ctx.store, channelProgramRoute, styleDNA, musicBrief: {
      musicPrompt: "A measured, spacious meditation bed.",
    } },
  }), /provider boundary reached/);
  const programEntry = [...writtenObjects.entries()].find(([key]) => key.includes("channel-music-program-"));
  assert.ok(programEntry, "the actual music producer persists its sealed channel program before provider dispatch");
  const producedProgram = JSON.parse(Buffer.from(programEntry[1]).toString("utf8")) as {
    fingerprint: string;
    role: string;
    mix: { bodyMusicVol: number };
  };
  assert.equal(producedProgram.role, "meditation_bed", "the shared music producer must preserve the channel's declared role instead of rebuilding a family default");
  assert.equal(producedProgram.mix.bodyMusicVol, 0.37, "channel StyleDNA mix gain survives the real producer boundary");
  storageCalls = 0;
  networkCalls = 0;
  await assert.rejects(music.run({
    ...ctx,
    params: { provider: "mureka" },
    store: { ...ctx.store, channelProgramRoute, styleDNA, musicBrief: {
      musicPrompt: "A beatless sleep soundscape.",
      musicIntent: { role: "sleep_sound_bed", playback: "repeat", requestedDurationSec: 300 },
    } },
  }), /Composer role sleep_sound_bed conflicts with locked channel audio role meditation_bed/u);
  assert.equal(storageCalls, 0, "a conflicting episode role cannot write a channel sound program");
  assert.equal(networkCalls, 0, "a conflicting episode role cannot reach a paid music provider");
  const legacyAssembly = {
    id: "timeline_assemble",
    version: "fixture-assembly",
    block: { run: async (assemblyContext: StageContext) => assemblyContext.params },
    optionalConsumes: {},
  } as unknown as ModuleManifest;
  const assembly = createComposerAwareAssemblyManifest(legacyAssembly);
  const resolvedAssembly = await assembly.execute({
    ...ctx,
    params: Object.freeze({}),
    store: {
      topic: "Quiet evening",
      channelMusicProgramKey: programEntry[0],
      channelMusicProgramFingerprint: producedProgram.fingerprint,
    },
  }) as Record<string, unknown>;
  assert.equal(resolvedAssembly.bodyMusicVol, 0.37, "assembly consumes the exact producer-written R2 program rather than a test-authored substitute");
  await assert.rejects(assembly.execute({
    ...ctx,
    params: Object.freeze({}),
    store: { topic: "Different episode", channelMusicProgramKey: programEntry[0],
      channelMusicProgramFingerprint: producedProgram.fingerprint },
  }), /does not match the current channel, topic, and fingerprint/);
  await assert.rejects(assembly.execute({
    ...ctx,
    channelId: "foreign-channel",
    params: Object.freeze({}),
    store: { topic: "Quiet evening", channelMusicProgramKey: programEntry[0],
      channelMusicProgramFingerprint: producedProgram.fingerprint },
  }), /does not match the current channel, topic, and fingerprint/);
  writtenObjects.clear();
  reads.length = 0;

  await assert.rejects(music.run({ ...ctx, store: { ...ctx.store, musicQualityReceiptKey: "quality.json", preparedMusic: {
    ...prepared, provider: "minimax_music3",
    musicProgram: createChannelMusicProgram({ channelId: String(ctx.channelId), channelIdentityFingerprint: "a".repeat(64),
      family: "narrated_stock", contentLaneKey: "narrated_stock", topic: "Quiet evening", providerPreference: "minimax_music3" }),
    minimax: { nativeWavKey: "native.wav", runtimeReceiptKey: "runtime.json", qualityReceiptKey: "quality.json" },
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
  console.log("MUSIC INPUT ADMISSION PASS: exact provider selection, receipted reuse, owner/channel/topic binding and fingerprint validation before I/O");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
});
