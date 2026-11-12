import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { preparedObjectAbsent } from "@/lib/preparedMediaStorage";
import { getObjectBytes, putObject } from "@/lib/storage";
import { recordModelUsage } from "@/lib/modelUsage";
import { QWEN3_TTS_LANGUAGES, QWEN3_TTS_SPEAKERS, type QwenTtsLanguage, type QwenTtsSpeaker } from "@/lib/qwenTts";
import { configuredHyperYoutubeStageClient, type HyperYoutubeEnvironment, type HyperYoutubeJob } from "@/lib/hyperYoutubeStageClient";

export const HRS_QWEN_TTS_RECEIPT_SCHEMA = "hrs-qwen3-tts-receipt/v1" as const;
export interface HrsQwenTtsReceipt {
  schema: typeof HRS_QWEN_TTS_RECEIPT_SCHEMA;
  route: "hyper-render-service";
  modelId: "qwen3-tts";
  projectId: string;
  jobId: string;
  generation: number;
  environmentId: string;
  environmentSha256: string;
  idempotencyKey: string;
  requestSha256: string;
  textSha256: string;
  instructionSha256: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  seed: number;
  audioSha256: string;
  audioFormat: "wav";
  byteLength: number;
  contentType: "audio/wav";
  output: { bucket: string; key: string; sha256: string; bytes: number; contentType: "audio/wav" };
  costStatus: "unreported";
}

type StageClient = ReturnType<typeof configuredHyperYoutubeStageClient>;
type StoredJson = { get: typeof getObjectBytes; put: typeof putObject };
type Checkpoint = {
  schema: "hrs-qwen3-tts-checkpoint/v1";
  projectId: string;
  idempotencyKey: string;
  requestSha256: string;
  environment: HyperYoutubeEnvironment;
  jobId?: string;
};
type EnvironmentCheckpoint = { schema: "hrs-qwen3-tts-environment/v1"; projectId: string; scopeSha256: string; environment: HyperYoutubeEnvironment };

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function readJson<T>(key: string, storage: StoredJson): Promise<T | null> {
  try {
    const bytes = await storage.get(key, undefined, { maxBytes: 64_000 });
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  } catch (error) {
    if (preparedObjectAbsent(error)) return null;
    throw error;
  }
}

async function createOrReadJson<T>(key: string, value: T, storage: StoredJson): Promise<T> {
  const bytes = Buffer.from(canonicalJson(value));
  try {
    await storage.put(key, bytes, { contentType: "application/json", ifNoneMatch: "*" });
    return value;
  } catch (error) {
    const existing = await readJson<T>(key, storage).catch(() => null);
    if (existing) return existing;
    throw error;
  }
}

function assertCheckpoint(value: unknown, expected: Pick<Checkpoint, "projectId" | "idempotencyKey" | "requestSha256">): Checkpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid HRS Qwen checkpoint");
  const raw = value as Record<string, unknown>;
  const environment = raw.environment as Record<string, unknown> | undefined;
  if (raw.schema !== "hrs-qwen3-tts-checkpoint/v1" || raw.projectId !== expected.projectId ||
    raw.idempotencyKey !== expected.idempotencyKey || raw.requestSha256 !== expected.requestSha256 ||
    !environment || typeof environment !== "object" || environment.modelId !== "qwen3-tts" ||
    typeof environment.id !== "string" || !uuid.test(environment.id) ||
    typeof environment.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(environment.sha256) ||
    (raw.jobId !== undefined && (typeof raw.jobId !== "string" || !uuid.test(raw.jobId)))) {
    throw new Error("HRS Qwen checkpoint does not match this immutable segment request");
  }
  return value as Checkpoint;
}

export async function prepareHrsQwenTtsEnvironment(input: {
  scope: Record<string, string | number>;
  authorize: () => Promise<void>;
  client?: StageClient;
  storage?: StoredJson;
}): Promise<HyperYoutubeEnvironment> {
  const client = input.client ?? configuredHyperYoutubeStageClient();
  const storage = input.storage ?? { get: getObjectBytes, put: putObject };
  const binding = await client.binding();
  const scopeSha256 = sha256(canonicalJson(input.scope));
  const key = `youtube-hrs/qwen3/environments/${scopeSha256}.json`;
  let checkpoint = await readJson<unknown>(key, storage) as EnvironmentCheckpoint | null;
  if (checkpoint === null) {
    await input.authorize();
    const environment = await client.createEnvironment("qwen3-tts");
    checkpoint = await createOrReadJson(key, { schema: "hrs-qwen3-tts-environment/v1", projectId: binding.projectId,
      scopeSha256, environment }, storage) as EnvironmentCheckpoint;
  }
  if (!checkpoint || checkpoint.schema !== "hrs-qwen3-tts-environment/v1" || checkpoint.projectId !== binding.projectId ||
    checkpoint.scopeSha256 !== scopeSha256 || !checkpoint.environment || checkpoint.environment.modelId !== "qwen3-tts" ||
    !uuid.test(checkpoint.environment.id) || !/^[a-f0-9]{64}$/.test(checkpoint.environment.sha256)) {
    throw new Error("HRS Qwen run environment checkpoint is invalid or belongs to another project");
  }
  const environment = await client.getEnvironment(checkpoint.environment.id, "qwen3-tts");
  if (environment.sha256 !== checkpoint.environment.sha256) throw new Error("HRS Qwen run environment changed after checkpointing");
  return environment;
}

