import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { sha256BytesHex } from "@/lib/sha256";
import { assertRenderEngineR2SignedUrl, type RenderEngineYuE2Output, type RenderEngineYuE2Request } from "@/lib/renderEngineYuE2StageClient";
import { RenderEngineYuE2RequestSchema } from "@/lib/renderEngineYuE2StageClient";
import { probeYuE2NativeWav } from "@/lib/yue2NativeAudio";
import { measureNativeAudioSignal } from "@/lib/nativeAudioSignal";
import { RENDER_ENGINE_STUDIO_PROJECT_NAME } from "@/lib/renderEngineStudioProject";

const MAX_AUDIO_SECONDS = 300;
const MAX_WAV_BYTES = MAX_AUDIO_SECONDS * 48_000 * 2 * 4 + 4_096;
const MAX_FLAC_BYTES = 87_000_000;
const FILES = ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "result.json"] as const;
const execFileP = promisify(execFile);

const EngineCandidateSchema = z.object({
  version: z.literal("studio-yue2-render-engine-candidate/v2"),
  ownerId: z.string().min(1), channelId: z.string().min(1), runId: z.string().min(1),
  programFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  studioJobId: z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u),
  request: z.unknown(), acceptedArrangement: z.unknown(), requestManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  engineJobId: z.string().regex(/^[a-z0-9]{32}$/u), executionJobId: z.string().regex(/^[a-z0-9]{32}$/u),
  profileRevisionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  output: z.object({ bucket: z.string().min(3), key: z.string().min(1), bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u), contentType: z.literal("audio/wav"), verifiedAt: z.number().int().positive() }).strict(),
  audioKey: z.string().min(1), audioSha256: z.string().regex(/^[a-f0-9]{64}$/u), audioBytes: z.number().int().positive(),
  nativeArtifacts: z.array(z.object({ name: z.enum(FILES), key: z.string().min(1), contentType: z.string().min(1),
    bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()).length(6),
  nativeFrames: z.number().int().positive(),
  allocation: z.object({ costUsd: z.number().finite().positive().max(1), gpuSeconds: z.number().int().positive(),
    costBasis: z.literal("engine-reservation-debit"), providerInvoiceVerified: z.literal(false) }).strict(),
}).strict();

type Scope = Readonly<{ ownerId: string; channelId: string; runId: string }>;
function digest(bytes: Uint8Array): string { return sha256BytesHex(bytes); }

