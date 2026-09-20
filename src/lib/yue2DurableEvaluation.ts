import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { getObjectBytes, putObject } from "@/lib/storage";
import { probeYuE2NativeWav } from "@/lib/yue2NativeAudio";
import {
  validateYuE2Endpoint, validateYuE2EvaluationRequest, verifyYuE2Audio, verifyYuE2Completion,
  yue2Sha256, YUE2_ARRANGEMENT_EVALUATION_VERSION, YUE2_QUALIFICATION,
  YuE2EvaluationClient, YuE2EvaluationError,
  type YuE2AcceptedArrangementRequest, type YuE2VerifiedCompletion,
} from "@/lib/yue2Evaluation";

export const YUE2_DURABLE_EVALUATION_VERSION = "studio-yue2-durable-evaluation/v1" as const;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

export const YuE2DurableCandidateSchema = z.object({
  version: z.literal("studio-yue2-durable-candidate/v1"),
  ownerId: safeId, channelId: safeId, runId: safeId,
  jobId: z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u),
  programFingerprint: hash, requestSha256: hash,
  bindingKey: z.string(), bindingSha256: hash,
  provenanceKey: z.string(), provenanceSha256: hash,
  audioKey: z.string(), audioSha256: hash, audioBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  nativeOutput: z.object({
    sampleRateHz: z.literal(48000), channels: z.literal(2), codec: z.literal("pcm_f32le"),
    frames: z.number().int().positive(), durationSec: z.number().finite().positive(),
  }).strict(),
  nativeFormatVerified: z.literal(true), qualified: z.literal(false), productionApproved: z.literal(false),
  manualAudition: z.literal("pending"), costStatus: z.literal("not_measured"),
  qualification: z.object({
    quality: z.literal("unqualified"), rtx3090: z.literal("unqualified"), exact_duration: z.literal("unqualified"),
    instrumental_only: z.literal("unqualified"), production_approved: z.literal(false),
  }).strict(),
}).strict();
export type YuE2DurableCandidate = z.infer<typeof YuE2DurableCandidateSchema>;

export type YuE2DurableEvaluationInput = {
  request: unknown;
  endpoint: string;
  bearerToken: string;
  recoverOnly?: boolean;
  authorizeSubmission: () => Promise<void>;
};
export type YuE2DurableEvaluationOutcome =
  | { status: "pending"; jobId: string; reused: boolean; bindingKey: string; workerStatus: string }
  | { status: "completed"; jobId: string; reused: boolean; candidateKey: string; audioKey: string; candidate: YuE2DurableCandidate };

/** Pure validation, safe to call before secret/bootstrap or storage initialization. */
export function validateDurableYuE2Evaluation(input: YuE2DurableEvaluationInput): {
  request: YuE2AcceptedArrangementRequest; endpoint: string;
} {
  const request = validateYuE2EvaluationRequest(input.request);
  if (request.version !== YUE2_ARRANGEMENT_EVALUATION_VERSION) throw new YuE2EvaluationError("accepted_arrangement_required");
  const { ownerId, channelId, runId } = request.acceptedArrangement;
  [ownerId, channelId, runId].forEach((id) => safeId.parse(id));
  if (input.recoverOnly !== undefined && typeof input.recoverOnly !== "boolean") throw new YuE2EvaluationError("invalid_recovery_mode");
  if (!input.recoverOnly && typeof input.authorizeSubmission !== "function") throw new YuE2EvaluationError("submission_authority_required");
  const endpoint = validateYuE2Endpoint(input.endpoint);
  // Construction validates bearer syntax and limits but performs no I/O.
  new YuE2EvaluationClient({ endpoint, bearerToken: input.bearerToken });
  return { request, endpoint };
}

