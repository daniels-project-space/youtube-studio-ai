import { createHash } from "node:crypto";
import { z } from "zod";
import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { AcceptedMusicArrangementSchema, projectAcceptedMusicArrangementToYuEStyle } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";

export const YUE2_EVALUATION_VERSION = "studio-yue2-evaluation/v1" as const;
export const YUE2_ARRANGEMENT_EVALUATION_VERSION = "studio-yue2-arrangement-evaluation/v1" as const;
export const YUE2_WORKER_CONTRACT = "yue2-evaluation-worker/v1" as const;
export const YUE2_QUALIFICATION = Object.freeze({
  quality: "unqualified", rtx3090: "unqualified", exact_duration: "unqualified",
  instrumental_only: "unqualified", production_approved: false,
} as const);

// An independent allowlist, never a manifest learned from the worker being checked.
export const YUE2_MANIFEST = {
  schema_version: 1,
  source: {
    repository: "https://github.com/multimodal-art-projection/YuE",
    revision: "bd90e4ccae671d869b3ecaca6d7e893927d29442", package: "yue2-infer", version: "0.1.6",
    git_blob_sha1: {
      "__init__.py": "1150d10e6c0e8f083fb12afa0da4ea0687cb8a6c",
      "cli.py": "04f273f3f139f9a21b0e37f7074d6da6a94aad76",
      "cuda_graph.py": "ab0c67d38b84bea822dde4c1595111f73858e842",
      "fast.py": "c9d2da630251b00ca78ab877a1146ec4bab29857",
      "modeling_vae.py": "79014d26619982b3eaa9b9c987c31d6f931930b0",
      "modeling_yue2.py": "9e2b9924b6e277cab5905771ac9afc068267ee8b",
      "nar.py": "cb0bccc2e7ec78c3775b986d165cc2604149be7d",
      "pipeline.py": "9b6fc438d3ab2bba17121594ccb763bfa69db343",
      "progress.py": "c5ad7b172977e0e7db731eec7e10051f26c8b067",
      "protocol.py": "8cf36506c02abf17ee6e2bbc50c7df46b9252599",
      "quantization.py": "f77aab663d24ea65389793a010758e57c22560b3",
      "sampling.py": "9673842079d5cb43fd540f444e2393ebb790739f",
      "storage.py": "f9a252cb044115b2ad392a5deec1565937fd676c",
      "tokenization_yue2.py": "9837504bccde457ad7e03f17ef2b64fe39e5f285",
    },
  },
  model: {
    repository: "m-a-p/YuE2-3B", revision: "14fc6c6f146441b1dd6363fcb2e01e82a6914cb7",
    files_sha256: {
      "model.safetensors": "1d55c42c1a9875c34f5d736e15078449992b044e807ce2a138e6cf289a1e59e9",
      "config.json": "ad3477bbef890bf98ae196c1e4b44779494a6231c4ab66f32708eabadf265329",
      "qwen.tiktoken": "b2b1b8dfb5cc5f024bafc373121c6aba3f66f9a5a0269e243470a1de16a33186",
    },
  },
  vae: {
    repository: "m-a-p/YuE2-Vae", revision: "9a94e1d0ea9f8087e98f77fa88df4a4068104d2a",
    files_sha256: {
      "model.safetensors": "807ce9d5149fa27c5ad3e6582058469852e908f6c5acc8c8aa338e7ab7751346",
      "config.json": "f0191bb9694009956de44e0c361a6f1334760be4c8f848e599bde242a54a0970",
    },
  },
  packages: {
    torch: "2.10.0", transformers: "4.57.6", "huggingface-hub": "0.36.2", safetensors: "0.7.0",
    tiktoken: "0.12.0", numpy: "2.2.6", soundfile: "0.13.1", accelerate: "1.13.0",
  },
  preset: {
    cot: "full", backend: "torch", quantization: "none", model_dtype: "bfloat16", vae_dtype: "float32",
    sample_rate: 48000, channels: 2, memory_budget_gib: 24, vae_core_frames: 1024,
    vae_halo_frames: 16, offload_ar: false,
    generation: {
      abc: { temperature: 0.7, top_p: 0.9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100, min_tokens: 32, max_tokens: 4096 },
      semantic: { temperature: 1.0, top_p: 0.95, top_k: 100, repetition_penalty: 1.2, penalty_window: 50, min_tokens: 200, max_tokens: 9000 },
      ode_steps: 32, ode_method: "midpoint", context: 24576, version: "yue2-native-v1",
    },
  },
  qualification: YUE2_QUALIFICATION,
  license: {
    scope: "personal_creator", company_commercial_authorized: false, owner_statement: "1 its personal",
    terms_url: "https://github.com/multimodal-art-projection/YuE/blob/bd90e4ccae671d869b3ecaca6d7e893927d29442/MODEL_LICENSE",
  },
} as const;

