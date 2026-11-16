import { z } from "zod";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../lib/studioRenderEngineWorkflows";
import { canonicalJson } from "../lib/canonicalJson";
import { sha256Hex } from "../lib/sha256";

const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["qwen3-tts"];
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const EngineQwenReceiptSchema = z.object({
  schema: z.literal("studio-engine-qwen-receipt/v1"), requestKey: Hash, requestScope: z.string().min(1).max(200),
  model: z.literal("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
  revision: z.literal("0c0e3051f131929182e2c023b9537f8b1c68adfe"),
  textSha256: Hash, instructionSha256: Hash, speaker: z.literal("Ryan"), language: z.literal("English"),
  seed: z.number().int().min(1).max(0xffffffff), audioSha256: Hash,
  audioFormat: z.literal("mp3"), sampleRateHz: z.literal(24000), durationSec: z.number().min(0.25).max(120),
  engine: z.object({ projectName: z.literal(STUDIO_ENGINE_PROJECT), workflowId: z.literal(workflow.workflowId),
    profileRevisionSha256: z.literal(workflow.profileRevisionSha256), jobId: z.string().regex(/^[a-z0-9]{32}$/),
    requestSha256: Hash, nativeOutput: z.object({ bucket: z.literal(STUDIO_ENGINE_BUCKET), key: z.string(),
      bytes: z.number().int().positive(), sha256: Hash, contentType: z.literal("audio/wav"), verifiedAt: z.number().positive() }).strict(),
    transformation: z.literal("ffmpeg-libmp3lame-160k-24khz-mono/v1"),
  }).strict(),
  runtime: z.object({ provider: z.literal("render-engine"), accounting: z.literal("engine-reported-usage"),
    gpuSeconds: z.number().nonnegative(), costUsd: z.number().nonnegative(), complete: z.literal(true) }).strict(),
}).strict().superRefine((value, ctx) => {
  const expected = sha256Hex(canonicalJson({ textSha256: value.textSha256, instructionSha256: value.instructionSha256,
    speaker: value.speaker, language: value.language, seed: value.seed, scope: value.requestScope,
    profile: workflow.profileRevisionSha256 }));
  if (expected !== value.requestKey) ctx.addIssue({ code: "custom", message: "Engine Qwen request identity changed" });
  if (!value.engine.nativeOutput.key.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) ||
    value.engine.nativeOutput.key.split("/").some(part => !part || part === "." || part === "..")) {
    ctx.addIssue({ code: "custom", message: "Native output is outside Studio's Engine workspace" });
  }
});
export type EngineQwenReceipt = z.infer<typeof EngineQwenReceiptSchema> & {
  workerImageDigest?: never; qwenTtsPackageVersion?: never; transformersVersion?: never; dtype?: never; attention?: never;
};
