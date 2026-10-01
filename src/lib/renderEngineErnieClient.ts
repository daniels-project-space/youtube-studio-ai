import { sha256Hex } from "@/lib/sha256";

/** Exact Engine 28f292f native contract. Changing geometry requires a new Final review. */
export const STUDIO_ERNIE_CONTRACT = Object.freeze({
  version: 2 as const, width: 1376, height: 768, steps: 50 as const, cfg: 4 as const,
  precision: "bf16" as const, promptEnhancer: "ernie-native-v1" as const,
  modelManifestSha256: "64686e89d2d844ea5e4547861afb2a3e99489aa64d523389567ebafc57293cbc",
  workerSha256: "4e9ccb0b06ef1b9d77850e534766e3bc81fff3d0f1c3a4f8b603e7d9eb1239bc",
});
export const STUDIO_ERNIE_SOURCE = Object.freeze({
  model: "Comfy-Org/ERNIE-Image", revision: "01bcb3f1acdb1454ee579d2796ecc4c156873eea",
  checkpoint: "ernie-image.safetensors",
});
export type ErnieCandidate = { id: string; prompt: string; seed: number; width: number; height: number };
export type ErnieRequest = {
  version: 2; idempotencyKey: string; sourceId: string; candidates: ErnieCandidate[];
  output: { contentType: "image/png" }; maxCostUsd: number; profileRevisionSha256: string;
  imageContract: typeof STUDIO_ERNIE_CONTRACT; imageContractSha256: string;
};
export type ErnieConfig = { workflowId: string; projectCapability: string; fetchImpl?: typeof fetch };
export type ErnieReceipt = { jobId: string; state: string; manifestSha256: string };
export type ErnieReadiness = { jobId: string; state: string; manifestSha256: string | null; sourceId: string | null; candidateCount: number; finalQualified?: boolean };
export type ErnieOutput = { candidateId: string; bucket: string; key: string; bytes: number; sha256: string; contentType: "image/png"; verifiedAt: number };
const digest = /^[a-f0-9]{64}$/;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const states = new Set(["awaiting-final-qualification", "awaiting-input-qualification", "queued", "capacity-checking", "waiting-for-capacity", "launching", "running", "shutdown-requested", "completed", "failed", "cancelled"]);

export async function provisionStudioErnieWorkflow(config: Omit<ErnieConfig, "workflowId">): Promise<ErnieConfig> {
  const value = await request({ ...config, workflowId: "0".repeat(32) }, "/client/workflows", {
    projectName: "youtube-studio-ai", workflowName: "studio-ernie-native-landscape-v2", profileId: "ernie-image",
    ernieImageContract: STUDIO_ERNIE_CONTRACT,
  });
  if (!record(value) || typeof value.workflowId !== "string" || !/^[a-z0-9]{32}$/.test(value.workflowId) || value.profileRevisionSha256 !== STUDIO_ERNIE_CONTRACT.modelManifestSha256)
    throw new Error("Studio ERNIE workflow receipt is invalid");
  return { ...config, workflowId: value.workflowId };
}

async function request(config: ErnieConfig, path: string, body?: unknown, jobId?: string): Promise<unknown> {
  if (!digest.test(config.projectCapability) || !/^[a-z0-9]{32}$/.test(config.workflowId)) throw new Error("Studio ERNIE Engine binding is invalid");
  const url = new URL(path, "https://jovial-camel-68.convex.site");
  if (jobId) {
    if (!/^[a-z0-9]{32}$/.test(jobId)) throw new Error("Studio ERNIE job identity is invalid");
    url.searchParams.set("projectName", "youtube-studio-ai"); url.searchParams.set("jobId", jobId);
  }
  const response = await (config.fetchImpl ?? fetch)(url, {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${config.projectCapability}`, "content-type": "application/json", accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Studio ERNIE Engine ${path} returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Studio ERNIE response is not JSON");
  return response.json();
}

export async function stageStudioErnieBatch(config: ErnieConfig, batch: ErnieRequest): Promise<ErnieReceipt> {
  const value = await request(config, "/client/ernie-batches", { projectName: "youtube-studio-ai", workflowId: config.workflowId, request: batch });
  if (!record(value) || typeof value.jobId !== "string" || !/^[a-z0-9]{32}$/.test(value.jobId) ||
      typeof value.state !== "string" || !states.has(value.state) || value.manifestSha256 !== sha256Hex(JSON.stringify(batch)))
    throw new Error("Studio ERNIE staging receipt differs from immutable request");
  return value as ErnieReceipt;
}

export async function readStudioErnieBatch(config: ErnieConfig, receipt: ErnieReceipt, batch: ErnieRequest): Promise<ErnieReadiness> {
  const value = await request(config, "/client/ernie-batches/readiness", undefined, receipt.jobId);
  if (!record(value) || value.jobId !== receipt.jobId || value.manifestSha256 !== receipt.manifestSha256 ||
      value.sourceId !== batch.sourceId || value.candidateCount !== batch.candidates.length ||
      typeof value.state !== "string" || !states.has(value.state)) throw new Error("Studio ERNIE readiness binding changed");
  return value as ErnieReadiness;
}

/** URLs and credentials never enter a durable manifest. Engine owns its signed readback verification. */
export async function readStudioErnieOutputs(config: ErnieConfig, receipt: ErnieReceipt, batch: ErnieRequest, expectedBucket: string): Promise<ErnieOutput[]> {
  const value = await request(config, "/client/ernie-batches/output", undefined, receipt.jobId);
  if (!record(value) || !Array.isArray(value.candidates) || value.candidates.length !== batch.candidates.length) throw new Error("Studio ERNIE outputs are incomplete");
  const seen = new Set<string>();
  return value.candidates.map((item): ErnieOutput => {
    if (!record(item) || typeof item.candidateId !== "string" || seen.has(item.candidateId) ||
        !batch.candidates.some(c => c.id === item.candidateId) || item.bucket !== expectedBucket ||
        typeof item.key !== "string" || !new RegExp(`^projects/[a-z0-9]{32}/workflows/${config.workflowId}/jobs/${receipt.jobId}/outputs/candidates/${item.candidateId}\\.png$`).test(item.key) ||
        item.contentType !== "image/png" || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 256 || Number(item.bytes) > 50 * 1024 * 1024 ||
        typeof item.sha256 !== "string" || !digest.test(item.sha256) || !Number.isSafeInteger(item.verifiedAt) || Number(item.verifiedAt) <= 0)
      throw new Error("Studio ERNIE output receipt is invalid or outside project R2");
    seen.add(item.candidateId);
    return { candidateId: item.candidateId, bucket: item.bucket as string, key: item.key, bytes: Number(item.bytes), sha256: item.sha256, contentType: "image/png", verifiedAt: Number(item.verifiedAt) };
  });
}
