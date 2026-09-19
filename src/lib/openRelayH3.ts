import { OpenRelayVmClient, type OpenRelayVm } from "@/lib/openRelay";

export const OPENRELAY_H3_VM_NAME = "yt-minimax-h3-a100-persistent" as const;
export const OPENRELAY_H3_WORKER_HOST = "yt-minimax-h3-a100-persistent-mu7qosm1.run.openrelay.inc" as const;
export const OPENRELAY_H3_IDLE_SECONDS = 300 as const;
export const OPENRELAY_H3_ROUTE = "minimax-h3-turbo8-a100" as const;
export const OPENRELAY_H3_RUNTIME_ID = "minimax-h3-turbo8-a100-v1" as const;
export const OPENRELAY_H3_MANIFEST_SHA256 = "1e1b44f69249511e8e7308e5ceb9c9fa60efff4abde37f200dc33f28345b5ae3" as const;
export const OPENRELAY_H3_CAPACITY_MODE = "persistent-disk-auto-stop" as const;

export interface OpenRelayH3Health {
  schema: "minimax-h3-worker/v1";
  ready: true;
  route: typeof OPENRELAY_H3_ROUTE;
  profile: "official-turbo8-native-768p";
  modelLoad: "per-job-high-vram";
  persistentCacheReady: true;
  busy: boolean;
  draining: boolean;
  idleSeconds: number;
}

export interface OpenRelayH3Profile {
  id: "official-turbo8-native-768p";
  width: 1344;
  height: 768;
  fps: 24;
  frames: 124;
  steps: 8;
}

export interface OpenRelayH3RenderRequest {
  schema: "minimax-h3-worker/v1";
  request_key: string;
  prompt: string;
  seed: number;
  first_frame_key: string;
  first_frame_url: string;
  first_frame_sha256: string;
  output_key: string;
  output_put_url: string;
  execution: "weekly-batch" | "weekly-fallback" | "on-demand";
  capacity_mode: typeof OPENRELAY_H3_CAPACITY_MODE;
  profile: OpenRelayH3Profile;
  max_cost_usd: number;
}

export interface OpenRelayH3Receipt {
  schema: "minimax-h3-worker/v1";
  requestKey: string;
  jobId: string;
  execution: OpenRelayH3RenderRequest["execution"];
  profile: OpenRelayH3Profile;
  promptSha256: string;
  seed: number;
  firstFrame: { r2Key: string; sha256: string };
  output: { r2Key: string; contentSha256: string; byteLength: number; contentType: "video/mp4" };
  runtime: {
    provider: "openrelay";
    gpuModel: "A100";
    runtimeId: typeof OPENRELAY_H3_RUNTIME_ID;
    modelManifestSha256: typeof OPENRELAY_H3_MANIFEST_SHA256;
    capacityMode: typeof OPENRELAY_H3_CAPACITY_MODE;
    costUsd: number;
  };
}

export type OpenRelayH3Reconciliation =
  | { status: "absent" }
  | { status: "pending" }
  | { status: "complete"; receipt: OpenRelayH3Receipt };

type FetchLike = typeof fetch;

const HEX_64 = /^[0-9a-f]{64}$/;
const H3_PROFILE: OpenRelayH3Profile = {
  id: "official-turbo8-native-768p", width: 1344, height: 768, fps: 24, frames: 124, steps: 8,
};

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimumLength) throw new Error(`${name} is missing or invalid`);
  return value;
}

function providerKey(): string {
  return required("OPENRELAY_API_KEY", 32);
}

function workerToken(): string {
  return required("MINIMAX_H3_OPENRELAY_WORKER_TOKEN", 32);
}

function vmId(): string {
  return required("MINIMAX_H3_OPENRELAY_VM_ID", 36);
}

function requireQualification(): void {
  if (required("MINIMAX_H3_OPENRELAY_QUALIFIED") !== "1" ||
    !HEX_64.test(required("MINIMAX_H3_OPENRELAY_QUALIFICATION_RECEIPT_SHA256"))) {
    throw new Error("OpenRelay H3 is not qualified for paid work; a sealed native-output receipt is required");
  }
}