/** Revalidates a retained Engine source for owner audition and later assembly; never approves it. */
export async function readRenderEngineYuE2Candidate(scope: Scope) {
  const root = `owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/`;
  let candidateBytes: Uint8Array;
  try { candidateBytes = await getObjectBytes(`${root}candidate.json`, undefined, { maxBytes: 256_000, timeoutMs: 30_000 }); }
  catch (error) {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (value?.name === "NoSuchKey" || (value?.name === "NotFound" && value.$metadata?.httpStatusCode === 404)) return null;
    throw error;
  }
  const candidate = EngineCandidateSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(candidateBytes)));
  const acceptedArrangement = AcceptedMusicArrangementSchema.parse(candidate.acceptedArrangement);
  const request = RenderEngineYuE2RequestSchema.parse(candidate.request);
  if (candidate.ownerId !== scope.ownerId || candidate.channelId !== scope.channelId || candidate.runId !== scope.runId ||
      canonicalJson(candidate) !== new TextDecoder("utf-8", { fatal: true }).decode(candidateBytes) ||
      candidate.audioKey !== `${root}audio-native-${candidate.audioSha256}.wav` || candidate.audioSha256 !== candidate.output.sha256 ||
      candidate.audioBytes !== candidate.output.bytes || candidate.programFingerprint !== acceptedArrangement.fingerprint ||
      acceptedArrangement.ownerId !== scope.ownerId || acceptedArrangement.channelId !== scope.channelId || acceptedArrangement.runId !== scope.runId ||
      candidate.studioJobId !== request.idempotencyKey || candidate.profileRevisionSha256 !== request.profileRevisionSha256 ||
      request.abc !== acceptedArrangement.symbolicScore || candidate.nativeFrames < 1 ||
      candidate.output.key !== `projects/${RENDER_ENGINE_STUDIO_PROJECT_NAME}/jobs/${candidate.executionJobId}/audio.wav` ||
      candidate.output.bucket === "render-engine" || candidate.allocation.costUsd > request.maxCostUsd) {
    throw new Error("Render Engine candidate scope, score, output or budget binding mismatch");
  }
  const audio = await getObjectBytes(candidate.audioKey, undefined, { maxBytes: candidate.audioBytes, timeoutMs: 120_000 });
  if (audio.byteLength !== candidate.audioBytes || digest(audio) !== candidate.audioSha256 ||
      inspectRenderEngineYuE2FloatWav(audio, request.maxAudioSeconds) !== candidate.nativeFrames) {
    throw new Error("Render Engine candidate audio digest or native WAV contract mismatch");
  }
  const sidecarHashes: Record<string, string> = {};
  let parsedRequest: unknown;
  let result: Record<string, unknown> | undefined;
  for (const artifact of candidate.nativeArtifacts) {
    if (artifact.key !== `${root}engine-native/${artifact.name}` || sidecarHashes[artifact.name]) {
      throw new Error("Render Engine sidecar escaped its private candidate namespace");
    }
    const bytes = await getObjectBytes(artifact.key, undefined, { maxBytes: artifact.bytes, timeoutMs: 30_000 });
    if (bytes.byteLength !== artifact.bytes || digest(bytes) !== artifact.sha256) throw new Error(`Render Engine sidecar changed: ${artifact.name}`);
    sidecarHashes[artifact.name] = artifact.sha256;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (artifact.name === "score.abc" && text !== request.abc) throw new Error("Render Engine retained score differs from the accepted arrangement");
    if (artifact.name === "request.json") parsedRequest = JSON.parse(text);
    if (artifact.name === "result.json") result = JSON.parse(text) as Record<string, unknown>;
  }
  const nativeHashes = result?.nativeArtifactHashes;
  if (Object.keys(sidecarHashes).length !== FILES.length || !parsedRequest || canonicalJson(parsedRequest) !== canonicalJson(request) ||
      digest(new TextEncoder().encode(JSON.stringify(parsedRequest))) !== candidate.requestManifestSha256 ||
      !nativeHashes || typeof nativeHashes !== "object" || Array.isArray(nativeHashes) ||
      result?.version !== 1 || result.state !== "uploaded" || result.profileId !== "yue2" ||
      result.manifestSha256 !== request.profileRevisionSha256 || result.format !== "wav" ||
      result.sampleRate !== 48_000 || result.channels !== 2 || result.bitsPerSample !== 32 ||
      result.frames !== candidate.nativeFrames || result.durationSeconds !== candidate.nativeFrames / 48_000 ||
      result.sha256 !== candidate.output.sha256 || result.bytes !== candidate.output.bytes || result.clippedSamples !== 0 ||
      ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "audio.wav"].some((name) =>
        (nativeHashes as Record<string, unknown>)[name] !== (name === "audio.wav" ? candidate.output.sha256 : sidecarHashes[name]))) {
    throw new Error("Render Engine native receipt does not close over the retained candidate");
  }
  const directory = await mkdtemp(join(tmpdir(), "studio-yue2-review-"));
  try {
    const path = join(directory, "candidate.wav");
    await writeFile(path, audio, { mode: 0o600, flag: "wx" });
    await probeYuE2NativeWav(path, { frames: candidate.nativeFrames }, audio.byteLength);
    const signal = await measureNativeAudioSignal({ path, sampleRateHz: 48_000, channels: 2,
      expectedFrames: candidate.nativeFrames, measureTruePeak: true });
    const arrangement = acceptedArrangement.arrangement;
    const actualDurationSec = candidate.nativeFrames / 48_000;
    const durationMatches = candidate.nativeFrames === arrangement.requestedDurationSec * 48_000;
    const naturalLoopDurationAccepted = arrangement.playback === "repeat" && actualDurationSec >= 10 &&
      actualDurationSec <= request.maxAudioSeconds;
    const candidateSha256 = digest(candidateBytes);
    return {
      candidate: {
        jobId: candidate.studioJobId, candidateSha256, audioKey: candidate.audioKey, audioSha256: candidate.audioSha256,
        headroom: undefined, nativeOutput: { sampleRateHz: 48_000 as const, channels: 2 as const,
          codec: "pcm_f32le" as const, frames: candidate.nativeFrames, durationSec: actualDurationSec },
        executionAccounting: { allocatedCostUsdMicros: Math.ceil(candidate.allocation.costUsd * 1_000_000), providerBilledCostUsdMicros: null },
      },
      candidateSha256, listeningAudioKey: candidate.audioKey,
      request: { acceptedArrangement },
      quality: {
        status: (durationMatches || naturalLoopDurationAccepted) && !signal.reviewReasons.length ? "needs_audition" as const : "blocked" as const,
        requestedDurationSec: arrangement.requestedDurationSec, actualDurationSec, durationMatches,
        nativeDurationMatches: durationMatches, expectedNativeFrames: arrangement.requestedDurationSec * 48_000,
        sourceDurationPolicy: arrangement.playback === "repeat" ? "natural_loop" as const : "exact" as const,
        naturalLoopDurationAccepted, nativeFormatVerified: true as const, signal, productionApproved: false as const,
        unresolved: [...(!durationMatches ? ["exact_delivery_duration"] : []), ...signal.reviewReasons,
          "perceptual_artifacts", "instrumental_only", "channel_personality_fit", "arrangement_fidelity", "repetition", "ending", "listening_quality"],
      },
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function inspectRenderEngineYuE2FloatWav(bytes: Uint8Array, maxAudioSeconds: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error("YuE2 Engine audio is not a bounded RIFF/WAVE file");
  }
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error("YuE2 Engine WAV container length does not match its object receipt");
  let offset = 12;
  let fmt: { isFloat: boolean; channels: number; rate: number; bits: number } | undefined;
  let dataBytes: number | undefined;
  let dataOffset: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength) throw new Error("YuE2 Engine WAV chunk exceeds the verified object");
    if (view.getUint32(offset, false) === 0x666d7420) {
      if (size < 16 || fmt) throw new Error("YuE2 Engine WAV format chunk is invalid");
      const format = view.getUint16(start, true);
      const extensibleFloat = format === 0xfffe && size >= 40 && view.getUint16(start + 16, true) >= 22 &&
        view.getUint16(start + 18, true) === 32 && view.getUint32(start + 20, true) === 3 &&
        view.getUint32(start + 24, true) === 3 &&
        [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113].every((byte, index) => bytes[start + 28 + index] === byte);
      fmt = { isFloat: format === 3 || extensibleFloat, channels: view.getUint16(start + 2, true),
        rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    } else if (view.getUint32(offset, false) === 0x64617461) {
      if (dataBytes !== undefined) throw new Error("YuE2 Engine WAV has multiple data chunks");
      dataBytes = size;
      dataOffset = start;
    }
    offset = start + size + (size % 2);
  }
  if (offset !== bytes.byteLength || !fmt || dataBytes === undefined || dataOffset === undefined || !fmt.isFloat ||
      fmt.channels !== 2 || fmt.rate !== 48_000 || fmt.bits !== 32 || dataBytes % 8) {
    throw new Error("YuE2 Engine WAV is not stereo 48 kHz float32 PCM");
  }
  const frames = dataBytes / 8;
  const seconds = frames / 48_000;
  if (!frames || seconds > maxAudioSeconds || seconds > MAX_AUDIO_SECONDS) throw new Error("YuE2 Engine source duration exceeds its accepted bound");
  let peak = 0;
  for (let sample = dataOffset; sample < dataOffset + dataBytes; sample += 4) {
    const value = view.getFloat32(sample, true);
    if (!Number.isFinite(value) || Math.abs(value) >= 1) throw new Error("YuE2 Engine WAV has clipped or non-finite samples");
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak === 0) throw new Error("YuE2 Engine WAV is silent");
  return frames;
}

