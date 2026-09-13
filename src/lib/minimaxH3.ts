import { canonicalJson } from "@/lib/canonicalJson";
import { getObjectBytes, presignDownload, presignUpload } from "@/lib/storage";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

/**
 * The shared, R2-native contract for the actual MiniMax H3 worker packs.
 *
 * H3 is deliberately not routed through the older image-to-video bridge:
 * that bridge is pinned to a different model/runtime.  Every dispatch gives
 * the worker short-lived object capabilities rather than R2 credentials, and
 * every accepted result is re-read from R2 before it can reach an editor.
 */
export const MINIMAX_H3_WORKER_CONTRACT = "minimax-h3-worker/v1" as const;
export const MINIMAX_H3_MODEL = "Comfy-Org/MiniMax-H3" as const;
export const MINIMAX_H3_MODEL_REVISION = "4cc1d817b6184899b41293954329f576cb5ae86b" as const;
export const MINIMAX_H3_RUNTIME_ID = "minimax-h3-turbo8-5090-v1" as const;
export const MINIMAX_H3_MANIFEST_SHA256 = "eca7ade81afd2edd4b912275a8657b9504cab71ca7e538aed7ce12f27acc90c9" as const;
export const MINIMAX_H3_PROFILE = Object.freeze({
  id: "official-turbo8-native-768p",
  width: 1344,
  height: 768,
  fps: 24,
  frames: 124,
  steps: 8,
});

export type MiniMaxH3Provider = "salad" | "novita";
export type MiniMaxH3Execution = "weekly-batch" | "on-demand";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_H3_JOBS_PER_BATCH = 60;
const MAX_H3_PARALLEL_SALAD_JOBS = 3;
const MINIMAX_H3_MODEL_BUCKET = "salad-render-infra";
const MINIMAX_H3_MODEL_MANIFEST_KEY = `${MINIMAX_H3_RUNTIME_ID}/immutable-manifest.json`;

export interface MiniMaxH3RenderRequest {
  provider: MiniMaxH3Provider;
  execution: MiniMaxH3Execution;
  prompt: string;
  seed: number;
  firstFrame: {
    r2Key: string;
    sha256: string;
  };
  output: {
    r2Key: string;
  };
  /** Caller-owned ceiling. The worker must attest a non-negative actual cost. */
  maxCostUsd: number;
}

export interface MiniMaxH3RuntimeReceipt {
  provider: MiniMaxH3Provider;
  gpuModel: "RTX 5090";
  runtimeId: typeof MINIMAX_H3_RUNTIME_ID;
  modelManifestSha256: typeof MINIMAX_H3_MANIFEST_SHA256;
  capacityMode: "medium" | "spot";
  costUsd: number;
}

export interface MiniMaxH3Receipt {
  schema: typeof MINIMAX_H3_WORKER_CONTRACT;
  requestKey: string;
  jobId: string;
  execution: MiniMaxH3Execution;
  profile: typeof MINIMAX_H3_PROFILE;
  promptSha256: string;
  seed: number;
  firstFrame: { r2Key: string; sha256: string };
  output: {
    r2Key: string;
    contentSha256: string;
    byteLength: number;
    contentType: "video/mp4";
  };
  runtime: MiniMaxH3RuntimeReceipt;
}

export interface MiniMaxH3RenderedVideo {
  requestKey: string;
  receipt: MiniMaxH3Receipt;
  outputBytes: Uint8Array;
}

export interface MiniMaxH3Readiness {
  configured: boolean;
  admitted: boolean;
  blockers: string[];
}

export class MiniMaxH3Error extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    readonly requestKey?: string,
    readonly status?: number,
    readonly outcomeUnknown = false,
    readonly observedCostUsd = 0,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MiniMaxH3Error";
  }
}

/**
 * The R2 pack is a pre-spend admission check, not a deployment-time promise.
 * Checking the exact manifest bytes at every route boundary prevents either
 * provider from silently rendering with an unrelated local model cache.
 */
export async function assertMiniMaxH3R2ModelManifest(
  readObject: (key: string, bucket?: string) => Promise<Uint8Array> = getObjectBytes,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await readObject(MINIMAX_H3_MODEL_MANIFEST_KEY, MINIMAX_H3_MODEL_BUCKET);
  } catch (error) {
    throw new MiniMaxH3Error("MiniMax H3 immutable R2 model manifest is unavailable", undefined, undefined, false, 0, { cause: error });
  }
  if (sha256BytesHex(bytes) !== MINIMAX_H3_MANIFEST_SHA256) {
    throw new MiniMaxH3Error("MiniMax H3 immutable R2 model manifest digest does not match the admitted runtime");
  }
  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { route?: unknown; files?: unknown };
    if (manifest.route !== "minimax-h3-turbo8-5090" || !Array.isArray(manifest.files) || manifest.files.length < 1) {
      throw new Error("manifest route/files are invalid");
    }
  } catch (error) {
    throw new MiniMaxH3Error("MiniMax H3 immutable R2 model manifest is malformed", undefined, undefined, false, 0, { cause: error });
  }
}

