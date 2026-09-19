/**
 * Durable, opt-in MiniMax H3 image-to-video adapter.
 *
 * This is deliberately separate from the sealed Novita LTX path.  H3 has a
 * fixed, qualified Turbo8 profile, so callers must select it explicitly and
 * supply an already-owned R2 first frame.  A completed receipt is written to
 * R2 before delivery; retries reuse it without waking the A100.  If the
 * worker accepted a request but the gateway response is lost, reconciliation
 * wins over re-submission and therefore cannot buy a second take.
 */
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertOpenRelayH3Receipt,
  ensureOpenRelayH3Ready,
  reconcileOpenRelayH3Render,
  submitOpenRelayH3Render,
  type OpenRelayH3Receipt,
  type OpenRelayH3RenderRequest,
} from "@/lib/openRelayH3";
import { sha256Hex } from "@/lib/sha256";
import {
  getObjectBytes,
  getObjectIntegrity,
  headObjectMetadata,
  presignDownload,
  presignUpload,
  putObject,
} from "@/lib/storage";

const H3_I2V_RECEIPT_SCHEMA = "openrelay-h3-i2v-receipt/v1" as const;
const H3_PROFILE = {
  id: "official-turbo8-native-768p",
  width: 1344,
  height: 768,
  fps: 24,
  frames: 124,
  steps: 8,
} as const;
const H3_NATIVE_DURATION_SECONDS = H3_PROFILE.frames / H3_PROFILE.fps;
const MAX_RECEIPT_BYTES = 128 * 1024;

export interface OpenRelayH3I2VArgs {
  /** R2 prefix owned by the calling run; no arbitrary filesystem paths. */
  prefix: string;
  /** Stable shot identifier within that run. */
  id: string;
  prompt: string;
  /** H3 only accepts a private, checksum-bound R2 first-frame object. */
  imageKey: string;
  /** H3's qualified profile is fixed at ~5.17 seconds. */
  durationSec?: number;
  /** Kept at the generic I2V boundary; only the native wide profile is admitted. */
  aspectRatio?: string;
  maxCostUsd: number;
  execution?: OpenRelayH3RenderRequest["execution"];
}

export interface OpenRelayH3I2VResult {
  url: string;
  key: string;
  jobId: string;
  model: "MiniMax-H3@official-turbo8-native-768p";
  costUsd: number;
  receipt: OpenRelayH3Receipt;
  reused: boolean;
}

interface StoredH3Receipt {
  schema: typeof H3_I2V_RECEIPT_SCHEMA;
  requestKey: string;
  outputKey: string;
  receipt: unknown;
}

export interface OpenRelayH3I2VDependencies {
  getObjectIntegrity: typeof getObjectIntegrity;
  headObjectMetadata: typeof headObjectMetadata;
  getObjectBytes: typeof getObjectBytes;
  presignDownload: typeof presignDownload;
  presignUpload: typeof presignUpload;
  putObject: typeof putObject;
  ensureReady: typeof ensureOpenRelayH3Ready;
  reconcile: typeof reconcileOpenRelayH3Render;
  submit: typeof submitOpenRelayH3Render;
}

const liveDependencies: OpenRelayH3I2VDependencies = {
  getObjectIntegrity,
  headObjectMetadata,
  getObjectBytes,
  presignDownload,
  presignUpload,
  putObject,
  ensureReady: ensureOpenRelayH3Ready,
  reconcile: reconcileOpenRelayH3Render,
  submit: submitOpenRelayH3Render,
};

function cleanPrefix(value: string): string {
  const clean = value.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("..") || clean.split("/").some((part) => !part)) {
    throw new Error("OpenRelay H3 I2V prefix is invalid");
  }
  return clean;
}

function cleanId(value: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(clean)) {
    throw new Error("OpenRelay H3 I2V id is invalid");
  }
  return clean;
}

