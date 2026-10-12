import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import { sha256Hex, sha256BytesHex } from "./sha256";
import { getObjectBytes, putObject } from "./storage";
import { getStudioPrivateBucket } from "./studioPrivateStorage";
import { createYuE2EngineRequest } from "./yue2EngineRequest";
import { StudioRenderEngineClient } from "./studioRenderEngineClient";
import { executeStudioEngineAudio, type StudioEngineAudioRecovery } from "./studioRenderEngineAudio";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "./studioRenderEngineWorkflows";
import { YuE2EngineCandidateSchema, YuE2EngineUsageSchema } from "@/engine/studioYuE2EngineSource";
import { probeYuE2NativeWav } from "./yue2NativeAudio";
import { measureNativeAudioSignal } from "./nativeAudioSignal";

const execute = promisify(execFile), workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2;
const json = (value: unknown) => Buffer.from(canonicalJson(value));
const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const nativeOutput = z.object({ bucket: z.literal(STUDIO_ENGINE_BUCKET), key: z.string(), bytes: z.number().int().positive().max(115_500_000),
  sha256: hash, contentType: z.literal("audio/wav"), verifiedAt: z.number().positive(),
  nativeArtifacts: z.array(z.object({ name: z.string(), key: z.string(), bytes: z.number().int().positive(), sha256: hash, contentType: z.string() }).strict()).length(6),
}).strict();
const provenanceSchema = z.object({ version: z.literal("studio-yue2-engine-provenance/v1"),
  jobId: z.string().regex(/^[a-z0-9]{32}$/), requestSha256: hash, output: nativeOutput, usage: YuE2EngineUsageSchema }).strict();
const headroomSchema = z.object({ version: z.literal("studio-yue2-engine-headroom/v1"), jobId: z.string().regex(/^[a-z0-9]{32}$/),
  sourceSha256: hash, evidenceSha256: hash, audioSha256: hash, frames: z.number().int().positive(),
  gainDb: z.number().finite().max(0), ceilingDbtp: z.literal(-1), beforeDbtp: z.number().finite(), afterDbtp: z.number().finite(),
  method: z.literal("linear_attenuation_only"), productionApproved: z.literal(false) }).strict();
const signalCache = new Map<string, Promise<Awaited<ReturnType<typeof measureNativeAudioSignal>>>>();

export function yuE2EngineRoot(scope: { ownerId: string; channelId: string; runId: string }) {
  if (![scope.ownerId, scope.channelId, scope.runId].every(id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id))) throw new Error("Invalid Engine music source scope");
  return `owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-engine/`;
}
async function read(key: string, maxBytes = 2_000_000) {
  return getObjectBytes(key, getStudioPrivateBucket(), { maxBytes, timeoutMs: 120_000 });
}
async function optional(key: string) {
  try { return await read(key); } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
async function immutable(key: string, bytes: Uint8Array, contentType = "application/json") {
  try { await putObject(key, bytes, { bucket: getStudioPrivateBucket(), contentType, ifNoneMatch: "*" }); }
  catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error; }
  const retained = await read(key, Math.max(bytes.length, 1));
  if (retained.length !== bytes.length || sha256BytesHex(retained) !== sha256BytesHex(bytes)) throw new Error("Immutable Engine source bytes changed");
}