export function yue2Sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const expectedManifestJson = canonicalJson(YUE2_MANIFEST);
export const YUE2_MANIFEST_SHA256 = yue2Sha256(expectedManifestJson);
// Runtime's Python canonical JSON digest (including LF); distinct from the Studio fingerprint.
export const YUE2_RUNTIME_MANIFEST_SHA256 = "9fafca3a73f312141795f91de430ed2c0691d407933acf6ab6ff097be39b0583";
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const JobId = z.string().regex(/^yue2-eval-[a-f0-9]{64}$/u);
const License = z.object({
  scope: z.literal("personal_creator"), acknowledged: z.literal(true),
  company_commercial_authorized: z.literal(false),
}).strict();
const Text = z.string().refine((value) => Buffer.byteLength(value, "utf8") <= 32000);
const LegacyYuE2JobSchema = z.object({
  schema_version: z.literal(1), job_id: JobId,
  style: Text.refine((value) => value.trim().length > 0), lyrics: z.literal(""),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), license: License,
}).strict();
export const YuE2JobSchema = z.discriminatedUnion("schema_version", [LegacyYuE2JobSchema,
  LegacyYuE2JobSchema.extend({ schema_version: z.literal(2),
    requested_duration_sec: z.number().int().min(10).max(300),
    source_duration_policy: z.enum(["exact", "natural_loop"]).optional(),
    abc: Text.refine((value) => value.trim().length > 0).optional(),
  }).strict(),
]);
export type YuE2Job = z.infer<typeof YuE2JobSchema>;

export interface YuE2EvaluationRequest {
  version: typeof YUE2_EVALUATION_VERSION;
  programFingerprint: string;
  manifestSha256: string;
  job: YuE2Job;
}

export interface YuE2AcceptedArrangementRequest {
  version: typeof YUE2_ARRANGEMENT_EVALUATION_VERSION;
  acceptedArrangement: z.infer<typeof AcceptedMusicArrangementSchema>;
  programFingerprint: string;
  manifestSha256: string;
  job: YuE2Job;
}

export type YuE2BoundEvaluationRequest = YuE2EvaluationRequest | YuE2AcceptedArrangementRequest;

function sourceDurationPolicy(accepted: z.infer<typeof AcceptedMusicArrangementSchema>) {
  const arrangement = accepted.arrangement;
  return arrangement.playback === "repeat" && ["primary_music", "meditation_bed"].includes(arrangement.role)
    ? "natural_loop" as const : "exact" as const;
}

export function createYuE2EvaluationRequest(input: {
  program: unknown; style: string; seed: number; personalCreatorAcknowledged: boolean;
}): YuE2EvaluationRequest {
  const program = ChannelMusicProgramSchema.parse(input.program);
  const body = {
    schema_version: 1 as const, style: input.style, lyrics: "" as const, seed: input.seed,
    license: License.parse({ scope: "personal_creator", acknowledged: input.personalCreatorAcknowledged, company_commercial_authorized: false }),
  };
  const binding = {
    version: YUE2_EVALUATION_VERSION, programFingerprint: program.fingerprint,
    manifestSha256: YUE2_MANIFEST_SHA256,
  };
  const job_id = `yue2-eval-${yue2Sha256(canonicalJson({ ...binding, request: body }))}`;
  return { ...binding, job: YuE2JobSchema.parse({ ...body, job_id }) };
}