function assertArgs(args: OpenRelayH3I2VArgs): void {
  if (!args.prompt.trim() || args.prompt.length > 12_000) {
    throw new Error("OpenRelay H3 I2V prompt is invalid");
  }
  if (!args.imageKey.trim() || args.imageKey.includes("..")) {
    throw new Error("OpenRelay H3 I2V requires an owned R2 first-frame key");
  }
  if (!Number.isFinite(args.maxCostUsd) || args.maxCostUsd <= 0 || args.maxCostUsd > 100) {
    throw new Error("OpenRelay H3 I2V max cost is outside the qualified ceiling");
  }
  if (args.aspectRatio !== undefined && args.aspectRatio !== "16:9") {
    throw new Error("OpenRelay H3 I2V only supports the qualified native wide profile");
  }
  if (
    args.durationSec !== undefined &&
    Math.abs(args.durationSec - 5) > 0.001 &&
    Math.abs(args.durationSec - H3_NATIVE_DURATION_SECONDS) > 0.001
  ) {
    throw new Error(
      `OpenRelay H3 I2V has a fixed ${H3_NATIVE_DURATION_SECONDS.toFixed(3)} second qualified profile`,
    );
  }
  cleanPrefix(args.prefix);
  cleanId(args.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
  const name = (error as { name?: unknown })?.name;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

function isPreconditionFailure(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
  return status === 409 || status === 412;
}

function requestIdentity(args: {
  prompt: string;
  firstFrameKey: string;
  firstFrameSha256: string;
  execution: OpenRelayH3RenderRequest["execution"];
  maxCostUsd: number;
}): string {
  return sha256Hex(canonicalJson({
    schema: "openrelay-h3-i2v-request/v1",
    prompt: args.prompt.trim(),
    firstFrameKey: args.firstFrameKey,
    firstFrameSha256: args.firstFrameSha256,
    profile: H3_PROFILE,
    execution: args.execution,
    maxCostUsd: args.maxCostUsd,
  }));
}

function seedFromRequestKey(requestKey: string): number {
  return Number.parseInt(requestKey.slice(0, 8), 16) % 2_147_483_647;
}

function receiptKeyFor(outputKey: string): string {
  return outputKey.replace(/\/output\.mp4$/, "/receipt.json");
}

function parseStoredReceipt(value: unknown, request: OpenRelayH3RenderRequest): OpenRelayH3Receipt {
  if (!isRecord(value) || value.schema !== H3_I2V_RECEIPT_SCHEMA ||
    value.requestKey !== request.request_key || value.outputKey !== request.output_key) {
    throw new Error("OpenRelay H3 durable receipt does not match the immutable request");
  }
  return assertOpenRelayH3Receipt(value.receipt, request);
}

async function verifyOutput(
  request: OpenRelayH3RenderRequest,
  receipt: OpenRelayH3Receipt,
  deps: OpenRelayH3I2VDependencies,
): Promise<void> {
  const [integrity, metadata] = await Promise.all([
    deps.getObjectIntegrity(request.output_key),
    deps.headObjectMetadata(request.output_key),
  ]);
  if (!metadata || metadata.contentType?.split(";", 1)[0] !== "video/mp4" ||
    integrity.sha256 !== receipt.output.contentSha256 || integrity.byteLength !== receipt.output.byteLength) {
    throw new Error("OpenRelay H3 output does not match its immutable worker receipt");
  }
}

async function loadStoredReceipt(args: {
  receiptKey: string;
  request: OpenRelayH3RenderRequest;
  deps: OpenRelayH3I2VDependencies;
}): Promise<OpenRelayH3Receipt | null> {
  let bytes: Uint8Array;
  try {
    bytes = await args.deps.getObjectBytes(args.receiptKey, undefined, { timeoutMs: 15_000 });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error("OpenRelay H3 durable receipt has an invalid byte length");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("OpenRelay H3 durable receipt is not valid JSON");
  }
  const receipt = parseStoredReceipt(parsed, args.request);
  await verifyOutput(args.request, receipt, args.deps);
  return receipt;
}

async function persistReceipt(args: {
  receiptKey: string;
  request: OpenRelayH3RenderRequest;
  receipt: OpenRelayH3Receipt;
  deps: OpenRelayH3I2VDependencies;
}): Promise<OpenRelayH3Receipt> {
  await verifyOutput(args.request, args.receipt, args.deps);
  const body = canonicalJson({
    schema: H3_I2V_RECEIPT_SCHEMA,
    requestKey: args.request.request_key,
    outputKey: args.request.output_key,
    receipt: args.receipt,
  } satisfies StoredH3Receipt);
  try {
    await args.deps.putObject(args.receiptKey, body, {
      contentType: "application/json",
      ifNoneMatch: "*",
    });
    return args.receipt;
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const stored = await loadStoredReceipt(args);
    if (!stored) throw new Error("OpenRelay H3 receipt write raced but no durable receipt exists");
    return stored;
  }
}

function asResult(args: {
  receipt: OpenRelayH3Receipt;
  key: string;
  url: string;
  reused: boolean;
}): OpenRelayH3I2VResult {
  return {
    url: args.url,
    key: args.key,
    jobId: args.receipt.jobId,
    model: "MiniMax-H3@official-turbo8-native-768p",
    costUsd: args.receipt.runtime.costUsd,
    receipt: args.receipt,
    reused: args.reused,
  };
}

/**
 * Uses the existing persistent A100 only after an R2 receipt miss.  The
 * returned result is API-compatible with the generic I2V seam, but its route
 * remains opt-in because its fixed output profile is not an LTX substitute.
 */
export async function renderOpenRelayH3I2V(
  args: OpenRelayH3I2VArgs,
  overrides: Partial<OpenRelayH3I2VDependencies> = {},
): Promise<OpenRelayH3I2VResult> {
  assertArgs(args);
  const deps = { ...liveDependencies, ...overrides };
  const prefix = cleanPrefix(args.prefix);
  const id = cleanId(args.id);
  const execution = args.execution ?? "on-demand";
  const input = await deps.getObjectIntegrity(args.imageKey);
  const requestKey = requestIdentity({
    prompt: args.prompt,
    firstFrameKey: args.imageKey,
    firstFrameSha256: input.sha256,
    execution,
    maxCostUsd: args.maxCostUsd,
  });
  const outputKey = `${prefix}/openrelay-h3/${id}-${requestKey.slice(0, 20)}/output.mp4`;
  const receiptKey = receiptKeyFor(outputKey);
  const firstFrameUrl = await deps.presignDownload(args.imageKey, { expiresIn: 7_200 });
  const outputPutUrl = await deps.presignUpload(outputKey, {
    expiresIn: 7_200,
    contentType: "video/mp4",
  });
  const request: OpenRelayH3RenderRequest = {
    schema: "minimax-h3-worker/v1",
    request_key: requestKey,
    prompt: args.prompt.trim(),
    seed: seedFromRequestKey(requestKey),
    first_frame_key: args.imageKey,
    first_frame_url: firstFrameUrl,
    first_frame_sha256: input.sha256,
    output_key: outputKey,
    output_put_url: outputPutUrl,
    execution,
    capacity_mode: "persistent-disk-auto-stop",
    profile: H3_PROFILE,
    max_cost_usd: args.maxCostUsd,
  };

  const stored = await loadStoredReceipt({ receiptKey, request, deps });
  if (stored) {
    return asResult({
      receipt: stored,
      key: outputKey,
      url: await deps.presignDownload(outputKey),
      reused: true,
    });
  }

  await deps.ensureReady();
  const reconciliation = await deps.reconcile(request);
  if (reconciliation.status === "pending") {
    throw new Error("OpenRelay H3 request is pending reconciliation; refusing to submit a second paid take");
  }
  const completed = reconciliation.status === "complete"
    ? reconciliation.receipt
    : await (async () => {
      try {
        return await deps.submit(request);
      } catch (error) {
        const afterFailure = await deps.reconcile(request);
        if (afterFailure.status === "complete") return afterFailure.receipt;
        if (afterFailure.status === "pending") {
          throw new Error("OpenRelay H3 request is pending reconciliation after an uncertain submit; refusing a second paid take");
        }
        throw error;
      }
    })();
  const receipt = await persistReceipt({ receiptKey, request, receipt: completed, deps });
  return asResult({
    receipt,
    key: outputKey,
    url: await deps.presignDownload(outputKey),
    reused: reconciliation.status === "complete",
  });
}