function requiredText(value: unknown, label: string, max = 20_000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new MiniMaxH3Error(`MiniMax H3 ${label} is invalid`);
  }
  return value.trim();
}

function r2Key(value: unknown, label: string): string {
  const key = requiredText(value, label, 1_000);
  if (key.startsWith("/") || key.includes("\\") || /(?:^|\/)\.\.?($|\/)/u.test(key)) {
    throw new MiniMaxH3Error(`MiniMax H3 ${label} must be a canonical R2 key`);
  }
  return key;
}

function hash(value: unknown, label: string): string {
  const digest = requiredText(value, label, 64).toLowerCase();
  if (!SHA256.test(digest)) throw new MiniMaxH3Error(`MiniMax H3 ${label} is invalid`);
  return digest;
}

function boundedSeed(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647) {
    throw new MiniMaxH3Error("MiniMax H3 seed must be a non-negative 32-bit integer");
  }
  return Number(value);
}

function boundedCost(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new MiniMaxH3Error(`MiniMax H3 ${label} is invalid`);
  }
  return value;
}

function routeEnvironment(provider: MiniMaxH3Provider): { url: string; token: string } {
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : "MINIMAX_H3_NOVITA";
  const rawUrl = process.env[`${prefix}_WORKER_URL`]?.trim() ?? "";
  const token = process.env[`${prefix}_WORKER_TOKEN`]?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MiniMaxH3Error(`${prefix}_WORKER_URL is missing or invalid`);
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.hash) {
    throw new MiniMaxH3Error(`${prefix}_WORKER_URL must be a credential-free HTTPS URL outside local qualification`);
  }
  if (token.length < 32) throw new MiniMaxH3Error(`${prefix}_WORKER_TOKEN is missing or too short`);
  return { url: url.toString(), token };
}

export function minimaxH3Readiness(provider: MiniMaxH3Provider): MiniMaxH3Readiness {
  const blockers: string[] = [];
  try { routeEnvironment(provider); } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : "MINIMAX_H3_NOVITA";
  if (process.env[`${prefix}_QUALIFIED`] !== "1") blockers.push(`${prefix}_QUALIFIED is not enabled`);
  const receipt = process.env[`${prefix}_QUALIFICATION_RECEIPT_SHA256`]?.trim().toLowerCase() ?? "";
  if (!SHA256.test(receipt)) blockers.push(`${prefix}_QUALIFICATION_RECEIPT_SHA256 is missing or invalid`);
  // Weekly dispatch is intentionally Salad-only and retains the medium-priority
  // requirement from the independently checked fleet contract.
  if (provider === "salad" && process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY !== "1") {
    blockers.push("MINIMAX_H3_SALAD_MEDIUM_PRIORITY is not enabled");
  }
  return { configured: blockers.every((item) => !item.includes("WORKER_")), admitted: blockers.length === 0, blockers };
}

function normaliseRequest(input: MiniMaxH3RenderRequest): MiniMaxH3RenderRequest {
  if (input.provider !== "salad" && input.provider !== "novita") throw new MiniMaxH3Error("MiniMax H3 provider is invalid");
  if (input.execution !== "weekly-batch" && input.execution !== "on-demand") throw new MiniMaxH3Error("MiniMax H3 execution mode is invalid");
  if (input.execution === "weekly-batch" && input.provider !== "salad") {
    throw new MiniMaxH3Error("weekly MiniMax H3 preparation must use the Salad route");
  }
  if (input.execution === "on-demand" && input.provider !== "novita") {
    throw new MiniMaxH3Error("on-demand MiniMax H3 rendering must use the Novita route");
  }
  return {
    provider: input.provider,
    execution: input.execution,
    prompt: requiredText(input.prompt, "prompt", 12_000),
    seed: boundedSeed(input.seed),
    firstFrame: { r2Key: r2Key(input.firstFrame?.r2Key, "first-frame key"), sha256: hash(input.firstFrame?.sha256, "first-frame digest") },
    output: { r2Key: r2Key(input.output?.r2Key, "output key") },
    maxCostUsd: boundedCost(input.maxCostUsd, "cost ceiling"),
  };
}

