/** A client for persisting an H3 request in Render Engine without dispatching it. */
export type RenderEngineH3StageRequest = Readonly<{
  version: 2;
  idempotencyKey: string;
  prompt: string;
  firstFrame: Readonly<{ r2Key: string; sha256: string }>;
  seed: number;
  durationSeconds: 5;
  output: Readonly<{ width: 1280; height: 736; fps: 24; container: "mp4"; videoCodec: "h264" }>;
  maxCostUsd: number;
  profileRevisionSha256: string;
}>;

/** Every durable state that a staged Engine H3 request may return on replay. */
export type RenderEngineH3StageState =
  | "awaiting-input-qualification"
  | "awaiting-final-qualification"
  | "queued"
  | "capacity-checking"
  | "waiting-for-capacity"
  | "launching"
  | "running"
  | "shutdown-requested"
  | "completed"
  | "failed"
  | "cancelled";

export type RenderEngineH3StageReceipt = Readonly<{
  jobId: string;
  state: RenderEngineH3StageState;
  manifestSha256: string;
}>;

export type RenderEngineH3InputQualificationReceipt = Readonly<{
  jobId: string;
  state: "awaiting-final-qualification";
}>;

/** Read-only status from the project-scoped Engine job endpoint. */
export type RenderEngineH3JobStatus = Readonly<{
  jobId: string;
  status: string;
  progress: string | null;
  completedAt: number | null;
  outputRetired: boolean;
  output: Readonly<{
    bucket: string;
    key: string;
    bytes: number;
    sha256: string;
    contentType: "video/mp4";
    verifiedAt: number;
  }> | null;
}>;

/** A temporary Engine-issued GET capability for an already verified H3 output. */
export type RenderEngineH3OutputReadback = Readonly<{
  bucket: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: "video/mp4";
  verifiedAt: number;
  url: string;
  expiresInSeconds: number;
}>;

export type RenderEngineH3WorkflowReceipt = Readonly<{
  workflowId: string;
  profileRevisionSha256: string;
}>;

export type RenderEngineInputUpload = Readonly<{
  sha256: string;
  bytes: number;
  contentType: "image/png" | "image/jpeg";
}>;

export type RenderEngineInputUploadReceipt = Readonly<{
  key: string;
  url: string;
  headers: Readonly<Record<string, string>>;
}>;

export type RenderEngineH3StageConfig = Readonly<{
  baseUrl: string;
  projectName: string;
  workflowId: string;
  projectCapability: string;
  request: RenderEngineH3StageRequest;
  fetchImpl?: typeof fetch;
}>;

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_NAME = /^[a-z][a-z0-9-]{2,63}$/;
const CONVEX_ID = /^[a-z0-9]{8,64}$/;
const REQUEST_KEYS = [
  "version", "idempotencyKey", "prompt", "firstFrame", "seed", "durationSeconds",
  "output", "maxCostUsd", "profileRevisionSha256",
] as const;
const WORKFLOW_NAME = "studio-h3-final-720";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function engineEndpoint(baseUrl: string, path: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("Render Engine URL is invalid"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Render Engine URL must be the HTTPS Convex site origin");
  }
  url.pathname = path;
  return url.toString();
}

function validateProjectCapability(projectName: string, projectCapability: string): void {
  if (!PROJECT_NAME.test(projectName)) throw new Error("Render Engine project name is invalid");
  if (!/^[a-f0-9]{64}$/.test(projectCapability)) throw new Error("Render Engine project capability is invalid");
}

function validateInputUpload(input: RenderEngineInputUpload): void {
  if (!HEX_SHA256.test(input.sha256) || !Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes >= 30_000_000 ||
      (input.contentType !== "image/png" && input.contentType !== "image/jpeg")) {
    throw new Error("Render Engine input upload is invalid");
  }
}

