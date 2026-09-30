/** Server-only client for the held Studio Z-Image Turbo Final request. */
export const STUDIO_ZIMAGE_TURBO_PROFILE = {
  id: "studio-zimage-turbo",
  model: "Tongyi-MAI/Z-Image-Turbo",
  revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
  checkpoint: "Z-Image-Turbo",
  steps: 9,
  guidanceScale: 0,
  precision: "bf16",
  profileRevisionSha256: "c5fa2752adcbefa3f28ac80eba06335e841c05e0d5bd1bb694c414cdd8488b1b",
} as const;

export type RenderEngineStudioZImageProfile = "production" | "hero";
export type RenderEngineStudioZImageRequest = Readonly<{
  version: 1;
  idempotencyKey: string;
  sourceId: string;
  profile: RenderEngineStudioZImageProfile;
  candidates: readonly Readonly<{ id: string; prompt: string; seed: number; width: 1920 | 2048; height: 1088 | 1152 }>[];
  output: Readonly<{ contentType: "image/png" }>;
  maxCostUsd: number;
  profileRevisionSha256: typeof STUDIO_ZIMAGE_TURBO_PROFILE.profileRevisionSha256;
}>;

export type RenderEngineStudioZImageStageState =
  | "awaiting-final-qualification" | "queued" | "capacity-checking" | "waiting-for-capacity"
  | "launching" | "running" | "shutdown-requested" | "completed" | "failed" | "cancelled";

export type RenderEngineStudioZImageStageReceipt = Readonly<{
  jobId: string;
  state: RenderEngineStudioZImageStageState;
  manifestSha256: string;
}>;

export type RenderEngineStudioZImageStageConfig = Readonly<{
  baseUrl: string;
  projectName: string;
  workflowId: string;
  projectCapability: string;
  request: RenderEngineStudioZImageRequest;
  fetchImpl?: typeof fetch;
}>;

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_NAME = /^[a-z][a-z0-9-]{2,63}$/;
const CONVEX_ID = /^[a-z0-9]{8,64}$/;
const REQUEST_KEYS = ["version", "idempotencyKey", "sourceId", "profile", "candidates", "output", "maxCostUsd", "profileRevisionSha256"] as const;
const dimensions = {
  production: { width: 1920, height: 1088, candidates: 1 },
  hero: { width: 2048, height: 1152, candidates: 2 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function engineEndpoint(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("Render Engine URL is invalid"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Render Engine URL must be the HTTPS Convex site origin");
  }
  url.pathname = "/client/studio-zimage-batches";
  return url.toString();
}
function validateConfig(config: RenderEngineStudioZImageStageConfig): void {
  if (!PROJECT_NAME.test(config.projectName) || !CONVEX_ID.test(config.workflowId) || !HEX_SHA256.test(config.projectCapability)) {
    throw new Error("Render Engine Studio Z-Image connection is invalid");
  }
}
function validateRequest(value: unknown): asserts value is RenderEngineStudioZImageRequest {
  if (!isRecord(value) || !exactKeys(value, REQUEST_KEYS) || value.version !== 1 ||
      typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{16,200}$/.test(value.idempotencyKey) ||
      typeof value.sourceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(value.sourceId) ||
      (value.profile !== "production" && value.profile !== "hero") || !Array.isArray(value.candidates) ||
      !isRecord(value.output) || !exactKeys(value.output, ["contentType"]) || value.output.contentType !== "image/png" ||
      typeof value.maxCostUsd !== "number" || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd <= 0 || value.maxCostUsd > 10 ||
      value.profileRevisionSha256 !== STUDIO_ZIMAGE_TURBO_PROFILE.profileRevisionSha256) {
    throw new Error("Studio Z-Image stage request is invalid or outside the Final contract");
  }
  const expected = dimensions[value.profile];
  if (value.candidates.length !== expected.candidates) throw new Error("Studio Z-Image candidate count is outside the Final contract");
  const seen = new Set<string>();
  for (const candidate of value.candidates) {
    const seed = isRecord(candidate) ? candidate.seed : undefined;
    if (!isRecord(candidate) || !exactKeys(candidate, ["id", "prompt", "seed", "width", "height"]) ||
        typeof candidate.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(candidate.id) || seen.has(candidate.id) ||
        typeof candidate.prompt !== "string" || candidate.prompt.trim().length < 3 || candidate.prompt.length > 20_000 ||
        typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff ||
        candidate.width !== expected.width || candidate.height !== expected.height) {
      throw new Error("Studio Z-Image candidate is outside the Final contract");
    }
    seen.add(candidate.id);
  }
}
function parseReceipt(value: unknown): RenderEngineStudioZImageStageReceipt {
  const states: readonly RenderEngineStudioZImageStageState[] = [
    "awaiting-final-qualification", "queued", "capacity-checking", "waiting-for-capacity", "launching", "running", "shutdown-requested", "completed", "failed", "cancelled",
  ];
  if (!isRecord(value) || !exactKeys(value, ["jobId", "state", "manifestSha256"]) || typeof value.jobId !== "string" || !CONVEX_ID.test(value.jobId) ||
      typeof value.state !== "string" || !states.includes(value.state as RenderEngineStudioZImageStageState) ||
      typeof value.manifestSha256 !== "string" || !HEX_SHA256.test(value.manifestSha256)) {
    throw new Error("Render Engine returned an invalid Studio Z-Image stage receipt");
  }
  return { jobId: value.jobId, state: value.state as RenderEngineStudioZImageStageState, manifestSha256: value.manifestSha256 };
}

/** Stages an immutable Final request only. It never creates a provider job. */
export async function stageStudioZImageRequestInRenderEngine(config: RenderEngineStudioZImageStageConfig): Promise<RenderEngineStudioZImageStageReceipt> {
  validateConfig(config);
  validateRequest(config.request);
  const response = await (config.fetchImpl ?? fetch)(engineEndpoint(config.baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${config.projectCapability}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ projectName: config.projectName, workflowId: config.workflowId, request: config.request }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Render Engine Studio Z-Image endpoint returned a non-JSON response");
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("Render Engine Studio Z-Image endpoint returned malformed JSON"); }
  if (response.status !== 202) throw new Error(`Render Engine Studio Z-Image endpoint returned HTTP ${response.status}`);
  return parseReceipt(payload);
}
