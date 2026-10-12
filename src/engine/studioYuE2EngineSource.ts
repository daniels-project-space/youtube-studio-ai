import { z } from "zod";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "@/lib/studioRenderEngineWorkflows";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const YuE2EngineSourceConfigSchema = z.object({
  renderer: z.literal("render-engine"), seed: z.number().int().min(0).max(0xffffffff),
  personalCreatorAcknowledged: z.literal(true), maxCostUsd: z.number().finite().positive().max(1),
  maxExecutionSeconds: z.number().int().min(30).max(1200),
}).strict();
export const StudioYuE2ScoredRequestSchema = z.object({
  version: z.literal(2), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{16,200}$/),
  sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/),
  profileRevisionSha256: z.literal(STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2.profileRevisionSha256),
  lyrics: z.literal(""), style: z.string().min(1), seed: z.number().int().min(0).max(0xffffffff),
  maxAudioSeconds: z.literal(300), maxCostUsd: z.number().finite().positive().max(1),
  abc: z.string().min(1), abcSha256: hash,
  sourceConstraints: z.object({ provider: z.literal("openrelay"), gpuModel: z.literal("RTX 3090"),
    maxCostUsd: z.number().finite().positive().max(1), maxExecutionSeconds: z.number().int().min(30).max(1200) }).strict(),
  output: z.object({ contentType: z.literal("audio/wav"), sampleRateHz: z.literal(48000),
    channels: z.literal(2), sampleFormat: z.literal("float32") }).strict(),
}).strict();
export type StudioYuE2ScoredRequest = z.infer<typeof StudioYuE2ScoredRequestSchema>;
export const YuE2EngineUsageSchema = z.object({ gpuSeconds: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative(), complete: z.literal(true) }).strict();
export const YuE2EngineCandidateSchema = z.object({
  version: z.literal("studio-yue2-engine-candidate/v1"), ownerId: id, channelId: id, runId: id,
  jobId: z.string().regex(/^[a-z0-9]{32}$/), programFingerprint: hash,
  bindingKey: z.string(), bindingSha256: hash, provenanceKey: z.string(), provenanceSha256: hash,
  audioKey: z.string(), audioSha256: hash, audioBytes: z.number().int().positive().max(115_500_000),
  nativeOutput: z.object({ sampleRateHz: z.literal(48000), channels: z.literal(2), codec: z.literal("pcm_f32le"),
    frames: z.number().int().positive(), durationSec: z.number().finite().positive().max(300) }).strict(),
  headroom: z.object({ audioKey: z.string(), audioSha256: hash, audioBytes: z.number().int().positive(),
    receiptKey: z.string(), receiptSha256: hash }).strict().optional(),
  engine: z.object({ project: z.literal(STUDIO_ENGINE_PROJECT), bucket: z.literal(STUDIO_ENGINE_BUCKET),
    workflowId: z.literal(STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2.workflowId), requestSha256: hash }).strict(),
  usage: YuE2EngineUsageSchema,
  nativeFormatVerified: z.literal(true), qualified: z.literal(false), productionApproved: z.literal(false),
  manualAudition: z.literal("pending"),
}).strict().superRefine((value, ctx) => {
  const root = `owner/${value.ownerId}/runs/${value.runId}/music/yue2-engine/`;
  if (value.bindingKey !== `${root}binding.json` || value.provenanceKey !== `${root}provenance.json` ||
      value.audioKey !== `${root}audio-native-${value.audioSha256}.wav` ||
      value.nativeOutput.frames / 48000 !== value.nativeOutput.durationSec) {
    ctx.addIssue({ code: "custom", message: "Engine source scope or measured native duration changed" });
  }
});