export function createYuE2AcceptedArrangementRequest(input: {
  arrangement: unknown; seed: number; personalCreatorAcknowledged: boolean; symbolicScore?: string;
}): YuE2AcceptedArrangementRequest {
  const parsed = z.object({
    arrangement: AcceptedMusicArrangementSchema,
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    personalCreatorAcknowledged: z.literal(true),
    symbolicScore: Text.refine((value) => value.trim().length > 0).optional(),
  }).strict().parse(input);
  const acceptedArrangement = parsed.arrangement;
  const body = {
    schema_version: 2 as const,
    requested_duration_sec: acceptedArrangement.arrangement.requestedDurationSec,
    source_duration_policy: sourceDurationPolicy(acceptedArrangement),
    ...(parsed.symbolicScore !== undefined ? { abc: parsed.symbolicScore } : {}),
    style: projectAcceptedMusicArrangementToYuEStyle(acceptedArrangement),
    lyrics: "" as const,
    seed: parsed.seed,
    license: License.parse({ scope: "personal_creator", acknowledged: parsed.personalCreatorAcknowledged, company_commercial_authorized: false }),
  };
  const binding = {
    version: YUE2_ARRANGEMENT_EVALUATION_VERSION,
    programFingerprint: acceptedArrangement.fingerprint,
    manifestSha256: YUE2_MANIFEST_SHA256,
  };
  const job_id = `yue2-eval-${yue2Sha256(canonicalJson({ ...binding, request: body }))}`;
  return { ...binding, acceptedArrangement, job: YuE2JobSchema.parse({ ...body, job_id }) };
}

export function validateYuE2EvaluationRequest(value: unknown): YuE2BoundEvaluationRequest {
  const request = z.discriminatedUnion("version", [z.object({
    version: z.literal(YUE2_EVALUATION_VERSION), programFingerprint: Hash,
    manifestSha256: z.literal(YUE2_MANIFEST_SHA256), job: YuE2JobSchema,
  }).strict(), z.object({
    version: z.literal(YUE2_ARRANGEMENT_EVALUATION_VERSION), programFingerprint: Hash,
    manifestSha256: z.literal(YUE2_MANIFEST_SHA256), job: YuE2JobSchema,
    acceptedArrangement: AcceptedMusicArrangementSchema,
  }).strict()]).parse(value);
  if (request.version === YUE2_ARRANGEMENT_EVALUATION_VERSION && (
    request.programFingerprint !== request.acceptedArrangement.fingerprint ||
    (request.job.schema_version === 2 && request.job.requested_duration_sec !== request.acceptedArrangement.arrangement.requestedDurationSec) ||
    (request.job.schema_version === 2 && request.job.source_duration_policy === "natural_loop" &&
      sourceDurationPolicy(request.acceptedArrangement) !== "natural_loop") ||
    request.job.style !== projectAcceptedMusicArrangementToYuEStyle(request.acceptedArrangement)
  )) {
    throw new Error("YuE2 evaluation must preserve the accepted arrangement fingerprint and exact projected style");
  }
  const { job_id, ...body } = request.job;
  const binding = { version: request.version, programFingerprint: request.programFingerprint, manifestSha256: request.manifestSha256 };
  if (job_id !== `yue2-eval-${yue2Sha256(canonicalJson({ ...binding, request: body }))}`) {
    throw new Error("YuE2 evaluation job ID does not bind the exact request");
  }
  return request;
}

export function assertYuE2Manifest(value: unknown): void {
  if (canonicalJson(value) !== expectedManifestJson) throw new Error("YuE2 worker manifest does not match the pinned source, models and preset");
}

export class YuE2EvaluationError extends Error {
  readonly retryable = false;
  readonly safeToFallback = false;
  constructor(readonly code: string, readonly jobId?: string) {
    super(`YuE2 evaluation ${code}${jobId ? `; recover only with GET for ${jobId}; do not resubmit or use a new ID` : ""}`);
    this.name = "YuE2EvaluationError";
  }
}

export function validateYuE2Endpoint(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new YuE2EvaluationError("invalid_endpoint"); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      endpoint.includes("?") || endpoint.includes("#") || endpoint.includes("\\")) {
    throw new YuE2EvaluationError("unsafe_endpoint");
  }
  return url.origin;
}

const Artifact = z.object({ sha256: Hash, bytes: z.number().int().nonnegative().max(256 * 1024 * 1024) }).strict();
type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.string(), z.number().finite(), z.array(JsonValueSchema), z.record(JsonValueSchema),
]));
const CompletedResult = z.object({
  status: z.literal("complete"), truncated: z.object({ abc: z.literal(false), semantic: z.literal(false) }).strict(),
  sample_rate: z.literal(48000), channels: z.literal(2), frames: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  audio_seconds: z.number().positive().finite(), official_identity: Hash,
  timing: z.record(JsonValueSchema), native_audio: z.literal("audio-native.wav"),
  official_result: z.literal("song/result.json"),
}).strict();
export type YuE2CompletedResult = z.infer<typeof CompletedResult>;