function jsonBytes(value: unknown): Buffer {
  const bytes = Buffer.from(canonicalJson(value));
  if (bytes.length > MAX_JSON_BYTES) throw new YuE2EvaluationError("durable_json_limit");
  return bytes;
}
function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function missing(error: unknown): boolean {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return value?.name === "NoSuchKey" || (value?.name === "NotFound" && value.$metadata?.httpStatusCode === 404);
}
function conflict(error: unknown): boolean {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return value?.name === "PreconditionFailed" || value?.name === "ConditionalRequestConflict" ||
    value?.$metadata?.httpStatusCode === 409 || value?.$metadata?.httpStatusCode === 412;
}
async function read(key: string, maximum = MAX_JSON_BYTES): Promise<Uint8Array> {
  const bytes = await getObjectBytes(key, undefined, { timeoutMs: 30_000, maxBytes: maximum });
  if (bytes.byteLength > maximum) throw new YuE2EvaluationError("durable_object_limit");
  return bytes;
}
async function optionalRead(key: string): Promise<Uint8Array | undefined> {
  try { return await read(key); } catch (error) { if (missing(error)) return undefined; throw error; }
}
function assertBytes(actual: Uint8Array, expected: Uint8Array): void {
  if (actual.byteLength !== expected.byteLength || yue2Sha256(actual) !== yue2Sha256(expected)) {
    throw new YuE2EvaluationError("durable_identity_mismatch");
  }
}
/** Bounds this waiter only; an SDK write may still commit after timeout. */
async function boundedPut(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new YuE2EvaluationError("durable_write_timeout")), 30_000);
    void Promise.resolve().then(() => putObject(key, bytes, { contentType, ifNoneMatch: "*" })).then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
/** A failed/ambiguous PUT is never permission to submit; only explicit conflicts may be compared. */
async function immutable(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  let created = true;
  try { await boundedPut(key, bytes, contentType); }
  catch (error) { if (!conflict(error)) throw error; created = false; }
  assertBytes(await read(key, contentType === "audio/wav" ? MAX_AUDIO_BYTES : MAX_JSON_BYTES), bytes);
  return created;
}