function evidence(input: ReturnType<typeof createYuE2EngineRequest>, output: z.infer<typeof nativeOutput>, files: Record<string, Uint8Array>) {
  const req = parse(files["request.json"]), config = parse(files["config.json"]), result = parse(files["result.json"]);
  if (sha256BytesHex(files["score.abc"]) !== input.native.abcSha256 ||
      new TextDecoder("utf-8", { fatal: true }).decode(files["score.abc"]) !== input.native.abc ||
      req.style !== input.native.style || req.lyrics !== "" || req.abc !== input.native.abc || req.seed !== input.native.seed || req.cot !== "full" || req.cfg_scale !== 1 ||
      config.model_dtype !== "bfloat16" || config.vae_dtype !== "float32" || config.quantization !== "none" || config.backend !== "torch" ||
      config.cot !== "full" || config.cfg_scale !== 1 || config.decoder_release !== "standard" || config.vae_decode !== "halo_crop" || config.offload_ar !== false ||
      config.generation?.ode_steps !== 32 || config.generation?.ode_method !== "midpoint" || config.generation?.context !== 24576 ||
      result.status !== "complete" || result.sample_rate !== 48000 || result.truncated?.abc !== false || result.truncated?.semantic !== false ||
      !Number.isFinite(result.audio_seconds) || result.audio_seconds <= 0 || result.audio_seconds > 300) throw new Error("Engine source does not retain the accepted score or native model settings");
  const expectedSampling = { abc: { temperature: .7, top_p: .9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100, min_tokens: 32, max_tokens: 4096 },
    semantic: { temperature: 1, top_p: .95, top_k: 100, repetition_penalty: 1.2, penalty_window: 50, min_tokens: 200, max_tokens: 9000 } };
  if (canonicalJson(config.generation.abc) !== canonicalJson(expectedSampling.abc) ||
      canonicalJson(config.generation.semantic) !== canonicalJson(expectedSampling.semantic)) throw new Error("Engine source sampling drift");
  for (const descriptor of output.nativeArtifacts) {
    const body = files[descriptor.name];
    if (!body || body.length !== descriptor.bytes || sha256BytesHex(body) !== descriptor.sha256) throw new Error("Engine native sidecar changed");
    if (descriptor.name !== "result.json" && (result.artifacts?.[descriptor.name]?.sha256 !== descriptor.sha256 || result.artifacts?.[descriptor.name]?.bytes !== descriptor.bytes)) throw new Error("Engine native manifest changed");
  }
  const frames = Math.round(result.audio_seconds * 48000);
  if (Math.abs(frames / 48000 - result.audio_seconds) > 1e-9) throw new Error("Engine source has a non-integral native duration");
  return { frames, durationSec: frames / 48000, sampleRateHz: 48000 as const, channels: 2 as const, codec: "pcm_f32le" as const };
}