// Hash original Python JSON bytes: reserializing floats in JavaScript changes their digest.
export const YuE2SealedReceiptSchema = z.object({ sha256: Hash, payload_json: z.string().max(1024 * 1024) }).strict();
export type YuE2SealedReceipt = z.infer<typeof YuE2SealedReceiptSchema>;
function unseal(value: unknown): { receipt: YuE2SealedReceipt; payload: unknown } {
  const receipt = YuE2SealedReceiptSchema.parse(value);
  if (!receipt.payload_json.endsWith("\n") || yue2Sha256(receipt.payload_json) !== receipt.sha256) {
    throw new Error("YuE2 receipt integrity mismatch");
  }
  return { receipt, payload: JSON.parse(receipt.payload_json) as unknown };
}

export interface YuE2VerifiedCompletion {
  request: YuE2BoundEvaluationRequest;
  statusResponse: unknown;
  result: YuE2CompletedResult;
  audio: z.infer<typeof Artifact>;
  preClamp?: { audio: z.infer<typeof Artifact>; receipt: z.infer<typeof Artifact> };
  qualification: typeof YUE2_QUALIFICATION;
}

export function verifyYuE2Completion(requestValue: unknown, value: unknown): YuE2VerifiedCompletion {
  const request = validateYuE2EvaluationRequest(requestValue);
  const wire = z.object({
    contract: z.literal(YUE2_WORKER_CONTRACT), job_id: JobId, state: z.literal("completed"), job: YuE2JobSchema,
    job_sha256: Hash, config_sha256: Hash, accepted_sha256: Hash, qualification: z.unknown(),
    progress: z.object({ phase: z.string(), receipt: z.string(), data: JsonValueSchema.optional() }).strict(),
    receipt: z.unknown(), error: z.null(), artifacts: z.record(z.string()),
    receipt_payloads: z.object({ job: YuE2SealedReceiptSchema, config: YuE2SealedReceiptSchema, started: YuE2SealedReceiptSchema, terminal: YuE2SealedReceiptSchema }).strict(),
  }).strict().parse(value);
  if (wire.job_id !== request.job.job_id || canonicalJson(wire.job) !== canonicalJson(request.job)) throw new Error("YuE2 completed job mismatch");
  const job = unseal(wire.receipt_payloads.job);
  const config = unseal(wire.receipt_payloads.config);
  const started = unseal(wire.receipt_payloads.started);
  const terminal = unseal(wire.receipt_payloads.terminal);
  if (canonicalJson(job.payload) !== canonicalJson(request.job)) throw new Error("YuE2 job receipt mismatch");
  if (job.receipt.sha256 !== wire.job_sha256 || config.receipt.sha256 !== wire.config_sha256 ||
      canonicalJson(terminal.payload) !== canonicalJson(wire.receipt) ||
      canonicalJson(wire.qualification) !== canonicalJson(YUE2_QUALIFICATION)) throw new Error("YuE2 status receipt mismatch");
  const savedConfig = z.object({
    schema_version: z.literal(1), manifest: z.unknown(), cache_dir: z.string().min(1), device: z.literal("cuda:0"),
    local_files_only: z.literal(true), candidate_count: z.literal(1),
    exports: z.tuple([z.literal("official_pcm24_flac"), z.literal("native_float32_wav"), z.literal("native_float32_npy")]),
  }).strict().parse(config.payload);
  assertYuE2Manifest(savedConfig.manifest);
  const savedStarted = z.object({
    schema_version: z.literal(1), job_id: JobId, attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), started_at: z.string().min(1),
    pid: z.number().int().positive(), job_sha256: Hash, config_sha256: Hash, environment: z.record(z.unknown()),
  }).strict().parse(started.payload);
  const savedTerminal = z.object({
    schema_version: z.literal(1), job_id: JobId, attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), finished_at: z.string().min(1),
    status: z.literal("completed"), started_sha256: Hash, result: CompletedResult, error: z.null(),
    qualification: z.unknown(), artifacts: z.record(Artifact),
  }).strict().parse(terminal.payload);
  if (savedStarted.job_id !== request.job.job_id || savedTerminal.job_id !== request.job.job_id ||
      savedStarted.attempt !== savedTerminal.attempt ||
      savedStarted.job_sha256 !== job.receipt.sha256 || savedStarted.config_sha256 !== config.receipt.sha256 ||
      savedTerminal.started_sha256 !== started.receipt.sha256 ||
      canonicalJson(savedTerminal.qualification) !== canonicalJson(YUE2_QUALIFICATION)) throw new Error("YuE2 terminal receipt chain mismatch");
  const audio = savedTerminal.artifacts["audio-native.wav"];
  const result = savedTerminal.result;
  if (!audio || !savedTerminal.artifacts["song/result.json"] ||
      Math.abs(result.audio_seconds - result.frames / 48000) > 1e-9 ||
      audio.bytes < result.frames * 8 + 44) throw new Error("YuE2 native audio receipt mismatch");
  const raw = savedTerminal.artifacts["audio-unclipped.wav"];
  const headroom = savedTerminal.artifacts["headroom-status.json"];
  if (Boolean(raw) !== Boolean(headroom) || (raw && raw.bytes < result.frames * 8 + 44) ||
      (headroom && (headroom.bytes < 1 || headroom.bytes > 16384))) throw new Error("Incomplete pre-clamp source evidence");
  return { request, statusResponse: wire, result, audio, qualification: YUE2_QUALIFICATION,
    ...(raw && headroom ? { preClamp: { audio: raw, receipt: headroom } } : {}) };
}

