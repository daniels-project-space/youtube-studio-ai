import { createHash } from "node:crypto";
import { z } from "zod";
import { ChannelMusicProgramSchema, type ChannelMusicProgram } from "../engine/channelMusicProgram";
import { canonicalJson } from "./canonicalJson";
import { executeStudioEngineAudio } from "./studioRenderEngineAudio";
import { StudioRenderEngineClient } from "./studioRenderEngineClient";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "./studioRenderEngineWorkflows";
import { parseMiniMaxMusic3Wav } from "./minimaxMusic3";

const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["minimax-music3"];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Usage = z.object({ gpuSeconds: z.number().nonnegative(), costUsd: z.number().nonnegative(), complete: z.boolean() });
export const EngineMusic3ReceiptSchema = z.object({
  schema: z.literal("studio-engine-music3-receipt/v1"), requestKey: Hash, requestScope: z.string().min(1).max(200),
  jobId: z.string().regex(/^[a-z0-9]{32}$/), programFingerprint: Hash,
  model: z.literal("MiniMaxAI/MiniMax-Music3"), modelRevision: z.literal("fbdf52fbaaca799592917417eb05f1899f1255ec"),
  captionSha256: Hash, lyricsControlSha256: Hash, seed: z.number().int().min(0).max(0xffffffff),
  durationSec: z.number().positive().max(300), requestedDurationSec: z.number().int().positive().max(300),
  nativeProfile: z.object({ precision: z.literal("bf16"), ditSteps: z.literal(30), acousticCfg: z.literal(1.7),
    arCfg: z.literal(1.5), framesPerSecond: z.literal(25), cacheDit: z.literal(false) }).strict(),
  output: z.object({ contentSha256: Hash, byteLength: z.number().int().min(44).max(50_000_000),
    sampleRateHz: z.literal(32000), channels: z.literal(2), bitsPerSample: z.literal(16),
    codec: z.literal("pcm_s16le"), container: z.literal("wav") }).strict(),
  engine: z.object({ projectName: z.literal(STUDIO_ENGINE_PROJECT), workflowId: z.literal(workflow.workflowId),
    profileRevisionSha256: z.literal(workflow.profileRevisionSha256), requestSha256: Hash,
    nativeOutput: z.object({ bucket: z.literal(STUDIO_ENGINE_BUCKET), key: z.string(), bytes: z.number().int().positive(),
      sha256: Hash, contentType: z.literal("audio/wav"), verifiedAt: z.number().positive() }).strict() }).strict(),
  quality: z.object({ qualificationReceiptSha256: Hash, humanAuditioned: z.literal(true) }).strict(),
  license: z.object({ uiAttribution: z.literal("MiniMax-Music3"), prominentCommercialAttributionDisplayed: z.literal(true),
    generatedContentDisclosureEnabled: z.literal(true), safeguardsEnabled: z.literal(true), operatorAttested: z.literal(true) }).strict(),
  runtime: Usage.extend({ complete: z.literal(true), provider: z.literal("render-engine"), accounting: z.literal("engine-reported-usage") }).strict(),
}).strict().superRefine((receipt, ctx) => {
  const expected = hash(canonicalJson({ programFingerprint: receipt.programFingerprint, captionSha256: receipt.captionSha256,
    lyricsControlSha256: receipt.lyricsControlSha256, seed: receipt.seed, requestedDurationSec: receipt.requestedDurationSec,
    scope: receipt.requestScope, profile: workflow.profileRevisionSha256 }));
  if (expected !== receipt.requestKey || receipt.output.contentSha256 !== receipt.engine.nativeOutput.sha256 ||
    receipt.output.byteLength !== receipt.engine.nativeOutput.bytes || receipt.durationSec > receipt.requestedDurationSec ||
    !receipt.engine.nativeOutput.key.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) ||
    receipt.engine.nativeOutput.key.split("/").some(part => !part || part === "." || part === "..")) {
    ctx.addIssue({ code: "custom", message: "Engine Music3 receipt identity or owned output changed" });
  }
});
export type EngineMusic3Receipt = z.infer<typeof EngineMusic3ReceiptSchema>;

export function engineMusic3Request(programInput: unknown, seed: number, scope = "studio-manual") {
  const program = ChannelMusicProgramSchema.parse(programInput);
  if (program.generation.providerPreference !== "minimax_music3") throw new Error("Engine Music3 requires the selected channel music program");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !scope || scope.length > 200 ||
    program.generation.durationSec < 1 || program.generation.durationSec > 300 || !Number.isInteger(program.generation.durationSec) ||
    Buffer.byteLength(program.generation.structuredCaption) > 12000 || Buffer.byteLength(program.generation.lyricsControl) > 16000) {
    throw new Error("Engine Music3 input exceeds the native model contract");
  }
  const captionSha256 = hash(program.generation.structuredCaption), lyricsControlSha256 = hash(program.generation.lyricsControl);
  const requestKey = hash(canonicalJson({ programFingerprint: program.fingerprint, captionSha256, lyricsControlSha256,
    seed, requestedDurationSec: program.generation.durationSec, scope, profile: workflow.profileRevisionSha256 }));
  return { program, captionSha256, lyricsControlSha256, requestKey, request: {
    version: 1, idempotencyKey: `studio:music3:${requestKey}`, sourceId: `studio-music3-${requestKey}`,
    profileRevisionSha256: workflow.profileRevisionSha256, lyrics: program.generation.lyricsControl,
    description: program.generation.structuredCaption, seed, maxAudioSeconds: program.generation.durationSec,
    output: { contentType: "audio/wav", sampleRateHz: 32000, channels: 2, bitsPerSample: 16 },
  } };
}