async function inspect(audio: Uint8Array, frames: number) {
  // Full bytes are hashed before reuse; the cache stores only technical meters,
  // not context-dependent musical approval or evidence of another source.
  const key = `${sha256BytesHex(audio)}:${frames}`;
  const cached = signalCache.get(key);
  if (cached) return structuredClone(await cached);
  const measure = async () => {
  const dir = await mkdtemp(join(tmpdir(), "yue2-engine-signal-"));
  try {
    const path = join(dir, "source.wav"); await writeFile(path, audio, { mode: 0o600 });
    await probeYuE2NativeWav(path, { frames }, audio.length);
    return await measureNativeAudioSignal({ path, sampleRateHz: 48000, channels: 2, expectedFrames: frames, measureTruePeak: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
  };
  if (signalCache.size >= 8) signalCache.delete(signalCache.keys().next().value!);
  const pending = measure(); signalCache.set(key, pending);
  try { return structuredClone(await pending); }
  catch (error) { if (signalCache.get(key) === pending) signalCache.delete(key); throw error; }
}
async function headroom(audio: Uint8Array, frames: number, jobId: string, evidenceSha256: string) {
  const before = await inspect(audio, frames);
  if (before.nonFiniteSamples || before.samplesAtOrAboveFullScale || before.truePeak?.status !== "measured" || before.truePeak.dbtp === null) {
    throw new Error("Engine native source needs finite, unclipped, measured true-peak evidence");
  }
  const gainDb = Math.min(0, Math.floor((-1.2 - before.truePeak.dbtp) * 1000) / 1000);
  if (gainDb === 0) return { audio, signal: before, receipt: null };
  const dir = await mkdtemp(join(tmpdir(), "yue2-engine-headroom-"));
  try {
    const path = join(dir, "source.wav"), target = join(dir, "headroom.wav"); await writeFile(path, audio, { mode: 0o600 });
    await execute(process.env.FFMPEG_BIN ?? "ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-n", "-i", path,
      "-map", "0:a:0", "-af", `volume=${gainDb}dB:precision=float`, "-c:a", "pcm_f32le", target], { timeout: 120_000, maxBuffer: 65536 });
    if ((await stat(target)).size > 115_500_000) throw new Error("Engine headroom source exceeds its bound");
    const prepared = await readFile(target), after = await inspect(prepared, frames);
    if (after.nonFiniteSamples || after.samplesAtOrAboveFullScale || after.truePeak?.status !== "measured" || after.truePeak.dbtp === null || after.truePeak.dbtp > -1) throw new Error("Engine source headroom preparation failed");
    return { audio: prepared, signal: after, receipt: headroomSchema.parse({ version: "studio-yue2-engine-headroom/v1", jobId,
      sourceSha256: sha256BytesHex(audio), evidenceSha256, audioSha256: sha256BytesHex(prepared), frames, gainDb,
      beforeDbtp: before.truePeak.dbtp, afterDbtp: after.truePeak.dbtp, ceilingDbtp: -1, method: "linear_attenuation_only", productionApproved: false }) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** One Engine admission and private immutable source; no legacy supervisor or direct-provider fallback. */
export async function executeYuE2EngineSource(arrangement: unknown, params: unknown, options: {
  client: StudioRenderEngineClient; authorize: () => Promise<void>; wait: (seconds: number, key: string) => Promise<void>;
}) {
  const input = createYuE2EngineRequest(arrangement, params), scope = input.request.acceptedArrangement, root = yuE2EngineRoot(scope);
  const binding = { version: "studio-yue2-engine-binding/v1", arrangement, params: input.config, native: input.native };
  const bindingBytes = json(binding), bindingSha256 = sha256BytesHex(bindingBytes);
  if (await optional(`owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/candidate.json`)) throw new Error("Run retains a legacy source; use a new run for Engine generation");
  await immutable(`${root}binding.json`, bindingBytes);
  const previous = await readYuE2EngineCandidate(scope);
  if (previous) return previous;
  const recoveryBytes = await optional(`${root}admission.json`);
  const recovery = recoveryBytes ? parse(recoveryBytes) as StudioEngineAudioRecovery : undefined;
  await immutable(`${root}submission-attempt.json`, json({ bindingSha256, key: input.native.idempotencyKey }));
  const result = await executeStudioEngineAudio({ model: "yue2", workflowId: workflow.workflowId, request: input.native }, {
    ...options, recovery, maxObservations: Math.ceil(input.config.maxExecutionSeconds / 30) + 2,
    onAccepted: async value => { await immutable(`${root}admission.json`, json(value)); },
  });
  let knownCostUsd: number | undefined;
  try {
    const expectedSha = sha256Hex(JSON.stringify(input.native));
    if (result.manifestSha256 !== expectedSha) throw new Error("Engine accepted a different scored source request");
    const status = await options.client.observeAudio({ jobId: result.jobId, state: "completed", manifestSha256: result.manifestSha256 }, "yue2", workflow.workflowId);
    const rawUsage = z.object({ gpuSeconds: z.number().finite().nonnegative(), costUsd: z.number().finite().nonnegative(), complete: z.boolean() }).parse(status.usage);
    knownCostUsd = rawUsage.costUsd;
    const usage = YuE2EngineUsageSchema.parse(rawUsage);
    if (usage.costUsd > input.config.maxCostUsd || status.status !== "completed" || status.outputRetired || canonicalJson(status.output) !== canonicalJson(result.output)) throw new Error("Engine source accounting or current completion requires reconciliation");
    const output = nativeOutput.parse(result.output);
    if (output.key !== `projects/${STUDIO_ENGINE_PROJECT}/jobs/${result.jobId}/audio.wav`) throw new Error("Engine source output belongs to a different job");
    const actual = evidence(input, output, result.nativeArtifactBytes);
    const provenance = provenanceSchema.parse({ version: "studio-yue2-engine-provenance/v1", jobId: result.jobId,
      requestSha256: result.manifestSha256, output, usage });
    const provenanceBytes = json(provenance), provenanceSha256 = sha256BytesHex(provenanceBytes);
    await options.authorize();
    await immutable(`${root}provenance.json`, provenanceBytes);
    for (const descriptor of output.nativeArtifacts) await immutable(`${root}native/${descriptor.name}`, result.nativeArtifactBytes[descriptor.name], descriptor.contentType);
    await immutable(`${root}audio-native-${output.sha256}.wav`, result.bytes, "audio/wav");
    const prepared = await headroom(result.bytes, actual.frames, result.jobId, provenanceSha256);
    let derivative;
    if (prepared.receipt) {
      const bytes = json(prepared.receipt), receiptSha256 = sha256BytesHex(bytes), audioSha256 = sha256BytesHex(prepared.audio);
      derivative = { audioKey: `${root}audio-headroom-${audioSha256}.wav`, audioSha256, audioBytes: prepared.audio.length,
        receiptKey: `${root}headroom-${receiptSha256}.json`, receiptSha256 };
      await immutable(derivative.audioKey, prepared.audio, "audio/wav"); await immutable(derivative.receiptKey, bytes);
    }
    const candidate = YuE2EngineCandidateSchema.parse({ version: "studio-yue2-engine-candidate/v1", ownerId: scope.ownerId, channelId: scope.channelId, runId: scope.runId,
      jobId: result.jobId, programFingerprint: scope.fingerprint, bindingKey: `${root}binding.json`, bindingSha256,
      provenanceKey: `${root}provenance.json`, provenanceSha256, audioKey: `${root}audio-native-${output.sha256}.wav`,
      audioSha256: output.sha256, audioBytes: output.bytes, nativeOutput: actual, ...(derivative ? { headroom: derivative } : {}),
      engine: { project: STUDIO_ENGINE_PROJECT, bucket: STUDIO_ENGINE_BUCKET, workflowId: workflow.workflowId, requestSha256: result.manifestSha256 },
      usage, nativeFormatVerified: true, qualified: false, productionApproved: false, manualAudition: "pending" });
    await options.authorize(); await immutable(`${root}candidate.json`, json(candidate));
    const retained = await readYuE2EngineCandidate(scope);
    if (!retained) throw new Error("Engine source candidate was not retained");
    return retained;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Engine source needs reconciliation");
    Object.assign(failure, { engineJobId: result.jobId, submissionMayExist: true, retryable: false,
      ...(knownCostUsd === undefined ? {} : { additionalObservedCostUsd: knownCostUsd }) });
    throw failure;
  }
}

/** Review-only reconstruction from immutable private evidence; never performs an Engine POST. */
export async function readYuE2EngineCandidate(scope: { ownerId: string; channelId: string; runId: string }) {
  const root = yuE2EngineRoot(scope), bytes = await optional(`${root}candidate.json`);
  if (!bytes) return null;
  const candidate = YuE2EngineCandidateSchema.parse(parse(bytes));
  if (candidate.ownerId !== scope.ownerId || candidate.channelId !== scope.channelId || candidate.runId !== scope.runId) throw new Error("Engine candidate owner changed");
  const bindingBytes = await read(candidate.bindingKey), proofBytes = await read(candidate.provenanceKey);
  if (sha256BytesHex(bindingBytes) !== candidate.bindingSha256 || sha256BytesHex(proofBytes) !== candidate.provenanceSha256) throw new Error("Engine source binding/provenance changed");
  const binding = z.object({ version: z.literal("studio-yue2-engine-binding/v1"), arrangement: z.unknown(), params: z.unknown(), native: z.unknown() }).strict().parse(parse(bindingBytes));
  const input = createYuE2EngineRequest(binding.arrangement, binding.params), proof = provenanceSchema.parse(parse(proofBytes));
  const accepted = input.request.acceptedArrangement;
  if (accepted.ownerId !== scope.ownerId || accepted.channelId !== scope.channelId || accepted.runId !== scope.runId ||
      canonicalJson(input.native) !== canonicalJson(binding.native) || accepted.fingerprint !== candidate.programFingerprint ||
      proof.jobId !== candidate.jobId || proof.requestSha256 !== candidate.engine.requestSha256 || proof.requestSha256 !== sha256Hex(JSON.stringify(input.native)) ||
      proof.output.key !== `projects/${STUDIO_ENGINE_PROJECT}/jobs/${candidate.jobId}/audio.wav` || proof.output.sha256 !== candidate.audioSha256 ||
      proof.output.bytes !== candidate.audioBytes || canonicalJson(proof.usage) !== canonicalJson(candidate.usage) || proof.usage.costUsd > input.config.maxCostUsd) throw new Error("Engine source immutable request or accounting changed");
  const files: Record<string, Uint8Array> = {};
  for (const descriptor of proof.output.nativeArtifacts) {
    if (!["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "result.json"].includes(descriptor.name) ||
        descriptor.key !== `projects/${STUDIO_ENGINE_PROJECT}/jobs/${candidate.jobId}/native/${descriptor.name}`) throw new Error("Engine native sidecar scope changed");
    files[descriptor.name] = await read(`${root}native/${descriptor.name}`, Math.min(descriptor.bytes, 64_000_000));
  }
  if (Object.keys(files).length !== 6 || canonicalJson(evidence(input, proof.output, files)) !== canonicalJson(candidate.nativeOutput)) throw new Error("Engine native source evidence changed");
  const audio = await read(candidate.audioKey, candidate.audioBytes);
  if (audio.length !== candidate.audioBytes || sha256BytesHex(audio) !== candidate.audioSha256) throw new Error("Engine raw float source changed");
  let signal = await inspect(audio, candidate.nativeOutput.frames);
  let listeningAudioKey = candidate.audioKey;
  if (candidate.headroom) {
    const ref = candidate.headroom;
    if (ref.audioKey !== `${root}audio-headroom-${ref.audioSha256}.wav` || ref.receiptKey !== `${root}headroom-${ref.receiptSha256}.json`) throw new Error("Engine headroom source scope changed");
    const recordBytes = await read(ref.receiptKey), prepared = await read(ref.audioKey, ref.audioBytes);
    if (sha256BytesHex(recordBytes) !== ref.receiptSha256 || prepared.length !== ref.audioBytes || sha256BytesHex(prepared) !== ref.audioSha256) throw new Error("Engine headroom bytes changed");
    const receipt = headroomSchema.parse(parse(recordBytes)), after = await inspect(prepared, candidate.nativeOutput.frames);
    if (receipt.jobId !== candidate.jobId || receipt.sourceSha256 !== candidate.audioSha256 || receipt.evidenceSha256 !== candidate.provenanceSha256 ||
        receipt.audioSha256 !== ref.audioSha256 || receipt.frames !== candidate.nativeOutput.frames ||
        signal.nonFiniteSamples || signal.samplesAtOrAboveFullScale || after.nonFiniteSamples || after.samplesAtOrAboveFullScale ||
        signal.truePeak?.status !== "measured" || after.truePeak?.status !== "measured" ||
        signal.truePeak?.dbtp !== receipt.beforeDbtp || after.truePeak?.dbtp !== receipt.afterDbtp || receipt.afterDbtp > -1 ||
        receipt.gainDb !== Math.min(0, Math.floor((-1.2 - receipt.beforeDbtp) * 1000) / 1000)) throw new Error("Engine headroom measurement identity changed");
    signal = after; listeningAudioKey = ref.audioKey;
  }
  const requestedDurationSec = input.request.acceptedArrangement.arrangement.requestedDurationSec, frames = candidate.nativeOutput.frames;
  const durationMatches = frames === requestedDurationSec * 48000, expectedNativeFrames = requestedDurationSec * 48000 - 64;
  const nativeDurationMatches = frames === expectedNativeFrames;
  const sourceDurationPolicy = input.request.job.schema_version === 2 ? input.request.job.source_duration_policy ?? "exact" : "exact";
  const naturalLoopDurationAccepted = sourceDurationPolicy === "natural_loop" && frames >= 10 * 48000 - 64 && frames <= 300 * 48000 - 64 && (frames + 64) % 1920 === 0;
  return { candidate, candidateSha256: sha256BytesHex(bytes), request: input.request, listeningAudioKey,
    quality: { status: (durationMatches || nativeDurationMatches || naturalLoopDurationAccepted) && !signal.reviewReasons.length ? "needs_audition" as const : "blocked" as const,
      requestedDurationSec, actualDurationSec: frames / 48000, durationMatches, nativeDurationMatches, expectedNativeFrames, sourceDurationPolicy,
      naturalLoopDurationAccepted, nativeFormatVerified: true as const, signal, productionApproved: false as const,
      unresolved: [...(!durationMatches ? ["exact_delivery_duration"] : []), "musical_quality", "instrumental_only", "production_approval"],
      ...(candidate.headroom ? { headroomPreparation: { method: "linear_attenuation_only", gainDb: headroomSchema.parse(parse(await read(candidate.headroom.receiptKey))).gainDb,
        sourceSha256: candidate.audioSha256, audioSha256: candidate.headroom.audioSha256 } } : {}) } };
}