export function verifyYuE2PreClampSource(completion: YuE2VerifiedCompletion, audio: Uint8Array, receipt: Uint8Array): void {
  const bound = verifyYuE2Completion(completion.request, completion.statusResponse);
  if (!bound.preClamp || audio.length !== bound.preClamp.audio.bytes ||
      yue2Sha256(audio) !== bound.preClamp.audio.sha256 || receipt.length !== bound.preClamp.receipt.bytes ||
      yue2Sha256(receipt) !== bound.preClamp.receipt.sha256) throw new Error("Pre-clamp artifact integrity mismatch");
  // The verified terminal binds the original envelope bytes, including Python floats.
  const envelope = z.object({ sha256: Hash, payload: z.object({
    schema: z.literal("yue2-pre-clamp-source/v1"), decode_passes: z.literal(1), decoder_sha256: Hash,
    source: z.literal("audio-unclipped.wav"), official: z.literal("audio-native.wav"), source_sha256: Hash,
    samples_outside_unit_range: z.number().int().min(0).max(bound.result.frames * 2),
    raw_sample_peak: z.number().finite().nonnegative(), clamped_samples_equal_reference: z.literal(true),
    gain_applied: z.literal(false), production_approved: z.literal(false),
  }).strict() }).strict().parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receipt)));
  if (envelope.payload.source_sha256 !== bound.preClamp.audio.sha256) throw new Error("Pre-clamp receipt source mismatch");
}

export function verifyYuE2Audio(completion: YuE2VerifiedCompletion, bytes: Uint8Array): void {
  if (bytes.byteLength !== completion.audio.bytes || yue2Sha256(bytes) !== completion.audio.sha256) {
    throw new Error("YuE2 native audio hash or byte length mismatch");
  }
}

export type YuE2EvaluationOutcome =
  | { status: "completed"; completion: YuE2VerifiedCompletion; audio: Uint8Array }
  | { status: "pending"; jobId: string; workerStatus: string };

export interface YuE2EvaluationClientOptions {
  endpoint: string; bearerToken: string; fetch?: typeof globalThis.fetch;
  timeoutMs?: number; maxResponseBytes?: number; maxAudioBytes?: number;
  executionPolicySha256?: string;
}

export class YuE2EvaluationClient {
  private readonly origin: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAudioBytes: number;
  private readonly executionPolicySha256: string | undefined;
  private readonly attempted = new Set<string>();

