import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { sha256BytesHex } from "@/lib/sha256";
import type { RenderEngineYuE2Output, RenderEngineYuE2Request } from "@/lib/renderEngineYuE2StageClient";

const MAX_AUDIO_SECONDS = 300;
const MAX_WAV_BYTES = MAX_AUDIO_SECONDS * 48_000 * 2 * 4 + 4_096;
const FILES = ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "result.json"] as const;

const EngineCandidateSchema = z.object({
  version: z.literal("studio-yue2-render-engine-candidate/v1"),
  ownerId: z.string().min(1), channelId: z.string().min(1), runId: z.string().min(1),
  programFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  studioJobId: z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u),
  request: z.unknown(), requestManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
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

function inspectFloatWav(bytes: Uint8Array, maxAudioSeconds: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error("YuE2 Engine audio is not a bounded RIFF/WAVE file");
  }
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error("YuE2 Engine WAV container length does not match its object receipt");
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  let dataBytes: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength) throw new Error("YuE2 Engine WAV chunk exceeds the verified object");
    if (view.getUint32(offset, false) === 0x666d7420) {
      if (size < 16 || fmt) throw new Error("YuE2 Engine WAV format chunk is invalid");
      fmt = { format: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    } else if (view.getUint32(offset, false) === 0x64617461) {
      if (dataBytes !== undefined) throw new Error("YuE2 Engine WAV has multiple data chunks");
      dataBytes = size;
    }
    offset = start + size + (size % 2);
  }
  if (!fmt || dataBytes === undefined || fmt.format !== 3 || fmt.channels !== 2 || fmt.rate !== 48_000 || fmt.bits !== 32 || dataBytes % 8) {
    throw new Error("YuE2 Engine WAV is not stereo 48 kHz float32 PCM");
  }
  const frames = dataBytes / 8;
  const seconds = frames / 48_000;
  if (!frames || seconds > maxAudioSeconds || seconds > MAX_AUDIO_SECONDS) throw new Error("YuE2 Engine source duration exceeds its accepted bound");
  return frames;
}

async function fetchVerified(url: string, expected: { bytes: number; sha256: string; contentType: string }, headers: HeadersInit = {}, fetchImpl: typeof fetch = fetch) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || !/^[a-f0-9]{64}$/u.test(expected.sha256)) {
    throw new Error("Render Engine artifact descriptor is invalid");
  }
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
  if (outputBytes.byteLength > MAX_WAV_BYTES) throw new Error("Render Engine YuE2 WAV exceeds the 300-second transfer limit");
  const nativeFrames = inspectFloatWav(outputBytes, request.maxAudioSeconds);
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
  if (resultValue.version !== 2 || resultValue.state !== "uploaded" || resultValue.profileId !== "yue2" ||
      resultValue.manifestSha256 !== request.profileRevisionSha256 || resultValue.abcSha256 !== request.abcSha256 ||
      resultValue.requestSha256 !== requestSha256 ||
      resultValue.sampleFormat !== "float32" || resultValue.sampleRate !== 48_000 || resultValue.channels !== 2 ||
      resultValue.bitsPerSample !== 32 || resultValue.frames !== nativeFrames || resultValue.durationSeconds !== nativeFrames / 48_000) {
    throw new Error("Render Engine YuE2 native result receipt does not match the verified WAV and request");
  }
  await persistPreparedResult(audioKey, outputBytes, "audio/wav", { "render-engine-yue2-job": stage.jobId, "render-engine-yue2-sha256": readback.sha256 });
  const retainedAudio = await getObjectBytes(audioKey, undefined, { maxBytes: readback.bytes, timeoutMs: 300_000 });
  if (retainedAudio.byteLength !== readback.bytes || digest(retainedAudio) !== readback.sha256) throw new Error("Studio R2 audio does not match the verified Engine output");
  const candidateKey = `${root}candidate.json`;
  const candidate = EngineCandidateSchema.parse({
    version: "studio-yue2-render-engine-candidate/v1", ...scope, programFingerprint: input.programFingerprint,
    studioJobId: request.idempotencyKey, request, requestManifestSha256: stage.manifestSha256,
    engineJobId: stage.jobId, executionJobId: readback.executionJobId, profileRevisionSha256: request.profileRevisionSha256,
    output: { bucket: readback.bucket, key: readback.key, bytes: readback.bytes, sha256: readback.sha256, contentType: readback.contentType, verifiedAt: readback.verifiedAt },
    audioKey, audioSha256: readback.sha256, audioBytes: readback.bytes, nativeArtifacts: retainedSidecars,
    nativeFrames, allocation,
  });
  const candidateBytes = new TextEncoder().encode(canonicalJson(candidate));
  await persistPreparedResult(candidateKey, candidateBytes, "application/json", { "render-engine-yue2-candidate": candidate.version });
  const retainedCandidateBytes = await getObjectBytes(candidateKey, undefined, { maxBytes: 256_000, timeoutMs: 30_000 });
  if (retainedCandidateBytes.byteLength !== candidateBytes.byteLength || digest(retainedCandidateBytes) !== digest(candidateBytes)) {
    throw new Error("Studio R2 candidate receipt does not match the verified Engine completion");
  }
  return { candidateKey, candidateSha256: digest(candidateBytes), audioKey, audioSha256: readback.sha256,
    audioBytes: readback.bytes, nativeFrames, allocationCostUsd: allocation.costUsd };
}
