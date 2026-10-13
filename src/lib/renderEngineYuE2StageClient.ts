import { createHash } from "node:crypto";
import { z } from "zod";

const CONVEX_ID = /^[a-z0-9]{32}$/u;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_NAME = /^[a-z][a-z0-9-]{2,63}$/u;

export const RenderEngineYuE2RequestSchema = z.object({
  version: z.literal(2),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{16,200}$/u),
  sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u),
  profileRevisionSha256: z.string().regex(HEX_SHA256),
  lyrics: z.string().max(16_000),
  style: z.string().min(1).max(12_000),
  seed: z.number().int().min(0).max(0xffff_ffff),
  maxAudioSeconds: z.number().int().min(1).max(300),
  maxCostUsd: z.number().finite().min(0).max(1),
  abc: z.string().min(1).max(48_000),
  abcSha256: z.string().regex(HEX_SHA256),
  sourceConstraints: z.object({
    provider: z.literal("openrelay"),
    gpuModel: z.literal("RTX 3090"),
    maxCostUsd: z.number().finite().gt(0).max(1),
    maxExecutionSeconds: z.number().int().min(30).max(1200),
  }).strict(),
  output: z.object({
    contentType: z.literal("audio/wav"),
    sampleRateHz: z.literal(48_000),
    channels: z.literal(2),
    sampleFormat: z.literal("float32"),
  }).strict(),
}).strict().superRefine((request, ctx) => {
  if (request.abcSha256 !== sha256(request.abc)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["abcSha256"], message: "Score digest mismatch" });
  }
  if (request.maxCostUsd > request.sourceConstraints.maxCostUsd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxCostUsd"], message: "Request cost exceeds source cap" });
  }
});

export type RenderEngineYuE2Request = z.infer<typeof RenderEngineYuE2RequestSchema>;

export type RenderEngineYuE2Config = Readonly<{
  baseUrl: string;
  projectName: string;
  projectCapability: string;
  fetchImpl?: typeof fetch;
}>;

export type RenderEngineYuE2Workflow = Readonly<{ workflowId: string; profileRevisionSha256: string }>;
export type RenderEngineYuE2Stage = Readonly<{
  jobId: string;
  state: string;
  manifestSha256: string;
  dispatchEnabled: boolean;
  output: Readonly<{ bucket: string; key: string; receiptKey: string }>;
}>;
export type RenderEngineYuE2NativeArtifactRead = Readonly<{
  name: string;
  key: string;
  contentType: string;
  bytes: number;
  sha256: string;
  url: string;
  readHeaders: Readonly<{ "If-Match": string }>;
  expiresInSeconds: number;
}>;
export type RenderEngineYuE2Output = Readonly<{
  jobId: string;
  bucket: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: "audio/wav";
  verifiedAt: number;
  url: string;
  expiresInSeconds: number;
  executionJobId: string;
  nativeArtifactReads: readonly RenderEngineYuE2NativeArtifactRead[];
}>;

const NATIVE_SIDECARS = [
  { name: "score.abc", contentType: "text/vnd.abc", maxBytes: 1_000_000 },
  { name: "semantic.npy", contentType: "application/octet-stream", maxBytes: 2_000_000 },
  { name: "latent.npy", contentType: "application/octet-stream", maxBytes: 64_000_000 },
  { name: "request.json", contentType: "application/json", maxBytes: 60_000 },
  { name: "config.json", contentType: "application/json", maxBytes: 60_000 },
  { name: "result.json", contentType: "application/json", maxBytes: 60_000 },
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function endpoint(config: RenderEngineYuE2Config, path: string): string {
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new Error("Render Engine URL is invalid"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Render Engine URL must be an HTTPS Convex site origin");
  if (!PROJECT_NAME.test(config.projectName) || !HEX_SHA256.test(config.projectCapability)) {
    throw new Error("Render Engine YuE2 project capability is invalid");
  }
  url.pathname = path;
  return url.toString();
}

async function request(config: RenderEngineYuE2Config, path: string, method: "GET" | "POST", body?: unknown) {
  const url = new URL(endpoint(config, path));
  if (method === "GET") url.search = new URLSearchParams({ projectName: config.projectName, jobId: String(body) }).toString();
  const response = await (config.fetchImpl ?? fetch)(url, {
    method,
    headers: {
      authorization: `Bearer ${config.projectCapability}`,
      accept: "application/json",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) } : { signal: AbortSignal.timeout(15_000) }),
    cache: "no-store",
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`Render Engine ${path} returned a non-JSON response`);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error(`Render Engine ${path} returned malformed JSON`); }
  return { status: response.status, payload };
}

export async function provisionRenderEngineYuE2Workflow(config: RenderEngineYuE2Config): Promise<RenderEngineYuE2Workflow> {
  const result = await request(config, "/client/workflows", "POST", {
    projectName: config.projectName,
    workflowName: "youtube-studio-yue2-native-source-v1",
    profileId: "yue2",
  });
  if (result.status !== 200 || !record(result.payload) ||
      Object.keys(result.payload).sort().join(",") !== "profileRevisionSha256,workflowId" ||
      typeof result.payload.workflowId !== "string" || !CONVEX_ID.test(result.payload.workflowId) ||
      typeof result.payload.profileRevisionSha256 !== "string" || !HEX_SHA256.test(result.payload.profileRevisionSha256)) {
    throw new Error(`Render Engine YuE2 workflow provisioning returned an invalid receipt (HTTP ${result.status})`);
  }
  return { workflowId: result.payload.workflowId, profileRevisionSha256: result.payload.profileRevisionSha256 };
}