  async fetchPreClampSource(completion: YuE2VerifiedCompletion): Promise<{ audio: Uint8Array; receipt: Uint8Array } | undefined> {
    const id = completion.request.job.job_id;
    try {
      const bound = verifyYuE2Completion(completion.request, completion.statusResponse);
      if (!bound.preClamp) return undefined;
      if (bound.preClamp.audio.bytes > this.maxAudioBytes) throw new Error("source limit");
      const path = `/v1/jobs/${id}/artifacts`;
      const receipt = await this.transfer(`${path}/headroom-status.json`, "GET", bound.preClamp.receipt.bytes);
      if (receipt.status !== 200 || yue2Sha256(receipt.bytes) !== bound.preClamp.receipt.sha256 ||
          receipt.bytes.length !== bound.preClamp.receipt.bytes) throw new Error("headroom receipt mismatch");
      const audio = await this.transfer(`${path}/audio-unclipped.wav`, "GET", bound.preClamp.audio.bytes);
      if (audio.status !== 200) throw new Error("source status");
      verifyYuE2PreClampSource(bound, audio.bytes, receipt.bytes);
      return { audio: audio.bytes, receipt: receipt.bytes };
    } catch { throw new YuE2EvaluationError("pre_clamp_source_validation_failed", id); }
  }

  constructor(options: YuE2EvaluationClientOptions) {
    this.origin = validateYuE2Endpoint(options.endpoint);
    if (!/^[A-Za-z0-9_-]{32,512}$/u.test(options.bearerToken)) throw new YuE2EvaluationError("invalid_bearer_token");
    this.token = options.bearerToken;
    if (options.executionPolicySha256 !== undefined && !Hash.safeParse(options.executionPolicySha256).success) {
      throw new YuE2EvaluationError("invalid_execution_policy_hash");
    }
    this.executionPolicySha256 = options.executionPolicySha256;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    this.maxAudioBytes = options.maxAudioBytes ?? 256 * 1024 * 1024;
    for (const [value, maximum] of [[this.timeoutMs, 120000], [this.maxResponseBytes, 4 * 1024 * 1024], [this.maxAudioBytes, 256 * 1024 * 1024]]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new YuE2EvaluationError("invalid_limits");
    }
  }