export function assertHrsQwenTtsReceipt(value: unknown): HrsQwenTtsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid HRS Qwen receipt");
  const raw = value as Record<string, unknown>, output = raw.output as Record<string, unknown> | undefined;
  if (raw.schema !== HRS_QWEN_TTS_RECEIPT_SCHEMA || raw.route !== "hyper-render-service" || raw.modelId !== "qwen3-tts" ||
    typeof raw.projectId !== "string" || !uuid.test(raw.projectId) || typeof raw.jobId !== "string" || !uuid.test(raw.jobId) ||
    !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 0 || typeof raw.environmentId !== "string" || !uuid.test(raw.environmentId) ||
    typeof raw.environmentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.environmentSha256) ||
    typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey || raw.idempotencyKey.length > 160 ||
    typeof raw.requestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.requestSha256) ||
    typeof raw.textSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.textSha256) ||
    typeof raw.instructionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.instructionSha256) ||
    !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(raw.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(raw.language) ||
    !Number.isSafeInteger(raw.seed) || Number(raw.seed) < 0 ||
    typeof raw.audioSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.audioSha256) ||
    raw.audioFormat !== "wav" || raw.contentType !== "audio/wav" || !Number.isSafeInteger(raw.byteLength) || Number(raw.byteLength) < 1 ||
    raw.costStatus !== "unreported" || !output || typeof output !== "object" ||
    typeof output.bucket !== "string" || !output.bucket || typeof output.key !== "string" || !output.key ||
    output.sha256 !== raw.audioSha256 || output.bytes !== raw.byteLength || output.contentType !== "audio/wav") {
    throw new Error("HRS Qwen receipt is incomplete or malformed");
  }
  return value as HrsQwenTtsReceipt;
}