async function probeAudio(audio: Uint8Array, completion: YuE2VerifiedCompletion): Promise<void> {
  verifyYuE2Audio(completion, audio);
  const directory = await mkdtemp(join(tmpdir(), "yue2-durable-native-"));
  try {
    const path = join(directory, "audio-native.wav");
    await writeFile(path, audio, { mode: 0o600, flag: "wx" });
    await probeYuE2NativeWav(path, completion.result, audio.byteLength);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Evaluation-only durable execution. Unknown cost and owner audition never imply approval. */
export async function executeDurableYuE2Evaluation(input: YuE2DurableEvaluationInput): Promise<YuE2DurableEvaluationOutcome> {
  let jobId: string | undefined;
  try {
    const { request, endpoint } = validateDurableYuE2Evaluation(input);
    jobId = request.job.job_id;
    const { ownerId, channelId, runId } = request.acceptedArrangement;
    const client = new YuE2EvaluationClient({ endpoint, bearerToken: input.bearerToken, maxResponseBytes: 4 * 1024 * 1024 });
    const root = `owner/${ownerId}/runs/${runId}/music/yue2-evaluation/`;
    const bindingKey = `${root}binding.json`;
    const markerKey = `${root}submission-attempt.json`;
    const provenanceKey = `${root}provenance.json`;
    const candidateKey = `${root}candidate.json`;
    const bindingBytes = jsonBytes({ version: YUE2_DURABLE_EVALUATION_VERSION, ownerId, channelId, runId, endpoint, request });
    const bindingSha256 = yue2Sha256(bindingBytes);
    const binding = await optionalRead(bindingKey);
    if (binding) assertBytes(binding, bindingBytes);
    else {
      if (input.recoverOnly) throw new YuE2EvaluationError("durable_binding_missing");
      await input.authorizeSubmission();
      await immutable(bindingKey, bindingBytes, "application/json");
    }
    const markerBytes = jsonBytes({ version: YUE2_DURABLE_EVALUATION_VERSION, bindingSha256, jobId, recovery: "same_job_get_only" });
    const marker = await optionalRead(markerKey);
    if (marker) assertBytes(marker, markerBytes);
    let markerPersisted = marker !== undefined;
    const candidateBytes = await optionalRead(candidateKey);
    const savedProvenance = await optionalRead(provenanceKey);

    const provenanceCompletion = (bytes: Uint8Array) => {
      const saved = z.object({ version: z.literal("studio-yue2-provenance/v1"), bindingSha256: z.literal(bindingSha256),
        request: z.unknown(), statusResponse: z.unknown() }).strict().parse(parseJson(bytes));
      if (canonicalJson(saved.request) !== canonicalJson(request)) throw new YuE2EvaluationError("durable_provenance_request_mismatch");
      return verifyYuE2Completion(request, saved.statusResponse);
    };
    const makeCandidate = (completion: YuE2VerifiedCompletion, provenance: Uint8Array) => YuE2DurableCandidateSchema.parse({
      version: "studio-yue2-durable-candidate/v1", ownerId, channelId, runId, jobId,
      programFingerprint: request.programFingerprint, requestSha256: yue2Sha256(jsonBytes(request)),
      bindingKey, bindingSha256, provenanceKey, provenanceSha256: yue2Sha256(provenance),
      audioKey: `${root}audio-native-${completion.audio.sha256}.wav`, audioSha256: completion.audio.sha256, audioBytes: completion.audio.bytes,
      nativeOutput: { sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames: completion.result.frames, durationSec: completion.result.audio_seconds },
      nativeFormatVerified: true, qualified: false, productionApproved: false, manualAudition: "pending", costStatus: "not_measured",
      qualification: YUE2_QUALIFICATION,
    });
    if (savedProvenance) {
      const completion = provenanceCompletion(savedProvenance);
      const candidate = makeCandidate(completion, savedProvenance);
      if (candidateBytes) {
        YuE2DurableCandidateSchema.parse(parseJson(candidateBytes));
        assertBytes(candidateBytes, jsonBytes(candidate));
      }
      let audio: Uint8Array | undefined;
      try { audio = await read(candidate.audioKey, MAX_AUDIO_BYTES); }
      catch (error) { if (candidateBytes || !missing(error)) throw error; }
      if (audio) {
        await probeAudio(audio, completion);
        if (!candidateBytes) await immutable(candidateKey, jsonBytes(candidate), "application/json");
        return { status: "completed", jobId, reused: true, candidateKey, audioKey: candidate.audioKey, candidate };
      }
    } else if (candidateBytes) throw new YuE2EvaluationError("durable_candidate_missing_provenance");

    const afterJobObserved = async () => {
      if (markerPersisted) return;
      // Observing this exact job permanently removes submission permission,
      // even if terminal receipts or the subsequent audio download are bad.
      await immutable(markerKey, markerBytes, "application/json");
      markerPersisted = true;
    };
    let outcome;
    try {
      outcome = await client.evaluate(request, {
        submit: !input.recoverOnly, recoverOnly: input.recoverOnly === true || marker !== undefined || savedProvenance !== undefined,
        afterJobObserved,
        beforeSubmit: async () => {
          if (input.recoverOnly) return false;
          await input.authorizeSubmission();
          const won = await immutable(markerKey, markerBytes, "application/json");
          markerPersisted = true;
          if (!won) return false;
          await input.authorizeSubmission();
          return true;
        },
      });
    } catch (error) {
      if (!(error instanceof YuE2EvaluationError) || error.code !== "submission_already_reserved") throw error;
      outcome = await client.evaluate(request, { recoverOnly: true, afterJobObserved });
    }
    if (outcome.status === "pending") return { status: "pending", jobId, reused: marker !== undefined, bindingKey, workerStatus: outcome.workerStatus };
    await probeAudio(outcome.audio, outcome.completion);
    const provenance = jsonBytes({ version: "studio-yue2-provenance/v1", bindingSha256, request, statusResponse: outcome.completion.statusResponse });
    const candidate = makeCandidate(outcome.completion, provenance);
    await immutable(provenanceKey, provenance, "application/json");
    await immutable(candidate.audioKey, outcome.audio, "audio/wav");
    await immutable(candidateKey, jsonBytes(candidate), "application/json");
    return { status: "completed", jobId, reused: false, candidateKey, audioKey: candidate.audioKey, candidate };
  } catch (error) {
    if (error instanceof YuE2EvaluationError && error.jobId === jobId) throw error;
    throw new YuE2EvaluationError(error instanceof YuE2EvaluationError ? error.code : "durable_validation_or_transport_failed", jobId);
  }
}