  private async transfer(path: string, method: "GET" | "POST", maximum: number, body?: unknown): Promise<{ status: number; bytes: Uint8Array }> {
    const controller = new AbortController();
    const expiresAt = performance.now() + this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const operation = async () => {
      const response = await this.fetcher(`${this.origin}${path}`, {
        method, redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(method === "POST" && this.executionPolicySha256 !== undefined
            ? { "X-YuE2-Execution-Policy-SHA256": this.executionPolicySha256 } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (controller.signal.aborted || performance.now() >= expiresAt) { void response.body?.cancel().catch(() => undefined); throw new Error("timeout"); }
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("redirect");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw new Error("size");
      if (!response.body) return { status: response.status, bytes: new Uint8Array() };
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let slab: Uint8Array | undefined;
      let used = 0;
      let total = 0;
      while (true) {
        const part = await reader.read();
        controller.signal.throwIfAborted();
        if (performance.now() >= expiresAt) throw new Error("timeout");
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maximum) throw new Error("size");
        // Coalesce tiny chunks so the byte limit also bounds retained metadata.
        for (let offset = 0; offset < part.value.byteLength;) {
          if (!slab || used === slab.length) {
            slab = new Uint8Array(Math.min(65536, maximum - chunks.length * 65536));
            chunks.push(slab);
            used = 0;
          }
          const count = Math.min(slab.length - used, part.value.byteLength - offset);
          slab.set(part.value.subarray(offset, offset + count), used);
          used += count;
          offset += count;
        }
      }
      if (length !== null && Number(length) !== total) throw new Error("length");
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        const count = Math.min(chunk.byteLength, total - offset);
        bytes.set(chunk.subarray(0, count), offset);
        offset += count;
      }
      return { status: response.status, bytes };
    };
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, this.timeoutMs);
      })]);
    } catch {
      throw new YuE2EvaluationError("transfer_failed");
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
    }
  }

  private async json(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<{ status: number; value: unknown }> {
    const response = await this.transfer(path, method, this.maxResponseBytes, body);
    if ((response.status < 200 || response.status >= 300) && !(response.status === 404 && method === "GET")) throw new YuE2EvaluationError("http_failure");
    try {
      return { status: response.status, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)) as unknown };
    } catch { throw new YuE2EvaluationError("invalid_json"); }
  }

  /** Transport only: callers must verify the sealed policy against their own expected policy. */
  async fetchExecutionPolicy(): Promise<unknown> {
    const response = await this.json("/v1/execution-policy");
    if (response.status !== 200) throw new YuE2EvaluationError("execution_policy_unavailable");
    return response.value;
  }

  /** GET-only evidence recovery also works for failed jobs; it never downloads audio or submits. */
  async fetchExecutionAccounting(requestValue: unknown): Promise<{ statusResponse: unknown; accountingResponse: unknown }> {
    const request = validateYuE2EvaluationRequest(requestValue);
    const id = request.job.job_id;
    try {
      const status = await this.json(`/v1/jobs/${id}`);
      if (status.status !== 200) throw new Error("status unavailable");
      const accounting = await this.json(`/v1/jobs/${id}/accounting`);
      if (accounting.status !== 200) throw new Error("accounting unavailable");
      return { statusResponse: status.value, accountingResponse: accounting.value };
    } catch {
      throw new YuE2EvaluationError("execution_accounting_unavailable", id);
    }
  }

  async evaluate(requestValue: unknown, options: {
    submit?: boolean; recoverOnly?: boolean;
    /** Durable CLI gate must fsync a one-time submission marker before resolving true. */
    beforeSubmit?: () => Promise<boolean>;
    /** Persist an observed exact job before receipt checks or downloading its audio. */
    afterJobObserved?: () => Promise<void>;
  } = {}): Promise<YuE2EvaluationOutcome> {
    const request = validateYuE2EvaluationRequest(requestValue);
    const id = request.job.job_id;
    try {
      const health = await this.json("/v1/health");
      const parsedHealth = z.object({
        contract: z.literal(YUE2_WORKER_CONTRACT), manifest: z.unknown(),
        manifest_sha256: z.literal(YUE2_RUNTIME_MANIFEST_SHA256), qualification: z.unknown(), queue_capacity: z.literal(1),
        worker_state: z.enum(["ready", "busy", "blocked"]), error: z.string().nullable(),
        readiness_scope: z.literal("queue_idle_only_not_gpu_qualification"),
      }).strict().parse(health.value);
      assertYuE2Manifest(parsedHealth.manifest);
      if (canonicalJson(parsedHealth.qualification) !== canonicalJson(YUE2_QUALIFICATION)) throw new Error("qualification");
      const path = `/v1/jobs/${id}`;
      let response = await this.json(path);
      if (response.status === 404) {
        z.object({ contract: z.literal(YUE2_WORKER_CONTRACT), state: z.literal("refused"), error: z.literal("job_not_found") }).strict().parse(response.value);
        if (!options.submit || options.recoverOnly || this.attempted.has(id)) throw new YuE2EvaluationError("submission_refused", id);
        if (parsedHealth.worker_state !== "ready" || parsedHealth.error !== null) throw new YuE2EvaluationError("worker_not_ready", id);
        // Reserve before awaiting caller I/O so concurrent evaluations cannot POST twice.
        this.attempted.add(id);
        if (options.beforeSubmit && !await options.beforeSubmit()) throw new YuE2EvaluationError("submission_already_reserved", id);
        try { response = await this.json("/v1/jobs", "POST", request.job); }
        catch { throw new YuE2EvaluationError("ambiguous_submission", id); }
      }
      const state = z.object({ contract: z.literal(YUE2_WORKER_CONTRACT), job_id: JobId, state: z.string(), job: YuE2JobSchema }).passthrough().parse(response.value);
      if (state.job_id !== id || canonicalJson(state.job) !== canonicalJson(request.job)) throw new Error("job mismatch");
      await options.afterJobObserved?.();
      if (["running", "accepted"].includes(state.state)) return { status: "pending", jobId: id, workerStatus: state.state };
      if (state.state !== "completed") throw new YuE2EvaluationError("terminal_or_ambiguous_worker_state", id);
      const completion = verifyYuE2Completion(request, response.value);
      if (completion.audio.bytes > this.maxAudioBytes) throw new Error("audio limit");
      const audio = await this.transfer(`${path}/artifacts/audio-native.wav`, "GET", Math.min(this.maxAudioBytes, completion.audio.bytes));
      if (audio.status !== 200) throw new Error("audio status");
      verifyYuE2Audio(completion, audio.bytes);
      return { status: "completed", completion, audio: audio.bytes };
    } catch (error) {
      if (error instanceof YuE2EvaluationError && error.jobId === id) throw error;
      // Never surface worker bodies, echoed prompts, fetch errors, URLs or bearer secrets.
      throw new YuE2EvaluationError("validation_or_transport_failed", id);
    }
  }
}