async function jsonRequest(config: { baseUrl: string; projectName: string; projectCapability: string; fetchImpl?: typeof fetch }, path: string, body: unknown): Promise<unknown> {
  validateProjectCapability(config.projectName, config.projectCapability);
  const response = await (config.fetchImpl ?? fetch)(engineEndpoint(config.baseUrl, path), {
    method: "POST",
    headers: { authorization: `Bearer ${config.projectCapability}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`Render Engine ${path} returned a non-JSON response`);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { throw new Error(`Render Engine ${path} returned malformed JSON`); }
  return { status: response.status, body: parsed };
}

async function jsonGet(config: { baseUrl: string; projectName: string; projectCapability: string; fetchImpl?: typeof fetch }, path: string, jobId: string): Promise<unknown> {
  validateProjectCapability(config.projectName, config.projectCapability);
  if (!CONVEX_ID.test(jobId)) throw new Error("Render Engine H3 job ID is invalid");
  const url = new URL(engineEndpoint(config.baseUrl, path));
  url.searchParams.set("projectName", config.projectName);
  url.searchParams.set("jobId", jobId);
  const response = await (config.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: { authorization: `Bearer ${config.projectCapability}`, accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`Render Engine ${path} returned a non-JSON response`);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { throw new Error(`Render Engine ${path} returned malformed JSON`); }
  return { status: response.status, body: parsed };
}

function validateStageRequest(value: unknown, projectName: string): asserts value is RenderEngineH3StageRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) throw new Error("H3 staging request fields do not match the Render Engine contract");
  const frame = value.firstFrame;
  const output = value.output;
  const projectPrefix = `projects/${projectName}/`;
  const contentAddressedFrame = isRecord(frame) && typeof frame.r2Key === "string" && typeof frame.sha256 === "string" && [
    `${projectPrefix}inputs/sha256/${frame.sha256}.png`,
    `${projectPrefix}inputs/sha256/${frame.sha256}.jpg`,
  ].includes(frame.r2Key);
  if (
    value.version !== 2 || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{16,200}$/.test(value.idempotencyKey) ||
    typeof value.prompt !== "string" || value.prompt.trim().length < 3 || value.prompt.length > 2_000 ||
    !isRecord(frame) || !hasExactKeys(frame, ["r2Key", "sha256"]) || typeof frame.r2Key !== "string" ||
    !contentAddressedFrame || frame.r2Key.length > 512 ||
    frame.r2Key.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9/_ .-]+$/.test(frame.r2Key) || typeof frame.sha256 !== "string" || !HEX_SHA256.test(frame.sha256) ||
    !Number.isSafeInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffff_ffff ||
    value.durationSeconds !== 5 || !isRecord(output) || !hasExactKeys(output, ["width", "height", "fps", "container", "videoCodec"]) ||
    output.width !== 1280 || output.height !== 736 || output.fps !== 24 || output.container !== "mp4" || output.videoCodec !== "h264" ||
    typeof value.maxCostUsd !== "number" || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd <= 0 || value.maxCostUsd > 10 ||
    typeof value.profileRevisionSha256 !== "string" || !HEX_SHA256.test(value.profileRevisionSha256)
  ) throw new Error("H3 staging request is invalid or outside the Render Engine contract");
}

function parseStageReceipt(value: unknown): RenderEngineH3StageReceipt {
  const states: readonly RenderEngineH3StageState[] = [
    "awaiting-input-qualification", "awaiting-final-qualification", "queued", "capacity-checking",
    "waiting-for-capacity", "launching", "running", "shutdown-requested", "completed", "failed", "cancelled",
  ];
  if (!isRecord(value) || !hasExactKeys(value, ["jobId", "state", "manifestSha256"]) ||
      typeof value.jobId !== "string" || !CONVEX_ID.test(value.jobId) ||
      typeof value.state !== "string" || !states.includes(value.state as RenderEngineH3StageState) || typeof value.manifestSha256 !== "string" ||
      !HEX_SHA256.test(value.manifestSha256)) {
    throw new Error("Render Engine returned an invalid H3 staging receipt");
  }
  return { jobId: value.jobId, state: value.state as RenderEngineH3StageState, manifestSha256: value.manifestSha256 };
}

function parseInputQualificationReceipt(value: unknown, jobId: string): RenderEngineH3InputQualificationReceipt {
  if (!isRecord(value) || !hasExactKeys(value, ["jobId", "state"]) || value.jobId !== jobId ||
      value.state !== "awaiting-final-qualification") {
    throw new Error("Render Engine returned an invalid H3 input qualification receipt");
  }
  return { jobId, state: "awaiting-final-qualification" };
}

function parseWorkflowReceipt(value: unknown): RenderEngineH3WorkflowReceipt {
  if (!isRecord(value) || !hasExactKeys(value, ["workflowId", "profileRevisionSha256"]) ||
      typeof value.workflowId !== "string" || !CONVEX_ID.test(value.workflowId) ||
      typeof value.profileRevisionSha256 !== "string" || !HEX_SHA256.test(value.profileRevisionSha256)) {
    throw new Error("Render Engine returned an invalid H3 workflow receipt");
  }
  return { workflowId: value.workflowId, profileRevisionSha256: value.profileRevisionSha256 };
}

function parseInputUploadReceipt(value: unknown, projectName: string, input: RenderEngineInputUpload): RenderEngineInputUploadReceipt {
  if (!isRecord(value) || !hasExactKeys(value, ["bucket", "key", "bytes", "sha256", "contentType", "url", "headers"]) ||
      typeof value.key !== "string" || typeof value.url !== "string" || !isRecord(value.headers) ||
      value.bytes !== input.bytes || value.sha256 !== input.sha256 || value.contentType !== input.contentType) {
    throw new Error("Render Engine returned an invalid input upload receipt");
  }
  const extension = input.contentType === "image/png" ? "png" : "jpg";
  if (value.key !== `projects/${projectName}/inputs/sha256/${input.sha256}.${extension}`) {
    throw new Error("Render Engine input upload key is outside the project namespace");
  }
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Error("Render Engine input upload URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Render Engine input upload URL must be HTTPS");
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value.headers)) {
    if (typeof header !== "string" || !/^(content-type|content-length|x-amz-meta-sha256)$/i.test(key)) {
      throw new Error("Render Engine input upload headers are invalid");
    }
    headers[key] = header;
  }
  if (headers["Content-Type"] !== input.contentType || headers["Content-Length"] !== String(input.bytes) || headers["x-amz-meta-sha256"] !== input.sha256) {
    throw new Error("Render Engine input upload receipt does not bind its content");
  }
  return { key: value.key, url: url.toString(), headers };
}

function parseH3JobStatus(value: unknown, jobId: string): RenderEngineH3JobStatus {
  const expected = ["attempt", "completedAt", "createdAt", "jobId", "lane", "measurement", "output", "outputRetired", "profileId", "progress", "status"];
  if (!isRecord(value) || !hasExactKeys(value, expected) || value.jobId !== jobId || value.lane !== "h3" ||
      typeof value.status !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(value.status) ||
      (value.progress !== null && typeof value.progress !== "string") ||
      (value.completedAt !== null && (typeof value.completedAt !== "number" || !Number.isSafeInteger(value.completedAt) || value.completedAt < 1)) ||
      typeof value.outputRetired !== "boolean") {
    throw new Error("Render Engine returned an invalid H3 job status");
  }
  const output = value.output;
  if (output === null) return { jobId, status: value.status, progress: value.progress as string | null,
    completedAt: value.completedAt as number | null, outputRetired: value.outputRetired, output: null };
  if (!isRecord(output) || !hasExactKeys(output, ["bucket", "bytes", "contentType", "key", "sha256", "verifiedAt"]) ||
      typeof output.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(output.bucket) ||
      typeof output.key !== "string" || !/^projects\/[^/]+\/workflows\/[^/]+\/jobs\/[^/]+\/outputs\/[^/]+\.mp4$/.test(output.key) ||
      typeof output.bytes !== "number" || !Number.isSafeInteger(output.bytes) || output.bytes < 1 || typeof output.sha256 !== "string" || !HEX_SHA256.test(output.sha256) ||
      output.contentType !== "video/mp4" || typeof output.verifiedAt !== "number" || !Number.isSafeInteger(output.verifiedAt) || output.verifiedAt < 1 ||
      value.status !== "completed" || value.outputRetired) {
    throw new Error("Render Engine returned an invalid verified H3 output receipt");
  }
  return { jobId, status: "completed", progress: value.progress as string | null,
    completedAt: value.completedAt as number | null, outputRetired: false,
    output: { bucket: output.bucket, key: output.key, bytes: output.bytes, sha256: output.sha256,
      contentType: "video/mp4", verifiedAt: output.verifiedAt } };
}

function parseH3OutputReadback(value: unknown, jobId: string): RenderEngineH3OutputReadback {
  if (!isRecord(value) || !hasExactKeys(value, ["bucket", "bytes", "contentType", "expiresInSeconds", "key", "sha256", "url", "verifiedAt"]) ||
      typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.bucket) ||
      typeof value.key !== "string" || !new RegExp(`^projects/[^/]+/workflows/[^/]+/jobs/${jobId}/outputs/[^/]+\\.mp4$`).test(value.key) ||
      typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || typeof value.sha256 !== "string" || !HEX_SHA256.test(value.sha256) ||
      value.contentType !== "video/mp4" || typeof value.verifiedAt !== "number" || !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt < 1 ||
      typeof value.expiresInSeconds !== "number" || !Number.isSafeInteger(value.expiresInSeconds) || value.expiresInSeconds < 60 || value.expiresInSeconds > 7_200 || typeof value.url !== "string") {
    throw new Error("Render Engine returned an invalid H3 output readback receipt");
  }
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Error("Render Engine H3 output readback URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Render Engine H3 output readback URL must be HTTPS");
  return { bucket: value.bucket, key: value.key, bytes: value.bytes, sha256: value.sha256,
    contentType: "video/mp4", verifiedAt: value.verifiedAt, url: url.toString(), expiresInSeconds: value.expiresInSeconds };
}

/** Idempotently obtains Studio's Engine-owned Final H3 workflow and current profile revision. */
export async function provisionStudioH3WorkflowInRenderEngine(config: Omit<RenderEngineH3StageConfig, "workflowId" | "request">): Promise<RenderEngineH3WorkflowReceipt> {
  const result = await jsonRequest(config, "/client/workflows", { projectName: config.projectName, workflowName: WORKFLOW_NAME, profileId: "minimax-h3" }) as { status: number; body: unknown };
  if (result.status !== 200) throw new Error(`Render Engine H3 workflow provisioning returned HTTP ${result.status}`);
  return parseWorkflowReceipt(result.body);
}

/** Uploads already hash-verified Studio image bytes through an Engine project-only signed PUT. */
export async function uploadH3InputToRenderEngine(config: Omit<RenderEngineH3StageConfig, "workflowId" | "request">, input: RenderEngineInputUpload, bytes: Uint8Array): Promise<RenderEngineInputUploadReceipt> {
  validateInputUpload(input);
  if (bytes.byteLength !== input.bytes) throw new Error("Render Engine input upload byte length does not match its claim");
  const result = await jsonRequest(config, "/client/input-uploads", { projectName: config.projectName, ...input }) as { status: number; body: unknown };
  if (result.status !== 200) throw new Error(`Render Engine input upload admission returned HTTP ${result.status}`);
  const receipt = parseInputUploadReceipt(result.body, config.projectName, input);
  const response = await (config.fetchImpl ?? fetch)(receipt.url, { method: "PUT", headers: receipt.headers, body: Buffer.from(bytes), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Render Engine input upload PUT returned HTTP ${response.status}`);
  return receipt;
}

/**
 * Persists an H3 request through the Engine's 202 staging branch. It never
 * calls the prompt-only branch, polls jobs, or starts a provider execution.
 */
export async function stageH3RequestInRenderEngine(config: RenderEngineH3StageConfig): Promise<RenderEngineH3StageReceipt> {
  validateProjectCapability(config.projectName, config.projectCapability);
  if (!CONVEX_ID.test(config.workflowId)) throw new Error("Render Engine workflow ID is invalid");
  validateStageRequest(config.request, config.projectName);
  const result = await jsonRequest(config, "/client/h3-jobs", { projectName: config.projectName, workflowId: config.workflowId, request: config.request }) as { status: number; body: unknown };
  if (result.status !== 202) throw new Error(`Render Engine H3 staging returned HTTP ${result.status}`);
  return parseStageReceipt(result.body);
}

/** Reads back the exact Engine-owned frame before the staged job can advance. */
export async function qualifyH3InputInRenderEngine(
  config: Omit<RenderEngineH3StageConfig, "workflowId" | "request">,
  jobId: string,
): Promise<RenderEngineH3InputQualificationReceipt> {
  validateProjectCapability(config.projectName, config.projectCapability);
  if (!CONVEX_ID.test(jobId)) throw new Error("Render Engine H3 job ID is invalid");
  const result = await jsonRequest(config, "/client/h3-jobs/qualify-input", {
    projectName: config.projectName, jobId,
  }) as { status: number; body: unknown };
  if (result.status !== 202) throw new Error(`Render Engine H3 input qualification returned HTTP ${result.status}`);
  return parseInputQualificationReceipt(result.body, jobId);
}

/** Polls one project-owned H3 job. A consumer must still require `output` before accepting completion. */
export async function getH3JobStatusInRenderEngine(
  config: Omit<RenderEngineH3StageConfig, "workflowId" | "request">,
  jobId: string,
): Promise<RenderEngineH3JobStatus> {
  const result = await jsonGet(config, "/client/jobs", jobId) as { status: number; body: unknown };
  if (result.status !== 200) throw new Error(`Render Engine H3 job status returned HTTP ${result.status}`);
  return parseH3JobStatus(result.body, jobId);
}

/** Returns a temporary GET capability only after the Engine rechecks the verified completion receipt. */
export async function getVerifiedH3OutputReadbackInRenderEngine(
  config: Omit<RenderEngineH3StageConfig, "workflowId" | "request">,
  jobId: string,
): Promise<RenderEngineH3OutputReadback> {
  const result = await jsonGet(config, "/client/jobs/output", jobId) as { status: number; body: unknown };
  if (result.status !== 200) throw new Error(`Render Engine H3 output readback returned HTTP ${result.status}`);
  return parseH3OutputReadback(result.body, jobId);
}