export function inspectRenderEngineYuE2Flac(bytes: Uint8Array, maxAudioSeconds: number): number {
  if (bytes.byteLength < 42 || bytes.byteLength > MAX_FLAC_BYTES ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== "fLaC") throw new Error("Render Engine YuE2 output is not bounded FLAC");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 4, streamInfo: number | undefined, last = false;
  while (!last) {
    if (offset + 4 > bytes.byteLength) throw new Error("Render Engine YuE2 FLAC metadata is truncated");
    const type = bytes[offset]! & 0x7f;
    last = (bytes[offset]! & 0x80) !== 0;
    const size = (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    offset += 4;
    if (offset + size > bytes.byteLength) throw new Error("Render Engine YuE2 FLAC metadata exceeds its receipt");
    if (type === 0) {
      if (streamInfo !== undefined || size !== 34) throw new Error("Render Engine YuE2 FLAC stream info is invalid");
      streamInfo = offset;
    }
    offset += size;
  }
  if (streamInfo === undefined || offset >= bytes.byteLength) throw new Error("Render Engine YuE2 FLAC has no audio frames");
  const high = view.getUint32(streamInfo + 10, false);
  const sampleRate = high >>> 12, channels = ((high >>> 9) & 7) + 1;
  const bits = ((high >>> 4) & 31) + 1;
  const frames = (high & 15) * 0x1_0000_0000 + view.getUint32(streamInfo + 14, false);
  if (sampleRate !== 48_000 || channels !== 2 || bits !== 24 || frames < 1 || frames / sampleRate > maxAudioSeconds) {
    throw new Error("Render Engine YuE2 FLAC is outside the pinned 48 kHz stereo 24-bit contract");
  }
  return frames;
}

export async function decodeRenderEngineYuE2Flac(bytes: Uint8Array, expectedFrames: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "studio-yue2-engine-"));
  const sourcePath = join(directory, "source.flac"), outputPath = join(directory, "audio.wav");
  try {
    await writeFile(sourcePath, bytes, { mode: 0o600, flag: "wx" });
    await execFileP(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", sourcePath,
      "-map", "0:a:0", "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-f", "wav", outputPath],
    { timeout: 120_000, maxBuffer: 1024 * 1024 });
    const wav = new Uint8Array(await readFile(outputPath));
    if (wav.byteLength > MAX_WAV_BYTES || inspectRenderEngineYuE2FloatWav(wav, MAX_AUDIO_SECONDS) !== expectedFrames) {
      throw new Error("Decoded YuE2 PCM frame count does not match the verified FLAC source");
    }
    return wav;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function fetchVerified(url: string, expected: { bytes: number; sha256: string; contentType: string }, headers: HeadersInit = {}, fetchImpl: typeof fetch = fetch) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || !/^[a-f0-9]{64}$/u.test(expected.sha256)) {
    throw new Error("Render Engine artifact descriptor is invalid");
  }
  assertRenderEngineR2SignedUrl(url);
  const response = await fetchImpl(url, { redirect: "error", headers: { accept: expected.contentType, ...headers }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== expected.contentType.toLowerCase() ||
      Number(response.headers.get("content-length")) !== expected.bytes) throw new Error("Render Engine signed artifact response does not match its receipt");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expected.bytes || digest(bytes) !== expected.sha256) throw new Error("Render Engine artifact bytes do not match its receipt");
  return bytes;
}