function receiptFrom(value: unknown, expected: {
  request: MiniMaxH3RenderRequest;
  requestKey: string;
}): MiniMaxH3Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MiniMaxH3Error("MiniMax H3 worker receipt is missing", expected.requestKey);
  const raw = value as Record<string, unknown>;
  const output = raw.output as Record<string, unknown> | undefined;
  const runtime = raw.runtime as Record<string, unknown> | undefined;
  const profile = raw.profile as Record<string, unknown> | undefined;
  const firstFrame = raw.firstFrame as Record<string, unknown> | undefined;
  if (
    raw.schema !== MINIMAX_H3_WORKER_CONTRACT || raw.requestKey !== expected.requestKey ||
    requiredText(raw.jobId, "receipt job id", 200) !== String(raw.jobId) ||
    raw.execution !== expected.request.execution || raw.promptSha256 !== sha256Hex(expected.request.prompt) ||
    raw.seed !== expected.request.seed || firstFrame?.r2Key !== expected.request.firstFrame.r2Key ||
    firstFrame?.sha256 !== expected.request.firstFrame.sha256 ||
    profile?.id !== MINIMAX_H3_PROFILE.id || profile.width !== MINIMAX_H3_PROFILE.width ||
    profile.height !== MINIMAX_H3_PROFILE.height || profile.fps !== MINIMAX_H3_PROFILE.fps ||
    profile.frames !== MINIMAX_H3_PROFILE.frames || profile.steps !== MINIMAX_H3_PROFILE.steps ||
    output?.r2Key !== expected.request.output.r2Key || output?.contentType !== "video/mp4" ||
    runtime?.provider !== expected.request.provider || runtime.gpuModel !== "RTX 5090" ||
    runtime.runtimeId !== MINIMAX_H3_RUNTIME_ID || runtime.modelManifestSha256 !== MINIMAX_H3_MANIFEST_SHA256 ||
    (runtime.capacityMode !== "medium" && runtime.capacityMode !== "spot") ||
    (expected.request.provider === "salad" && runtime.capacityMode !== "medium")
  ) {
    throw new MiniMaxH3Error("MiniMax H3 worker receipt does not bind the sealed request/profile/runtime", expected.requestKey);
  }
  const contentSha256 = hash(output.contentSha256, "receipt output digest");
  const byteLength = Number(output.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1_024 || byteLength > 5_000_000_000) {
    throw new MiniMaxH3Error("MiniMax H3 receipt output byte length is invalid", expected.requestKey);
  }
  const costUsd = boundedCost(runtime.costUsd, "receipt cost");
  if (costUsd > expected.request.maxCostUsd + Number.EPSILON) {
    throw new MiniMaxH3Error("MiniMax H3 receipt exceeds the caller-owned cost ceiling", expected.requestKey, undefined, false, costUsd);
  }
  return {
    schema: MINIMAX_H3_WORKER_CONTRACT,
    requestKey: expected.requestKey,
    jobId: String(raw.jobId),
    execution: expected.request.execution,
    profile: MINIMAX_H3_PROFILE,
    promptSha256: sha256Hex(expected.request.prompt),
    seed: expected.request.seed,
    firstFrame: expected.request.firstFrame,
    output: { r2Key: expected.request.output.r2Key, contentSha256, byteLength, contentType: "video/mp4" },
    runtime: {
      provider: expected.request.provider,
      gpuModel: "RTX 5090",
      runtimeId: MINIMAX_H3_RUNTIME_ID,
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
      capacityMode: runtime.capacityMode as "medium" | "spot",
      costUsd,
    },
  };
}

/**
 * Computes the exact idempotency identity without contacting either provider.
 * Trigger controllers use this to reconcile an existing create-only receipt
 * before they consider another paid dispatch.
 */
export function miniMaxH3RequestKey(input: MiniMaxH3RenderRequest): string {
  const request = normaliseRequest(input);
  return sha256Hex(canonicalJson({
    schema: MINIMAX_H3_WORKER_CONTRACT,
    provider: request.provider,
    execution: request.execution,
    prompt: request.prompt,
    seed: request.seed,
    firstFrame: request.firstFrame,
    output: request.output,
    profile: MINIMAX_H3_PROFILE,
    maxCostUsd: request.maxCostUsd,
  }));
}

