import { z } from "zod";
import { canonicalJson } from "../lib/canonicalJson";
import { sha256Hex } from "../lib/sha256";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../lib/studioRenderEngineWorkflows";

const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["fish-audio-s2-pro"];
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FishEngineTextSchema = z.string().min(1).max(8000).refine(value => value.trim().length > 0 &&
  new TextEncoder().encode(value).length <= 8000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Invalid native Fish text");
export const FishEngineReferenceSchema = z.object({ objectKey: z.string(), sha256: Hash, text: FishEngineTextSchema }).strict().superRefine((value, ctx) => {
  if (value.objectKey !== `projects/${STUDIO_ENGINE_PROJECT}/assets/voices/sha256/${value.sha256}.wav`) {
    ctx.addIssue({ code: "custom", message: "Fish reference must use Studio's exact immutable voice import key" });
  }
});
export type FishEngineReference = z.infer<typeof FishEngineReferenceSchema>;
export const EngineFishReceiptSchema = z.object({
  schema: z.literal("studio-engine-fish-receipt/v1"), requestKey: Hash, requestScope: z.string().min(1).max(200),
  voiceId: z.string(), textSha256: Hash, referenceSha256: Hash, referenceTextSha256: Hash,
  seed: z.number().int().min(0).max(0xffffffff), audioSha256: Hash, durationSec: z.number().positive().max(300),
  sampleRateHz: z.literal(44100), channels: z.literal(1), audioFormat: z.literal("mp3"),
  transformation: z.literal("ffmpeg-libmp3lame-192k-44100hz-mono/v1"),
  engine: z.object({ projectName: z.literal(STUDIO_ENGINE_PROJECT), workflowId: z.literal(workflow.workflowId),
    profileRevisionSha256: z.literal(workflow.profileRevisionSha256), jobId: z.string().regex(/^[a-z0-9]{32}$/), requestSha256: Hash,
    nativeOutput: z.object({ bucket: z.literal(STUDIO_ENGINE_BUCKET), key: z.string(), bytes: z.number().int().positive(),
      sha256: Hash, contentType: z.literal("audio/wav"), verifiedAt: z.number().positive() }).strict() }).strict(),
  runtime: z.object({ gpuSeconds: z.number().nonnegative(), costUsd: z.number().nonnegative(), complete: z.literal(true),
    provider: z.literal("render-engine"), accounting: z.literal("engine-reported-usage") }).strict(),
}).strict().superRefine((value, ctx) => {
  const expected = sha256Hex(canonicalJson({ textSha256: value.textSha256, referenceSha256: value.referenceSha256,
    referenceTextSha256: value.referenceTextSha256, seed: value.seed, scope: value.requestScope, profile: workflow.profileRevisionSha256 }));
  if (expected !== value.requestKey || value.voiceId !== `engine-fish:${value.referenceSha256}` ||
    !value.engine.nativeOutput.key.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) ||
    value.engine.nativeOutput.key.split("/").some(part => !part || part === "." || part === "..")) {
    ctx.addIssue({ code: "custom", message: "Engine Fish receipt identity or owned output changed" });
  }
});
export type EngineFishReceipt = z.infer<typeof EngineFishReceiptSchema>;
