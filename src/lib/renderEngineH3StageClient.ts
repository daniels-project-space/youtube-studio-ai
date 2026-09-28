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

export type RenderEngineH3StageReceipt = Readonly<{
  jobId: string;
  state: "awaiting-input-qualification";
  manifestSha256: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function engineEndpoint(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("Render Engine URL is invalid"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Render Engine URL must be the HTTPS Convex site origin");
  }
  url.pathname = "/client/h3-jobs";
  return url.toString();
}

function validateStageRequest(value: unknown, projectName: string): asserts value is RenderEngineH3StageRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) throw new Error("H3 staging request fields do not match the Render Engine contract");
  const frame = value.firstFrame;
  const output = value.output;
  const projectPrefix = `projects/${projectName}/`;
  if (
    value.version !== 2 || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{16,200}$/.test(value.idempotencyKey) ||
    typeof value.prompt !== "string" || value.prompt.trim().length < 3 || value.prompt.length > 2_000 ||
    !isRecord(frame) || !hasExactKeys(frame, ["r2Key", "sha256"]) || typeof frame.r2Key !== "string" ||
    !frame.r2Key.startsWith(projectPrefix) || frame.r2Key.length > 512 ||
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
  if (!isRecord(value) || !hasExactKeys(value, ["jobId", "state", "manifestSha256"]) ||
      typeof value.jobId !== "string" || !CONVEX_ID.test(value.jobId) ||
      value.state !== "awaiting-input-qualification" || typeof value.manifestSha256 !== "string" ||
      !HEX_SHA256.test(value.manifestSha256)) {
    throw new Error("Render Engine returned an invalid H3 staging receipt");
  }
  return { jobId: value.jobId, state: value.state, manifestSha256: value.manifestSha256 };
}

/**
 * Persists an H3 request through the Engine's 202 staging branch. It never
 * calls the prompt-only branch, polls jobs, or starts a provider execution.
 */
export async function stageH3RequestInRenderEngine(config: RenderEngineH3StageConfig): Promise<RenderEngineH3StageReceipt> {
  if (!PROJECT_NAME.test(config.projectName)) throw new Error("Render Engine project name is invalid");
  if (!CONVEX_ID.test(config.workflowId)) throw new Error("Render Engine workflow ID is invalid");
  if (!/^[a-f0-9]{64}$/.test(config.projectCapability)) throw new Error("Render Engine project capability is invalid");
  validateStageRequest(config.request, config.projectName);

  const response = await (config.fetchImpl ?? fetch)(engineEndpoint(config.baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${config.projectCapability}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ projectName: config.projectName, workflowId: config.workflowId, request: config.request }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 202) throw new Error(`Render Engine H3 staging returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Render Engine H3 staging returned a non-JSON receipt");
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Render Engine H3 staging returned malformed JSON"); }
  return parseStageReceipt(body);
}