export async function renderMiniMaxH3(
  input: MiniMaxH3RenderRequest,
  options: {
    fetch?: typeof fetch;
    presignRead?: typeof presignDownload;
    presignWrite?: typeof presignUpload;
    readObject?: typeof getObjectBytes;
    readModelManifest?: (key: string, bucket?: string) => Promise<Uint8Array>;
    /** Test seam; production callers never supply this and always verify R2. */
    assertModelManifest?: () => Promise<void>;
  } = {},
): Promise<MiniMaxH3RenderedVideo> {
  const request = normaliseRequest(input);
  const readiness = minimaxH3Readiness(request.provider);
  if (!readiness.admitted) throw new MiniMaxH3Error(`MiniMax H3 ${request.provider} route is not admitted: ${readiness.blockers.join("; ")}`);
  await (options.assertModelManifest ?? (() => assertMiniMaxH3R2ModelManifest(options.readModelManifest)))();
  const route = routeEnvironment(request.provider);
  const requestKey = miniMaxH3RequestKey(request);
  const [firstFrameUrl, outputPutUrl] = await Promise.all([
    (options.presignRead ?? presignDownload)(request.firstFrame.r2Key, { expiresIn: 3_600 }),
    (options.presignWrite ?? presignUpload)(request.output.r2Key, { expiresIn: 3_600, contentType: "video/mp4" }),
  ]);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(route.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${route.token}`, "Content-Type": "application/json", "Idempotency-Key": requestKey },
      body: JSON.stringify({
        schema: MINIMAX_H3_WORKER_CONTRACT,
        request_key: requestKey,
        prompt: request.prompt,
        seed: request.seed,
        first_frame_key: request.firstFrame.r2Key,
        first_frame_url: firstFrameUrl,
        first_frame_sha256: request.firstFrame.sha256,
        output_key: request.output.r2Key,
        output_put_url: outputPutUrl,
        execution: request.execution,
        profile: MINIMAX_H3_PROFILE,
        max_cost_usd: request.maxCostUsd,
      }),
      signal: AbortSignal.timeout(900_000),
    });
  } catch (error) {
    throw new MiniMaxH3Error(
      `MiniMax H3 outcome is unknown after submission; reconcile request ${requestKey} before another dispatch`,
      requestKey, undefined, true, 0, { cause: error },
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MiniMaxH3Error(`MiniMax H3 worker HTTP ${response.status}: ${detail.slice(0, 220)}`, requestKey, response.status);
  }
  let body: { receipt?: unknown };
  try { body = await response.json() as { receipt?: unknown }; } catch (error) {
    throw new MiniMaxH3Error("MiniMax H3 worker returned malformed JSON", requestKey, response.status, false, 0, { cause: error });
  }
  const receipt = receiptFrom(body.receipt, { request, requestKey });
  let outputBytes: Uint8Array;
  try { outputBytes = await (options.readObject ?? getObjectBytes)(receipt.output.r2Key); } catch (error) {
    throw new MiniMaxH3Error(`MiniMax H3 accepted output cannot be re-read from R2 for request ${requestKey}`, requestKey, response.status, false, receipt.runtime.costUsd, { cause: error });
  }
  if (outputBytes.byteLength !== receipt.output.byteLength || sha256BytesHex(outputBytes) !== receipt.output.contentSha256) {
    throw new MiniMaxH3Error("MiniMax H3 R2 output does not match its receipt", requestKey, response.status, false, receipt.runtime.costUsd);
  }
  return { requestKey, receipt, outputBytes };
}

/** One weekly owner/order may use up to three Salad H3 jobs in parallel. */
export async function renderMiniMaxH3WeeklyBatch(
  jobs: readonly Omit<MiniMaxH3RenderRequest, "provider" | "execution">[],
  options?: Parameters<typeof renderMiniMaxH3>[1],
): Promise<MiniMaxH3RenderedVideo[]> {
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > MAX_H3_JOBS_PER_BATCH) {
    throw new MiniMaxH3Error(`weekly MiniMax H3 batch must contain 1..${MAX_H3_JOBS_PER_BATCH} jobs`);
  }
  const outputKeys = jobs.map((job) => r2Key(job.output?.r2Key, "output key"));
  if (new Set(outputKeys).size !== outputKeys.length) throw new MiniMaxH3Error("weekly MiniMax H3 batch has duplicate output keys");
  const result: MiniMaxH3RenderedVideo[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_H3_PARALLEL_SALAD_JOBS, jobs.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= jobs.length) return;
      result[index] = await renderMiniMaxH3({ ...jobs[index]!, provider: "salad", execution: "weekly-batch" }, options);
    }
  }));
  return result;
}