function allocationFromStatus(status: Record<string, unknown>, maxCostUsd: number) {
  const value = status.allocationUsage;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Render Engine YuE2 allocation receipt is missing");
  const usage = value as Record<string, unknown>;
  if (usage.complete !== true || usage.costBasis !== "engine-reservation-debit" || usage.providerInvoiceVerified !== false ||
      typeof usage.costUsd !== "number" || !Number.isFinite(usage.costUsd) || usage.costUsd <= 0 || usage.costUsd > maxCostUsd ||
      typeof usage.gpuSeconds !== "number" || !Number.isSafeInteger(usage.gpuSeconds) || usage.gpuSeconds < 1) {
    throw new Error("Render Engine YuE2 allocation is incomplete or outside the reserved cost");
  }
  return { costUsd: usage.costUsd, gpuSeconds: usage.gpuSeconds, costBasis: "engine-reservation-debit" as const, providerInvoiceVerified: false as const };
}

export async function materializeRenderEngineYuE2Candidate(input: {
  scope: Scope;
  programFingerprint: string;
  acceptedArrangement: unknown;
  request: RenderEngineYuE2Request;
  stage: { jobId: string; manifestSha256: string; output: { bucket: string; key: string; receiptKey: string } };
  status: Record<string, unknown>;
  readback: RenderEngineYuE2Output;
  projectName: string;
  fetchImpl?: typeof fetch;
}): Promise<Readonly<{ candidateKey: string; candidateSha256: string; audioKey: string; audioSha256: string; audioBytes: number; nativeFrames: number; allocationCostUsd: number }>> {
  const { scope, request, stage, status, readback } = input;
  const safeScope = [scope.ownerId, scope.channelId, scope.runId].every((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value));
  if (!safeScope || status.jobId !== stage.jobId || status.executionJobId !== readback.executionJobId ||
      status.profileId !== "yue2" || status.status !== "completed" || status.outputRetired !== false ||
      status.requestSha256 !== stage.manifestSha256 || status.executionRequestSha256 !== stage.manifestSha256 ||
      !status.output || typeof status.output !== "object" || Array.isArray(status.output)) {
    throw new Error("Render Engine completion is not bound to the staged YuE2 project job");
  }
  const statusOutput = status.output as Record<string, unknown>;
  if (statusOutput.bucket !== readback.bucket || statusOutput.key !== readback.key || statusOutput.bytes !== readback.bytes ||
      statusOutput.sha256 !== readback.sha256 || statusOutput.contentType !== readback.contentType ||
      statusOutput.verifiedAt !== readback.verifiedAt || readback.key !== `projects/${input.projectName}/jobs/${readback.executionJobId}/audio.wav` ||
      readback.bucket === "render-engine" || stage.output.bucket !== readback.bucket ||
      stage.output.key !== `projects/${input.projectName}/jobs/${stage.jobId}/audio.wav` ||
      stage.output.receiptKey !== `projects/${input.projectName}/jobs/${stage.jobId}/yue2.receipt.json`) {
    throw new Error("Render Engine YuE2 output, stage and status receipts disagree");
  }
  const allocation = allocationFromStatus(status, request.maxCostUsd);
  const outputBytes = await fetchVerified(readback.url, { bytes: readback.bytes, sha256: readback.sha256, contentType: "audio/wav" }, {}, input.fetchImpl);
  const nativeFrames = inspectRenderEngineYuE2FloatWav(outputBytes, request.maxAudioSeconds);
  const root = `owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/`;
  const audioKey = `${root}audio-native-${readback.sha256}.wav`;
  const retainedSidecars: Array<{ name: typeof FILES[number]; key: string; contentType: string; bytes: number; sha256: string }> = [];
  let requestBytes: Uint8Array | undefined;
  let resultValue: Record<string, unknown> | undefined;
  for (const sidecar of readback.nativeArtifactReads) {
    if (!FILES.includes(sidecar.name as typeof FILES[number])) throw new Error("Render Engine YuE2 returned an unsupported native sidecar");
    const bytes = await fetchVerified(sidecar.url, sidecar, sidecar.readHeaders, input.fetchImpl);
    const targetKey = `${root}engine-native/${sidecar.name}`;
    await persistPreparedResult(targetKey, bytes, sidecar.contentType, { "render-engine-yue2-sidecar": sidecar.name, "render-engine-job": stage.jobId });
    const retained = await getObjectBytes(targetKey, undefined, { maxBytes: sidecar.bytes, timeoutMs: 120_000 });
    if (retained.byteLength !== sidecar.bytes || digest(retained) !== sidecar.sha256) throw new Error(`Studio R2 retained YuE2 sidecar changed: ${sidecar.name}`);
    if (sidecar.name === "score.abc" && new TextDecoder("utf-8", { fatal: true }).decode(retained) !== request.abc) {
      throw new Error("Render Engine YuE2 score sidecar differs from the accepted arrangement");
    }
    if (sidecar.name === "request.json") requestBytes = retained;
    if (sidecar.name === "result.json") {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Render Engine YuE2 native result receipt is invalid");
      resultValue = parsed as Record<string, unknown>;
    }
    retainedSidecars.push({ name: sidecar.name as typeof FILES[number], key: targetKey, contentType: sidecar.contentType, bytes: sidecar.bytes, sha256: sidecar.sha256 });
  }
  if (!requestBytes || !resultValue) throw new Error("Render Engine YuE2 native request/result sidecars are missing");
  const parsedRequest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(requestBytes));
  if (canonicalJson(parsedRequest) !== canonicalJson(request)) throw new Error("Render Engine YuE2 native request sidecar changed");
  const nativeHashes = resultValue.nativeArtifactHashes;
  const sidecarHashes = Object.fromEntries(retainedSidecars.map((artifact) => [artifact.name, artifact.sha256]));
  if (!nativeHashes || typeof nativeHashes !== "object" || Array.isArray(nativeHashes) ||
      (nativeHashes as Record<string, unknown>)["audio.wav"] !== readback.sha256 ||
      ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json"].some((name) =>
        (nativeHashes as Record<string, unknown>)[name] !== sidecarHashes[name])) {
    throw new Error("Render Engine YuE2 native sidecar hashes do not close over the accepted request and audio");
  }
  const requestSha256 = digest(new TextEncoder().encode(JSON.stringify(parsedRequest)));
  if (digest(requestBytes) !== requestSha256) throw new Error("Render Engine YuE2 request sidecar is not the exact serialized request");
  const truncated = resultValue.truncated;
  if (resultValue.version !== 1 || resultValue.state !== "uploaded" || resultValue.profileId !== "yue2" ||
      resultValue.manifestSha256 !== request.profileRevisionSha256 || resultValue.requestSha256 !== requestSha256 ||
      resultValue.format !== "wav" || resultValue.sampleRate !== 48_000 || resultValue.channels !== 2 ||
      resultValue.bitsPerSample !== 32 || resultValue.frames !== nativeFrames || resultValue.durationSeconds !== nativeFrames / 48_000 ||
      resultValue.sha256 !== readback.sha256 || resultValue.bytes !== readback.bytes || resultValue.clippedSamples !== 0 ||
      !truncated || typeof truncated !== "object" || Array.isArray(truncated) ||
      (truncated as Record<string, unknown>).abc !== false || (truncated as Record<string, unknown>).semantic !== false) {
    throw new Error("Render Engine YuE2 native result receipt does not match the verified float WAV and request");
  }
  const wavBytes = outputBytes;
  const audioSha256 = digest(wavBytes);
  await persistPreparedResult(audioKey, wavBytes, "audio/wav", { "render-engine-yue2-job": stage.jobId,
    "render-engine-yue2-source-sha256": readback.sha256, "render-engine-yue2-sha256": audioSha256 });
  const retainedAudio = await getObjectBytes(audioKey, undefined, { maxBytes: wavBytes.byteLength, timeoutMs: 300_000 });
  if (retainedAudio.byteLength !== wavBytes.byteLength || digest(retainedAudio) !== audioSha256) throw new Error("Studio R2 decoded audio changed after retention");
  const candidateKey = `${root}candidate.json`;
  const acceptedArrangement = AcceptedMusicArrangementSchema.parse(input.acceptedArrangement);
  if (acceptedArrangement.fingerprint !== input.programFingerprint || acceptedArrangement.ownerId !== scope.ownerId ||
      acceptedArrangement.channelId !== scope.channelId || acceptedArrangement.runId !== scope.runId ||
      acceptedArrangement.symbolicScore !== request.abc) {
    throw new Error("Render Engine candidate does not match the exact accepted arrangement and score");
  }
  const candidate = EngineCandidateSchema.parse({
    version: "studio-yue2-render-engine-candidate/v2", ...scope, programFingerprint: input.programFingerprint,
    studioJobId: request.idempotencyKey, request, acceptedArrangement, requestManifestSha256: stage.manifestSha256,
    engineJobId: stage.jobId, executionJobId: readback.executionJobId, profileRevisionSha256: request.profileRevisionSha256,
    output: { bucket: readback.bucket, key: readback.key, bytes: readback.bytes, sha256: readback.sha256, contentType: readback.contentType, verifiedAt: readback.verifiedAt },
    audioKey, audioSha256, audioBytes: wavBytes.byteLength, nativeArtifacts: retainedSidecars,
    nativeFrames, allocation,
  });
  const candidateBytes = new TextEncoder().encode(canonicalJson(candidate));
  await persistPreparedResult(candidateKey, candidateBytes, "application/json", { "render-engine-yue2-candidate": candidate.version });
  const retainedCandidateBytes = await getObjectBytes(candidateKey, undefined, { maxBytes: 256_000, timeoutMs: 30_000 });
  if (retainedCandidateBytes.byteLength !== candidateBytes.byteLength || digest(retainedCandidateBytes) !== digest(candidateBytes)) {
    throw new Error("Studio R2 candidate receipt does not match the verified Engine completion");
  }
  return { candidateKey, candidateSha256: digest(candidateBytes), audioKey, audioSha256,
    audioBytes: wavBytes.byteLength, nativeFrames, allocationCostUsd: allocation.costUsd };
}