export function validateEngineMusic3Receipt(value: unknown, program: ChannelMusicProgram): EngineMusic3Receipt {
  const receipt = EngineMusic3ReceiptSchema.parse(value);
  if (receipt.programFingerprint !== program.fingerprint || receipt.captionSha256 !== hash(program.generation.structuredCaption) ||
    receipt.lyricsControlSha256 !== hash(program.generation.lyricsControl) || receipt.requestedDurationSec !== program.generation.durationSec ||
    receipt.quality.qualificationReceiptSha256 !== process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_RECEIPT_SHA256) {
    throw new Error("Engine Music3 receipt does not bind the current channel program or native qualification");
  }
  return receipt;
}

export async function renderEngineMusic3(input: { program: unknown; seed: number; scope?: string; maxCostUsd: number }, options: {
  client: StudioRenderEngineClient; authorize: () => Promise<void>; wait: (seconds: number, key: string) => Promise<void>;
}) {
  if (process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_QUALIFIED !== "1" ||
    !Hash.safeParse(process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_RECEIPT_SHA256).success ||
    ["LICENSE_ATTESTED", "UI_ATTRIBUTION_ENABLED", "DISCLOSURE_ENABLED", "SAFEGUARDS_ATTESTED"]
      .some(suffix => process.env[`MINIMAX_MUSIC3_${suffix}`] !== "1")) {
    throw new Error("Engine Music3 needs its own native quality qualification and license attestations before submission");
  }
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0 || input.maxCostUsd > 10) throw new Error("Engine Music3 requires a bounded stage budget");
  const { program, captionSha256, lyricsControlSha256, requestKey, request } = engineMusic3Request(input.program, input.seed, input.scope);
  const result = await executeStudioEngineAudio({ model: "minimax-music3", workflowId: workflow.workflowId, request }, {
    ...options, onAccepted: async () => undefined,
  });
  let knownCostUsd: number | undefined;
  try {
    const status = await options.client.observeAudio({ jobId: result.jobId, state: "completed", manifestSha256: result.manifestSha256 }, "minimax-music3", workflow.workflowId);
    if (status.status !== "completed" || status.outputRetired || !status.output ||
      canonicalJson(status.output) !== canonicalJson(result.output)) throw new Error("Engine Music3 output is no longer current");
    const usage = Usage.parse(status.usage);
    knownCostUsd = usage.costUsd;
    if (!usage.complete || usage.costUsd > input.maxCostUsd) throw new Error("Engine Music3 usage requires reconciliation before advancing the retained job");
    const actual = parseMiniMaxMusic3Wav(result.bytes);
    if (actual.sampleRateHz !== 32000 || actual.channels !== 2 || actual.bitsPerSample !== 16 || actual.durationSec > program.generation.durationSec) {
      throw new Error("Engine Music3 native WAV differs from the frozen format or duration ceiling");
    }
    await options.authorize();
    const receipt = validateEngineMusic3Receipt({ schema: "studio-engine-music3-receipt/v1", requestKey,
      requestScope: input.scope ?? "studio-manual", jobId: result.jobId, programFingerprint: program.fingerprint,
      model: "MiniMaxAI/MiniMax-Music3", modelRevision: "fbdf52fbaaca799592917417eb05f1899f1255ec",
      captionSha256, lyricsControlSha256, seed: input.seed, durationSec: actual.durationSec, requestedDurationSec: program.generation.durationSec,
      nativeProfile: { precision: "bf16", ditSteps: 30, acousticCfg: 1.7, arCfg: 1.5, framesPerSecond: 25, cacheDit: false },
      output: { contentSha256: result.output.sha256, byteLength: result.output.bytes, sampleRateHz: 32000,
        channels: 2, bitsPerSample: 16, codec: "pcm_s16le", container: "wav" },
      engine: { projectName: STUDIO_ENGINE_PROJECT, workflowId: workflow.workflowId, profileRevisionSha256: workflow.profileRevisionSha256,
        requestSha256: result.manifestSha256, nativeOutput: result.output },
      quality: { qualificationReceiptSha256: process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_RECEIPT_SHA256, humanAuditioned: true },
      license: { uiAttribution: "MiniMax-Music3", prominentCommercialAttributionDisplayed: true,
        generatedContentDisclosureEnabled: true, safeguardsEnabled: true, operatorAttested: true },
      runtime: { provider: "render-engine", accounting: "engine-reported-usage", ...usage },
    }, program);
    return { audio: result.bytes, receipt };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Engine Music3 requires reconciliation");
    Object.assign(failure, { engineJobId: result.jobId, requestKey, retryable: false,
      ...(knownCostUsd === undefined ? {} : { additionalObservedCostUsd: knownCostUsd }) });
    throw failure;
  }
}