function videosUrl(): URL {
  let url: URL;
  try {
    url = new URL(required("MINIMAX_H3_OPENRELAY_WORKER_URL"));
  } catch {
    throw new Error("MINIMAX_H3_OPENRELAY_WORKER_URL is missing or invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== OPENRELAY_H3_WORKER_HOST || url.pathname !== "/v1/videos" || url.search) {
    throw new Error("MINIMAX_H3_OPENRELAY_WORKER_URL must be the pinned private HTTPS H3 /v1/videos endpoint");
  }
  return url;
}

function endpoint(path: "/healthz" | "/control/drain"): string {
  const url = videosUrl();
  url.pathname = path;
  return url.toString();
}

function assertManagedH3Vm(vm: OpenRelayVm): void {
  if (
    vm.name !== OPENRELAY_H3_VM_NAME || vm.public || vm.gpuCount !== 1 ||
    !vm.gpuModelName.includes("A100") || vm.diskSizeGb !== 150
  ) {
    throw new Error("OpenRelay H3 VM identity no longer matches the pinned private A100 / 150 GB configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProfile(value: unknown): value is OpenRelayH3Profile {
  return isRecord(value) && value.id === H3_PROFILE.id && value.width === H3_PROFILE.width &&
    value.height === H3_PROFILE.height && value.fps === H3_PROFILE.fps &&
    value.frames === H3_PROFILE.frames && value.steps === H3_PROFILE.steps;
}

function asHealth(value: unknown): OpenRelayH3Health {
  if (!isRecord(value) || value.schema !== "minimax-h3-worker/v1" || value.ready !== true ||
    value.route !== OPENRELAY_H3_ROUTE || value.profile !== H3_PROFILE.id ||
    value.modelLoad !== "per-job-high-vram" || value.persistentCacheReady !== true ||
    typeof value.busy !== "boolean" || typeof value.draining !== "boolean" ||
    typeof value.idleSeconds !== "number" || !Number.isFinite(value.idleSeconds) || value.idleSeconds < 0
  ) {
    throw new Error("OpenRelay H3 health response does not attest the pinned persistent A100 worker");
  }
  return value as unknown as OpenRelayH3Health;
}

function validateRenderRequest(request: OpenRelayH3RenderRequest): void {
  if (request.schema !== "minimax-h3-worker/v1" || !HEX_64.test(request.request_key) ||
    !request.prompt.trim() || request.prompt.length > 12_000 || !Number.isInteger(request.seed) ||
    request.seed < 0 || request.seed > 2_147_483_647 || !request.first_frame_key || !request.output_key ||
    !HEX_64.test(request.first_frame_sha256) || request.capacity_mode !== OPENRELAY_H3_CAPACITY_MODE ||
    !isProfile(request.profile) || !Number.isFinite(request.max_cost_usd) || request.max_cost_usd <= 0 || request.max_cost_usd > 100
  ) {
    throw new Error("OpenRelay H3 request is outside the sealed worker contract");
  }
  for (const urlText of [request.first_frame_url, request.output_put_url]) {
    try {
      if (new URL(urlText).protocol !== "https:") throw new Error("not https");
    } catch {
      throw new Error("OpenRelay H3 request requires HTTPS presigned object URLs");
    }
  }
}

/**
 * Verifies a worker receipt against the exact immutable request that admitted
 * it.  The durable I2V adapter also uses this when it reuses a receipt stored
 * in R2, before it can avoid a paid provider restart.
 */
export function assertOpenRelayH3Receipt(
  value: unknown,
  request: OpenRelayH3RenderRequest,
): OpenRelayH3Receipt {
  if (!isRecord(value) || value.schema !== "minimax-h3-worker/v1" || value.requestKey !== request.request_key ||
    typeof value.jobId !== "string" || !value.jobId || value.execution !== request.execution || !isProfile(value.profile) ||
    typeof value.promptSha256 !== "string" || !HEX_64.test(value.promptSha256) || value.seed !== request.seed ||
    !isRecord(value.firstFrame) || value.firstFrame.r2Key !== request.first_frame_key || value.firstFrame.sha256 !== request.first_frame_sha256 ||
    !isRecord(value.output) || value.output.r2Key !== request.output_key || typeof value.output.contentSha256 !== "string" ||
    !HEX_64.test(value.output.contentSha256) || typeof value.output.byteLength !== "number" ||
    !Number.isInteger(value.output.byteLength) || value.output.byteLength <= 0 ||
    value.output.contentType !== "video/mp4" || !isRecord(value.runtime) || value.runtime.provider !== "openrelay" ||
    value.runtime.gpuModel !== "A100" || value.runtime.runtimeId !== OPENRELAY_H3_RUNTIME_ID ||
    value.runtime.modelManifestSha256 !== OPENRELAY_H3_MANIFEST_SHA256 || value.runtime.capacityMode !== OPENRELAY_H3_CAPACITY_MODE ||
    typeof value.runtime.costUsd !== "number" || !Number.isFinite(value.runtime.costUsd) || value.runtime.costUsd < 0 ||
    value.runtime.costUsd > request.max_cost_usd + 1e-9
  ) {
    throw new Error("OpenRelay H3 receipt does not attest the sealed A100 render contract");
  }
  return value as unknown as OpenRelayH3Receipt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchOpenRelayH3Health(fetchImpl: FetchLike = fetch): Promise<OpenRelayH3Health> {
  const response = await fetchImpl(endpoint("/healthz"), {
    headers: { "x-api-key": providerKey() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRelay H3 health returned HTTP ${response.status}`);
  return asHealth(await response.json());
}

/** Ask the worker to atomically reject new jobs before a provider stop. */
export async function drainOpenRelayH3Worker(fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await fetchImpl(endpoint("/control/drain"), {
    method: "POST",
    headers: {
      "x-api-key": providerKey(),
      "x-worker-authorization": `Bearer ${workerToken()}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`OpenRelay H3 drain returned HTTP ${response.status}`);
  const body = await response.json() as { draining?: unknown };
  if (body.draining !== true) throw new Error("OpenRelay H3 drain did not attest draining state");
  return true;
}

/**
 * Starts only the pinned stopped VM, then waits for its already-local cache.
 * A drained VM is stopped before restarting, which prevents a stale drain
 * state from accepting a new paid render.
 */
export async function ensureOpenRelayH3Ready(args?: {
  fetchImpl?: FetchLike;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<OpenRelayH3Health> {
  // Refuse before a provider restart. A cache-only health check is not enough
  // evidence to spend on customer video work.
  requireQualification();
  const fetchImpl = args?.fetchImpl ?? fetch;
  const wait = args?.wait ?? sleep;
  const client = new OpenRelayVmClient({ apiKey: providerKey(), fetchImpl });
  const id = vmId();
  const deadline = Date.now() + (args?.timeoutMs ?? 6 * 60_000);
  let drainStopRequested = false;

  for (;;) {
    const vm = await client.getVm(id);
    assertManagedH3Vm(vm);
    if (vm.status === "stopped") {
      await client.restartVm(id);
    } else if (vm.status === "running") {
      try {
        const health = await fetchOpenRelayH3Health(fetchImpl);
        if (!health.draining) return health;
        if (!drainStopRequested) {
          await client.stopVm(id);
          drainStopRequested = true;
        }
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    } else if (vm.status !== "deploying") {
      throw new Error(`OpenRelay H3 VM is ${vm.status}, not restartable`);
    }
    if (Date.now() >= deadline) throw new Error("OpenRelay H3 worker did not become ready before timeout");
    await wait(5_000);
  }
}

/** Submit an already-qualified H3 request. A request key binds retries to one receipt. */
export async function submitOpenRelayH3Render(
  request: OpenRelayH3RenderRequest,
  fetchImpl: FetchLike = fetch,
): Promise<OpenRelayH3Receipt> {
  requireQualification();
  validateRenderRequest(request);
  const response = await fetchImpl(videosUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": providerKey(),
      "x-worker-authorization": `Bearer ${workerToken()}`,
    },
    body: JSON.stringify(request),
    cache: "no-store",
    signal: AbortSignal.timeout(5_500_000),
  });
  if (!response.ok) throw new Error(`OpenRelay H3 render returned HTTP ${response.status}`);
  const body = await response.json() as { receipt?: unknown };
  return assertOpenRelayH3Receipt(body.receipt, request);
}

/** Reconcile a gateway-timed-out request without ever submitting a second job. */
export async function reconcileOpenRelayH3Render(
  request: OpenRelayH3RenderRequest,
  fetchImpl: FetchLike = fetch,
): Promise<OpenRelayH3Reconciliation> {
  validateRenderRequest(request);
  const url = videosUrl();
  url.pathname = `/v1/videos/${request.request_key}`;
  const response = await fetchImpl(url, {
    headers: {
      "x-api-key": providerKey(),
      "x-worker-authorization": `Bearer ${workerToken()}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { status: "absent" };
  if (!response.ok) throw new Error(`OpenRelay H3 reconciliation returned HTTP ${response.status}`);
  const body = await response.json() as { status?: unknown; receipt?: unknown };
  if (body.status === "pending" && body.receipt === undefined) return { status: "pending" };
  if (body.status === "complete") return { status: "complete", receipt: assertOpenRelayH3Receipt(body.receipt, request) };
  throw new Error("OpenRelay H3 reconciliation response is malformed");
}