export async function stageRenderEngineYuE2Request(config: RenderEngineYuE2Config & {
  workflowId: string;
  profileRevisionSha256: string;
  request: RenderEngineYuE2Request;
}): Promise<RenderEngineYuE2Stage> {
  if (!CONVEX_ID.test(config.workflowId)) throw new Error("Render Engine YuE2 workflow ID is invalid");
  const requestBody = RenderEngineYuE2RequestSchema.parse(config.request);
  if (!HEX_SHA256.test(config.profileRevisionSha256) || requestBody.profileRevisionSha256 !== config.profileRevisionSha256) {
    throw new Error("Render Engine YuE2 workflow profile revision does not match the request");
  }
  const result = await request(config, "/client/yue2-jobs", "POST", {
    projectName: config.projectName,
    workflowId: config.workflowId,
    request: requestBody,
  });
  const value = result.payload;
  if (result.status !== 202 || !record(value) || !record(value.output) ||
      typeof value.jobId !== "string" || !CONVEX_ID.test(value.jobId) || typeof value.state !== "string" ||
      typeof value.manifestSha256 !== "string" || !HEX_SHA256.test(value.manifestSha256) ||
      typeof value.dispatchEnabled !== "boolean" || typeof value.output.bucket !== "string" || value.output.bucket === "render-engine" ||
      value.output.key !== `projects/${config.projectName}/jobs/${value.jobId}/audio.wav` ||
      value.output.receiptKey !== `projects/${config.projectName}/jobs/${value.jobId}/yue2.receipt.json`) {
    throw new Error(`Render Engine YuE2 staging returned an invalid receipt (HTTP ${result.status})`);
  }
  return {
    jobId: value.jobId,
    state: value.state,
    manifestSha256: value.manifestSha256,
    dispatchEnabled: value.dispatchEnabled,
    output: { bucket: value.output.bucket, key: value.output.key, receiptKey: value.output.receiptKey },
  };
}

export async function getRenderEngineYuE2Job(config: RenderEngineYuE2Config, jobId: string): Promise<Record<string, unknown>> {
  if (!CONVEX_ID.test(jobId)) throw new Error("Render Engine YuE2 job ID is invalid");
  const result = await request(config, "/client/jobs", "GET", jobId);
  if (result.status !== 200 || !record(result.payload) || result.payload.jobId !== jobId || result.payload.profileId !== "yue2") {
    throw new Error(`Render Engine YuE2 status returned an invalid project job (HTTP ${result.status})`);
  }
  return result.payload;
}

export async function getRenderEngineYuE2Output(config: RenderEngineYuE2Config, jobId: string): Promise<RenderEngineYuE2Output> {
  if (!CONVEX_ID.test(jobId)) throw new Error("Render Engine YuE2 job ID is invalid");
  const result = await request(config, "/client/jobs/output", "GET", jobId);
  const value = result.payload;
  if (result.status !== 200 || !record(value) || value.jobId !== jobId ||
      typeof value.bucket !== "string" || typeof value.key !== "string" ||
      typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 1 ||
      typeof value.sha256 !== "string" || !HEX_SHA256.test(value.sha256) || value.contentType !== "audio/wav" ||
      typeof value.url !== "string" || typeof value.executionJobId !== "string" || !CONVEX_ID.test(value.executionJobId) ||
      typeof value.verifiedAt !== "number" || !Number.isSafeInteger(value.verifiedAt) ||
      typeof value.expiresInSeconds !== "number" || !Number.isSafeInteger(value.expiresInSeconds) ||
      value.expiresInSeconds < 60 || value.expiresInSeconds > 7200 || !Array.isArray(value.nativeArtifactReads) ||
      value.nativeArtifactReads.length !== NATIVE_SIDECARS.length) {
    throw new Error(`Render Engine YuE2 output readback returned an invalid verified receipt (HTTP ${result.status})`);
  }
  if (value.bucket === "render-engine" || value.key !== `projects/${config.projectName}/jobs/${value.executionJobId}/audio.wav`) {
    throw new Error("Render Engine YuE2 output key is outside the requesting project's native job scope");
  }
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Render Engine YuE2 output URL must be HTTPS");
  for (const sidecar of NATIVE_SIDECARS) {
    const matches = value.nativeArtifactReads.filter((item) => record(item) && item.name === sidecar.name);
    const item = matches[0];
    if (matches.length !== 1 || !record(item) ||
        item.key !== `projects/${config.projectName}/jobs/${value.executionJobId}/native/${sidecar.name}` &&
        !new RegExp(`^projects/${config.projectName}/workflows/[A-Za-z0-9_-]+/jobs/${value.executionJobId}/native/${sidecar.name.replaceAll(".", "\\.")}$`).test(String(item.key)) ||
        item.contentType !== sidecar.contentType || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) ||
        item.bytes < 1 || item.bytes > sidecar.maxBytes || typeof item.sha256 !== "string" || !HEX_SHA256.test(item.sha256) ||
        typeof item.url !== "string" || typeof item.expiresInSeconds !== "number" || !Number.isSafeInteger(item.expiresInSeconds) ||
        item.expiresInSeconds < 60 || item.expiresInSeconds > 7200 || !record(item.readHeaders) ||
        Object.keys(item.readHeaders).length !== 1 || typeof item.readHeaders["If-Match"] !== "string" ||
        !item.readHeaders["If-Match"].length || item.readHeaders["If-Match"].length > 256) {
      throw new Error(`Render Engine YuE2 native sidecar readback is invalid: ${sidecar.name}`);
    }
    const sidecarUrl = new URL(item.url);
    if (sidecarUrl.protocol !== "https:" || sidecarUrl.username || sidecarUrl.password) {
      throw new Error(`Render Engine YuE2 native sidecar URL is invalid: ${sidecar.name}`);
    }
  }
  return value as RenderEngineYuE2Output;
}
