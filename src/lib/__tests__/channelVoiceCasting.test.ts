import assert from "node:assert/strict";

import {
  channelVoiceCastingProvider,
  qwenChannelCastingReceiptMatches,
  resolveRequestedChannelVoice,
  type PersistedChannelVoiceCast,
} from "@/lib/channelVoiceCasting";
import type { QwenTtsReceipt } from "@/lib/qwenTts";

const qwenFromPipeline = resolveRequestedChannelVoice({
  pipeline: [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Aiden" } }],
  moduleConfig: {},
  locale: "en-US",
});
assert.deepEqual(qwenFromPipeline, {
  provider: "qwen3",
  qwenSpeaker: "Aiden",
  qwenLanguage: "English",
});

const qwenFromRuntimeConfig = resolveRequestedChannelVoice({
  pipeline: [{ block: "narration_tts", params: { ttsProvider: "elevenlabs" } }],
  moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Sohee", language: "ko-KR" } },
  locale: "en",
});
assert.equal(qwenFromRuntimeConfig.provider, "qwen3", "runtime config must outrank the designed default it replaces");
assert.equal(qwenFromRuntimeConfig.qwenSpeaker, "Sohee");
assert.equal(qwenFromRuntimeConfig.qwenLanguage, "Korean");

assert.throws(
  () => resolveRequestedChannelVoice({
    pipeline: [{ block: "narration_tts", params: { ttsProvider: "fish" } }],
    moduleConfig: {},
    locale: "en",
  }),
  /uncast Fish voice/,
);
assert.throws(
  () => resolveRequestedChannelVoice({
    pipeline: [
      { block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Aiden" } },
      { block: "whiteboard_scribe" },
    ],
    moduleConfig: {},
    locale: "en",
  }),
  /cannot be mixed/,
);
assert.throws(
  () => resolveRequestedChannelVoice({
    pipeline: [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "George" } }],
    moduleConfig: {},
    locale: "en",
  }),
  /does not recognize CustomVoice speaker/,
);

const audioSha256 = "b".repeat(64);
const providerRenderReceipt = {
  schema: "qwen3-tts-worker/v1",
  requestKey: "a".repeat(64),
  model: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  revision: "0c0e3051f131929182e2c023b9537f8b1c68adfe",
  qwenTtsPackageVersion: "0.1.1",
  transformersVersion: "4.57.3",
  dtype: "bfloat16",
  attention: "flash_attention_2",
  textSha256: "c".repeat(64),
  instructionSha256: "d".repeat(64),
  speaker: "Aiden",
  language: "English",
  seed: 4_242,
  audioSha256,
  audioFormat: "mp3",
  sampleRateHz: 24_000,
  durationSec: 4.2,
  runtime: {
    provider: "novita",
    gpu: "RTX 4090",
    capacityMode: "spot",
    persistentCache: true,
    idleShutdownSeconds: 120,
    gpuSeconds: 10,
    gpuRateUsdPerSecond: 0.00005,
    startupUsd: 0,
    storageUsd: 0,
    costUsd: 0.0005,
  },
} satisfies QwenTtsReceipt;
const qwenCast = {
  voiceId: "Aiden",
  score: 7.8,
  at: Date.now(),
  providerSelectionReceipt: {
    version: "voice-provider-selection/v1",
    ownerId: "owner",
    channelId: "channel",
    provider: "qwen3",
    voiceId: "Aiden",
    score: 7.8,
    selectedAt: Date.now(),
    shortlistedCount: 1,
    shortlistFingerprint: "e".repeat(64),
    selectionFingerprint: "f".repeat(64),
  },
  localColdOpenReceipt: {
    version: "voice-local-cold-open/v1",
    ownerId: "owner",
    channelId: "channel",
    provider: "qwen3",
    voiceId: "Aiden",
    measuredAt: Date.now(),
    textFingerprint: "1".repeat(64),
    physicsFingerprint: "2".repeat(64),
    audioFingerprint: audioSha256,
    durationSec: 4.2,
    wordsPerSec: 2,
    integratedLufs: -18,
  },
  providerRenderReceipt,
} satisfies PersistedChannelVoiceCast;
assert.equal(channelVoiceCastingProvider(qwenCast), "qwen3");
assert.equal(qwenChannelCastingReceiptMatches(qwenCast), true);
assert.equal(qwenChannelCastingReceiptMatches({
  ...qwenCast,
  localColdOpenReceipt: { ...qwenCast.localColdOpenReceipt, audioFingerprint: "9".repeat(64) },
}), false, "the durable worker receipt and locally measured bytes must stay cryptographically bound");

console.log("channel voice casting boundary tests passed");