/** Submit/resume one project-scoped HRS job and bind its exact R2 object receipt. */
export async function synthesizeHrsQwenTts(input: {
  scope: Record<string, string | number>;
  text: string;
  speaker: QwenTtsSpeaker;
  language: QwenTtsLanguage;
  instruct?: string;
  seed: number;
  environment?: HyperYoutubeEnvironment;
  authorize: () => Promise<void>;
  client?: StageClient;
  storage?: StoredJson;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}): Promise<{ bytes: Uint8Array; receipt: HrsQwenTtsReceipt }> {
  if (!input.text.trim() || !(QWEN3_TTS_SPEAKERS as readonly unknown[]).includes(input.speaker) ||
    !(QWEN3_TTS_LANGUAGES as readonly unknown[]).includes(input.language) ||
    !Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error("Invalid HRS Qwen narration segment");
  const stage = { modelId: "qwen3-tts" as const, inputs: {
    text: input.text, speaker: input.speaker, language: input.language,
    ...(input.instruct ? { instruct: input.instruct } : {}),
  }, seed: input.seed };
  const request = { scope: input.scope, stage };
  const requestSha256 = sha256(canonicalJson(request));
  const idempotencyKey = `youtube-qwen3:${sha256(canonicalJson(request)).slice(0, 64)}`;
  const client = input.client ?? configuredHyperYoutubeStageClient();
  const storage = input.storage ?? { get: getObjectBytes, put: putObject };
  const binding = await client.binding();
  const checkpointRoot = `youtube-hrs/qwen3/${sha256(canonicalJson(input.scope))}`;
  const requestKey = `${checkpointRoot}/request.json`, jobKey = `${checkpointRoot}/job.json`;
  const expected = { projectId: binding.projectId, idempotencyKey, requestSha256 };
  let checkpointRaw = await readJson<unknown>(requestKey, storage);
  if (checkpointRaw === null) {
    await input.authorize();
    const environment = input.environment ?? await client.createEnvironment(stage.modelId);
    const candidate: Checkpoint = { schema: "hrs-qwen3-tts-checkpoint/v1", ...expected, environment };
    checkpointRaw = await createOrReadJson(requestKey, candidate, storage);
  }
  let checkpoint = assertCheckpoint(checkpointRaw, expected);
  if (input.environment && (checkpoint.environment.id !== input.environment.id || checkpoint.environment.sha256 !== input.environment.sha256))
    throw new Error("HRS Qwen segment checkpoint does not use the narration run environment");
  const resolvedEnvironment = input.environment ?? await client.getEnvironment(checkpoint.environment.id, "qwen3-tts");
  if (resolvedEnvironment.sha256 !== checkpoint.environment.sha256) throw new Error("HRS Qwen environment changed after checkpointing");

  let jobCheckpoint = await readJson<unknown>(jobKey, storage);
  let job: HyperYoutubeJob;
  if (jobCheckpoint !== null) {
    const saved = assertCheckpoint(jobCheckpoint, expected);
    if (saved.environment.id !== checkpoint.environment.id || !saved.jobId) throw new Error("HRS Qwen job checkpoint lost its environment or job ID");
    checkpoint = saved;
    job = await client.get(saved.jobId, stage, idempotencyKey, checkpoint.environment);
  } else {
    await input.authorize();
    job = await client.submit(stage, idempotencyKey, checkpoint.environment);
    const candidate: Checkpoint = { ...checkpoint, jobId: job.id };
    jobCheckpoint = await createOrReadJson(jobKey, candidate, storage);
    const saved = assertCheckpoint(jobCheckpoint, expected);
    if (saved.jobId !== job.id || saved.environment.id !== job.environmentId) throw new Error("Concurrent HRS Qwen submission returned a different job");
    checkpoint = saved;
    recordModelUsage({ provider: "hyper-render-service", model: "qwen3-tts", kind: "audio",
      unpricedReason: "HRS public job receipt does not report per-job provider cost" });
  }

  const sleep = input.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + (input.maxWaitMs ?? 30 * 60_000);
  for (let poll = 0; job.state !== "completed"; poll++) {
    if (["failed", "cancelled", "expired"].includes(job.state)) throw new Error(`HRS Qwen job ${job.id} ended ${job.state}`);
    if (Date.now() >= deadline) throw new Error(`HRS Qwen job ${job.id} remains ${job.state}; retry to resume this exact job`);
    await sleep(input.pollIntervalMs ?? Math.min(5_000, 1_000 + poll * 250));
    job = await client.get(job.id, stage, idempotencyKey, checkpoint.environment);
  }
  const output = job.output;
  const expectedOutputKey = `${binding.outputPrefix}jobs/${job.id}/${job.generation}/output.wav`;
  if (job.state !== "completed" || job.projectId !== binding.projectId || job.id !== checkpoint.jobId ||
    job.environmentId !== checkpoint.environment.id || job.environmentSha256 !== checkpoint.environment.sha256 ||
    !output || output.available !== true || output.projectId !== binding.projectId || output.jobId !== job.id ||
    output.generation !== job.generation || output.bucket !== binding.outputBucket || output.key !== expectedOutputKey ||
    output.contentType !== "audio/wav" || !/^[a-f0-9]{64}$/.test(output.sha256) ||
    !Number.isSafeInteger(output.bytes) || output.bytes < 1) {
    throw new Error("HRS Qwen job does not match its durable project checkpoint and exact output object");
  }
  const bytes = await client.download(job, stage, idempotencyKey);
  const receipt = assertHrsQwenTtsReceipt({
    schema: HRS_QWEN_TTS_RECEIPT_SCHEMA, route: "hyper-render-service", modelId: "qwen3-tts",
    projectId: job.projectId, jobId: job.id, generation: job.generation, environmentId: job.environmentId,
    environmentSha256: job.environmentSha256, idempotencyKey, requestSha256, textSha256: sha256(input.text),
    instructionSha256: sha256(input.instruct ?? ""), speaker: input.speaker, language: input.language,
    seed: input.seed, audioSha256: sha256(bytes), audioFormat: "wav", byteLength: bytes.byteLength,
    contentType: "audio/wav", output: { bucket: output!.bucket, key: output!.key,
      sha256: output!.sha256, bytes: output!.bytes, contentType: "audio/wav" }, costStatus: "unreported",
  });
  if (receipt.audioSha256 !== output!.sha256 || receipt.byteLength !== output!.bytes) throw new Error("HRS Qwen receipt does not bind the exact downloaded output");
  return { bytes, receipt };
}
