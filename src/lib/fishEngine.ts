import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import { executeStudioEngineAudio } from "./studioRenderEngineAudio";
import { StudioRenderEngineClient } from "./studioRenderEngineClient";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "./studioRenderEngineWorkflows";
import { encodeEngineNarrationMp3 } from "./qwenEngine";
import { parseMiniMaxMusic3Wav } from "./minimaxMusic3";

const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["fish-audio-s2-pro"];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().min(1).max(8000).refine(value => value.trim().length > 0 && Buffer.byteLength(value) <= 8000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Invalid native Fish text");
export const FishEngineReferenceSchema = z.object({ objectKey: z.string(), sha256: Hash, text: Text }).strict().superRefine((value, ctx) => {
  if (value.objectKey !== `projects/${STUDIO_ENGINE_PROJECT}/assets/voices/sha256/${value.sha256}.wav`) {
    ctx.addIssue({ code: "custom", message: "Fish reference must use Studio's exact immutable voice import key" });
  }
});
export type FishEngineReference = z.infer<typeof FishEngineReferenceSchema>;
const Usage = z.object({ gpuSeconds: z.number().nonnegative(), costUsd: z.number().nonnegative(), complete: z.boolean() });
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
  runtime: Usage.extend({ complete: z.literal(true), provider: z.literal("render-engine"), accounting: z.literal("engine-reported-usage") }).strict(),
}).strict().superRefine((value, ctx) => {
  const expected = hash(canonicalJson({ textSha256: value.textSha256, referenceSha256: value.referenceSha256,
    referenceTextSha256: value.referenceTextSha256, seed: value.seed, scope: value.requestScope, profile: workflow.profileRevisionSha256 }));
  if (expected !== value.requestKey || value.voiceId !== `engine-fish:${value.referenceSha256}` ||
    !value.engine.nativeOutput.key.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) ||
    value.engine.nativeOutput.key.split("/").some(part => !part || part === "." || part === "..")) {
    ctx.addIssue({ code: "custom", message: "Engine Fish receipt identity or owned output changed" });
  }
});
export type EngineFishReceipt = z.infer<typeof EngineFishReceiptSchema>;

export function engineFishRequest(input: { text: string; reference: unknown; seed?: number; scope?: string; speed?: number; voiceId?: string }) {
  const text = Text.parse(input.text), reference = FishEngineReferenceSchema.parse(input.reference), seed = input.seed ?? 4242;
  const scope = z.string().min(1).max(200).parse(input.scope ?? "studio-manual");
  if (input.speed !== undefined && input.speed !== 1) throw new Error("Engine Fish currently has no native speaking-rate control; refusing a changed pacing request");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid native Fish seed");
  const voiceId = `engine-fish:${reference.sha256}`;
  if (input.voiceId !== undefined && input.voiceId !== voiceId) throw new Error("Hosted Fish voice IDs cannot replace the selected Engine reference identity");
  const requestKey = hash(canonicalJson({ textSha256: hash(text), referenceSha256: reference.sha256,
    referenceTextSha256: hash(reference.text), seed, scope, profile: workflow.profileRevisionSha256 }));
  return { requestKey, voiceId, reference, request: { version: 1, idempotencyKey: `studio:fish:${requestKey}`, sourceId: `studio-fish-${requestKey}`,
    profileRevisionSha256: workflow.profileRevisionSha256, text, seed, maxAudioSeconds: 300,
    // This required legacy field is audit metadata, not an enforced spend cap.
    maxCostUsd: 0, reference, output: { contentType: "audio/wav", sampleRateHz: 44100, channels: 1, bitsPerSample: 16 } } };
}

export async function renderEngineFish(input: Parameters<typeof engineFishRequest>[0] & { maxCostUsd: number }, options: {
  client: StudioRenderEngineClient; authorize: () => Promise<void>; wait: (seconds: number, key: string) => Promise<void>;
}) {
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) throw new Error("Engine Fish requires a finite stage envelope");
  const { requestKey, voiceId, reference, request } = engineFishRequest(input);
  const result = await executeStudioEngineAudio({ model: "fish-audio-s2-pro", workflowId: workflow.workflowId, request }, {
    ...options, onAccepted: async () => undefined,
  });
  let knownCostUsd: number | undefined;
  try {
    const admission = { jobId: result.jobId, state: "completed", manifestSha256: result.manifestSha256 };
    const current = await options.client.observeAudio(admission, "fish-audio-s2-pro", workflow.workflowId);
    if (current.status !== "completed" || current.outputRetired || canonicalJson(current.output) !== canonicalJson(result.output)) throw new Error("Engine Fish completion is no longer current");
    const usage = Usage.parse(current.usage); knownCostUsd = usage.costUsd;
    if (!usage.complete || usage.costUsd > input.maxCostUsd) throw new Error("Engine Fish usage requires reconciliation before narration advances");
    const wav = parseMiniMaxMusic3Wav(result.bytes);
    if (wav.sampleRateHz !== 44100 || wav.channels !== 1 || wav.bitsPerSample !== 16 || wav.durationSec > 300) throw new Error("Engine Fish output differs from the frozen native waveform");
    const audio = await encodeEngineNarrationMp3(result.bytes, "fish");
    await options.authorize();
    const after = await options.client.observeAudio(admission, "fish-audio-s2-pro", workflow.workflowId);
    if (after.status !== "completed" || after.outputRetired || canonicalJson(after.output) !== canonicalJson(result.output) ||
      canonicalJson(Usage.parse(after.usage)) !== canonicalJson(usage)) throw new Error("Engine Fish completion changed during encoding");
    const receipt = EngineFishReceiptSchema.parse({ schema: "studio-engine-fish-receipt/v1", requestKey, requestScope: input.scope ?? "studio-manual",
      voiceId, textSha256: hash(request.text), referenceSha256: reference.sha256, referenceTextSha256: hash(reference.text), seed: request.seed,
      audioSha256: hash(audio), durationSec: wav.durationSec, sampleRateHz: 44100, channels: 1, audioFormat: "mp3",
      transformation: "ffmpeg-libmp3lame-192k-44100hz-mono/v1", engine: { projectName: STUDIO_ENGINE_PROJECT,
        workflowId: workflow.workflowId, profileRevisionSha256: workflow.profileRevisionSha256, jobId: result.jobId,
        requestSha256: result.manifestSha256, nativeOutput: result.output },
      runtime: { provider: "render-engine", accounting: "engine-reported-usage", ...usage } });
    return { audio, receipt };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Engine Fish requires reconciliation");
    Object.assign(failure, { requestKey, engineJobId: result.jobId, retryable: false,
      ...(knownCostUsd === undefined ? {} : { additionalObservedCostUsd: knownCostUsd }) });
    throw failure;
  }
}
