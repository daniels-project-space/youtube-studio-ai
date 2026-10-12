import { v } from "convex/values";

export const voiceCastingProviderValidator = v.union(
  v.literal("elevenlabs"),
  v.literal("qwen3"),
  v.literal("fish"),
);

export const fishEngineReferenceValidator = v.object({ objectKey: v.string(), sha256: v.string(), text: v.string() });
const fishEngineReceiptValidator = v.object({
  schema: v.literal("studio-engine-fish-receipt/v1"), requestKey: v.string(), requestScope: v.string(),
  voiceId: v.string(), textSha256: v.string(), referenceSha256: v.string(), referenceTextSha256: v.string(),
  seed: v.number(), audioSha256: v.string(), durationSec: v.number(), sampleRateHz: v.literal(44100),
  channels: v.literal(1), audioFormat: v.literal("mp3"), transformation: v.literal("ffmpeg-libmp3lame-192k-44100hz-mono/v1"),
  engine: v.object({ projectName: v.literal("youtube-studio-render"), workflowId: v.literal("jn7cw38gsqzbmxgyy48pptn96h8g5vmv"),
    profileRevisionSha256: v.literal("15a43637436a1307049a3441d3009d7f15a5b36760a6f486a04415bc2d4ba842"),
    jobId: v.string(), requestSha256: v.string(), nativeOutput: v.object({ bucket: v.literal("re-youtube-studio-render-p2w18g596q"),
      key: v.string(), bytes: v.number(), sha256: v.string(), contentType: v.literal("audio/wav"), verifiedAt: v.number() }),
  }),
  runtime: v.object({ provider: v.literal("render-engine"), accounting: v.literal("engine-reported-usage"),
    gpuSeconds: v.number(), costUsd: v.number(), complete: v.literal(true) }),
});

/** Durable attestation emitted by the pinned private Qwen3-TTS worker. */
const legacyQwenTtsReceiptValidator = v.object({
  schema: v.literal("qwen3-tts-worker/v2"),
  requestKey: v.string(),
  workerImageDigest: v.string(),
  model: v.literal("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
  revision: v.literal("0c0e3051f131929182e2c023b9537f8b1c68adfe"),
  qwenTtsPackageVersion: v.literal("0.1.1"),
  transformersVersion: v.literal("4.57.3"),
  dtype: v.literal("bfloat16"),
  attention: v.literal("flash_attention_2"),
  textSha256: v.string(),
  instructionSha256: v.string(),
  speaker: v.union(
    v.literal("Vivian"),
    v.literal("Serena"),
    v.literal("Uncle_Fu"),
    v.literal("Dylan"),
    v.literal("Eric"),
    v.literal("Ryan"),
    v.literal("Aiden"),
    v.literal("Ono_Anna"),
    v.literal("Sohee"),
  ),
  language: v.union(
    v.literal("Auto"),
    v.literal("Chinese"),
    v.literal("English"),
    v.literal("Japanese"),
    v.literal("Korean"),
    v.literal("German"),
    v.literal("French"),
    v.literal("Russian"),
    v.literal("Portuguese"),
    v.literal("Spanish"),
    v.literal("Italian"),
  ),
  seed: v.number(),
  audioSha256: v.string(),
  audioFormat: v.literal("mp3"),
  sampleRateHz: v.literal(24_000),
  durationSec: v.number(),
  // These are deliberately paired variants rather than independent unions:
  // an OpenRelay receipt may never claim the legacy 4090 serverless route,
  // and a retained Novita receipt may never be reinterpreted as OpenRelay.
  runtime: v.union(
    v.object({
      provider: v.literal("novita"),
      gpu: v.literal("RTX 4090"),
      capacityMode: v.literal("serverless-scale-to-zero"),
      persistentCache: v.literal(true),
      idleShutdownSeconds: v.number(),
      accounting: v.literal("conservative-upper-bound"),
      requestGpuSeconds: v.number(),
      gpuSeconds: v.number(),
      gpuRateUsdPerSecond: v.number(),
      startupUsd: v.number(),
      storageUsd: v.number(),
      costUsd: v.number(),
    }),
    v.object({
      provider: v.literal("openrelay"),
      gpu: v.literal("RTX 3090"),
      capacityMode: v.literal("persistent-disk-auto-stop"),
      persistentCache: v.literal(true),
      idleShutdownSeconds: v.number(),
      accounting: v.literal("conservative-upper-bound"),
      requestGpuSeconds: v.number(),
      gpuSeconds: v.number(),
      gpuRateUsdPerSecond: v.number(),
      startupUsd: v.number(),
      storageUsd: v.number(),
      costUsd: v.number(),
    }),
  ),
});

export const qwenTtsReceiptValidator = v.union(legacyQwenTtsReceiptValidator, v.object({
  schema: v.literal("studio-engine-qwen-receipt/v1"), requestKey: v.string(), requestScope: v.string(),
  model: v.literal("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"), revision: v.literal("0c0e3051f131929182e2c023b9537f8b1c68adfe"),
  textSha256: v.string(), instructionSha256: v.string(), speaker: v.literal("Ryan"), language: v.literal("English"),
  seed: v.number(), audioSha256: v.string(), audioFormat: v.literal("mp3"), sampleRateHz: v.literal(24000), durationSec: v.number(),
  engine: v.object({ projectName: v.literal("youtube-studio-render"), workflowId: v.literal("jn799fshgrnb2qkc2326zec5518g53q3"),
    profileRevisionSha256: v.literal("0a78001cc82ccfd2e19fa2930c5ee174c5f46df997c5657082305bb671b49d2a"),
    jobId: v.string(), requestSha256: v.string(),
    nativeOutput: v.object({ bucket: v.literal("re-youtube-studio-render-p2w18g596q"), key: v.string(), bytes: v.number(),
      sha256: v.string(), contentType: v.literal("audio/wav"), verifiedAt: v.number() }),
    transformation: v.literal("ffmpeg-libmp3lame-160k-24khz-mono/v1"),
  }),
  runtime: v.object({ provider: v.literal("render-engine"), accounting: v.literal("engine-reported-usage"),
    gpuSeconds: v.number(), costUsd: v.number(), complete: v.literal(true) }),
}));

export const voiceProviderRenderReceiptValidator = v.union(qwenTtsReceiptValidator, fishEngineReceiptValidator);
