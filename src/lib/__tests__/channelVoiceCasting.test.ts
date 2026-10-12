import assert from "node:assert/strict";

import {
  channelVoiceCastingProvider,
  fishChannelCastingReceiptMatches,
  qwenChannelCastingReceiptMatches,
  resolveRequestedChannelVoice,
  type PersistedChannelVoiceCast,
} from "@/lib/channelVoiceCasting";
import type { QwenTtsReceipt } from "@/lib/qwenTts";
import { engineFishRequest } from "../fishEngine";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../studioRenderEngineWorkflows";
import { sha256Hex } from "../sha256";
import { channelInceptionContentSha256 } from "@/engine/channelInceptionPlan";
import { selectDeterministicFishVoice } from "../deterministicVoiceCast";
import { validateVoiceCastingReadinessReceipt } from "../voiceCastingReceipt";

const qwenFromPipeline = resolveRequestedChannelVoice({
  pipeline: [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } }],
  moduleConfig: {},
  locale: "en-US",
});
assert.deepEqual(qwenFromPipeline, {
  provider: "qwen3",
  qwenSpeaker: "Ryan",
  qwenLanguage: "English",
});

const qwenFromRuntimeConfig = resolveRequestedChannelVoice({
  pipeline: [{ block: "narration_tts", params: { ttsProvider: "elevenlabs" } }],
  moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan", language: "en-US" } },
  locale: "en",
});
assert.equal(qwenFromRuntimeConfig.provider, "qwen3", "runtime config must outrank the designed default it replaces");
assert.equal(qwenFromRuntimeConfig.qwenSpeaker, "Ryan");
assert.equal(qwenFromRuntimeConfig.qwenLanguage, "English");
assert.throws(() => resolveRequestedChannelVoice({
  pipeline: [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Sohee", language: "ko-KR" } }],
  moduleConfig: {}, locale: "ko-KR",
}), /requested channel voice requires another Engine profile/);

assert.throws(
  () => resolveRequestedChannelVoice({
    pipeline: [{ block: "narration_tts", params: { ttsProvider: "fish" } }],
    moduleConfig: {},
    locale: "en",
  }),
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
  schema: "qwen3-tts-worker/v2",
  requestKey: "a".repeat(64),
  workerImageDigest: "registry.example/ysa/qwen3-tts@sha256:" + "b".repeat(64),
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
    capacityMode: "serverless-scale-to-zero",
    persistentCache: true,
    idleShutdownSeconds: 300,
    accounting: "conservative-upper-bound",
    requestGpuSeconds: 10,
    gpuSeconds: 310,
    gpuRateUsdPerSecond: 0.00005,
    startupUsd: 0,
    storageUsd: 0,
    costUsd: 0.0155,
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

const reference = { sha256: "c".repeat(64), objectKey: `projects/${STUDIO_ENGINE_PROJECT}/assets/voices/sha256/${"c".repeat(64)}.wav`,
  text: "An explicitly imported voice reference." };
const metadata = { name: "Reviewed narrator", category: "professional cloned", labels: { gender: "male", age: "adult",
  "use case": "documentary narrative", "native language": "English" } };
const fishRequest = resolveRequestedChannelVoice({ pipeline: [{ block: "narration_tts", params: { ttsProvider: "fish" } }],
  moduleConfig: { narration_tts: { fishEngineReference: reference, fishVoiceMetadata: metadata, ttsSpeed: 1 } }, locale: "English" });
assert.equal(fishRequest.provider, "fish");
assert.equal(fishRequest.fishVoice?.voiceId, `engine-fish:${reference.sha256}`);
const fishSelection = selectDeterministicFishVoice({ voice: fishRequest.fishVoice!, language: "English" });
assert.equal(fishSelection.provider, "fish");
assert.equal(fishSelection.physics.speed, 1);
assert.match(fishSelection.why, /operator-declared/);
assert.throws(() => resolveRequestedChannelVoice({ pipeline: [{ block: "narration_tts", params: { ttsProvider: "fish",
  fishEngineReference: reference, fishVoiceMetadata: metadata, ttsSpeed: 0.9 } }], moduleConfig: {}, locale: "en" }), /native speed 1/);
const fishText = "The exact measured cold open.", prepared = engineFishRequest({ text: fishText, reference });
const fishWorkflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["fish-audio-s2-pro"];
const fishCast = { ...qwenCast, voiceId: prepared.voiceId, fishEngineReference: reference,
  providerSelectionReceipt: { ...qwenCast.providerSelectionReceipt, provider: "fish" as const, voiceId: prepared.voiceId },
  localColdOpenReceipt: { ...qwenCast.localColdOpenReceipt, provider: "fish" as const, voiceId: prepared.voiceId,
    textFingerprint: channelInceptionContentSha256(fishText) },
  providerRenderReceipt: { schema: "studio-engine-fish-receipt/v1" as const, requestKey: prepared.requestKey, requestScope: "studio-manual",
    voiceId: prepared.voiceId, textSha256: sha256Hex(fishText), referenceSha256: reference.sha256, referenceTextSha256: sha256Hex(reference.text),
    seed: 4242, audioSha256, durationSec: 4.2, sampleRateHz: 44100 as const, channels: 1 as const, audioFormat: "mp3" as const,
    transformation: "ffmpeg-libmp3lame-192k-44100hz-mono/v1" as const,
    engine: { projectName: STUDIO_ENGINE_PROJECT, workflowId: fishWorkflow.workflowId, profileRevisionSha256: fishWorkflow.profileRevisionSha256,
      jobId: "d".repeat(32), requestSha256: "e".repeat(64), nativeOutput: { bucket: STUDIO_ENGINE_BUCKET,
        key: `projects/${STUDIO_ENGINE_PROJECT}/jobs/${"d".repeat(32)}/audio.wav`, bytes: 100000, sha256: "f".repeat(64), contentType: "audio/wav" as const, verifiedAt: 123 } },
    runtime: { provider: "render-engine" as const, accounting: "engine-reported-usage" as const, gpuSeconds: 4, costUsd: 0.01, complete: true as const },
  },
} satisfies PersistedChannelVoiceCast;
assert.equal(fishChannelCastingReceiptMatches(fishCast, reference, fishText), true);
assert.equal(validateVoiceCastingReadinessReceipt({ cast: fishCast, ownerId: "owner", channelId: "channel" }), true);
assert.equal(validateVoiceCastingReadinessReceipt({ cast: { ...fishCast, providerRenderReceipt: undefined },
  ownerId: "owner", channelId: "channel" }), false, "metadata and local measurements alone cannot qualify native Fish");
assert.equal(qwenChannelCastingReceiptMatches(fishCast), false);
assert.equal(fishChannelCastingReceiptMatches(fishCast, { ...reference, text: "Changed reference transcript" }, fishText), false);
assert.equal(fishChannelCastingReceiptMatches(fishCast, reference, "Changed cold open"), false);
assert.equal(fishChannelCastingReceiptMatches({ ...fishCast, localColdOpenReceipt: { ...fishCast.localColdOpenReceipt,
  audioFingerprint: "0".repeat(64) } }, reference, fishText), false);

console.log("channel voice casting boundary tests passed");
