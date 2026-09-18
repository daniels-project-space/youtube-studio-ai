import { OpenRelayVmClient, type OpenRelayVm } from "@/lib/openRelay";

/** Exact persistent-disk VM identity for the terminal weekly H3 fallback. */
export const OPENRELAY_H3_VM_NAME = "yt-minimax-h3-a100-fallback" as const;
// H3's immutable pack is 44.4 GB. The proven native route requires 100 GB to
// hold its pinned image, bounded input cache, and one active native render;
// this is the minimum verified route volume, not a generic 320 GB allocation.
export const OPENRELAY_H3_DISK_SIZE_GB = 100 as const;
export const OPENRELAY_H3_IDLE_SECONDS = 300 as const;

export interface OpenRelayH3Health {
  schema: "minimax-h3-worker/v1";
  ready: boolean;
  persistentCacheReady: boolean;
  busy: boolean;
  draining: boolean;
  idleSeconds: number;
}

type FetchLike = typeof fetch;

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimumLength) throw new Error(`${name} is missing or invalid`);
  return value;
}

function providerKey(): string { return required("OPENRELAY_API_KEY", 32); }
function workerToken(): string { return required("MINIMAX_H3_OPENRELAY_WORKER_TOKEN", 32); }
function vmId(): string { return required("MINIMAX_H3_OPENRELAY_VM_ID", 36); }

function videoUrl(): URL {
  let url: URL;
  try { url = new URL(required("MINIMAX_H3_OPENRELAY_WORKER_URL")); } catch {
    throw new Error("MINIMAX_H3_OPENRELAY_WORKER_URL is missing or invalid");
  }
  if (url.protocol !== "https:" || url.pathname !== "/v1/videos" || url.username || url.password || url.hash) {
    throw new Error("MINIMAX_H3_OPENRELAY_WORKER_URL must be the private HTTPS /v1/videos endpoint");
  }
  return url;
}

function endpoint(path: "/healthz" | "/control/drain"): string {
  const url = videoUrl();
  url.pathname = path;
  url.search = "";
  return url.toString();
}

function assertManagedH3Vm(vm: OpenRelayVm): void {
  if (
    vm.name !== OPENRELAY_H3_VM_NAME || vm.public || vm.gpuCount !== 1 ||
    !vm.gpuModelName.includes("A100") || vm.diskSizeGb !== OPENRELAY_H3_DISK_SIZE_GB
  ) {
    throw new Error("OpenRelay H3 VM identity no longer matches the pinned private A100 / 100 GB configuration");
  }
}

function asHealth(value: unknown): OpenRelayH3Health {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OpenRelay H3 health response is malformed");
  const health = value as Record<string, unknown>;
  if (
    health.schema !== "minimax-h3-worker/v1" || typeof health.ready !== "boolean" ||
    typeof health.persistentCacheReady !== "boolean" || typeof health.busy !== "boolean" ||
    typeof health.draining !== "boolean" || typeof health.idleSeconds !== "number" ||
    !Number.isFinite(health.idleSeconds) || health.idleSeconds < 0
  ) throw new Error("OpenRelay H3 health response does not attest the pinned persistent worker");
  return health as unknown as OpenRelayH3Health;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchOpenRelayH3Health(fetchImpl: FetchLike = fetch): Promise<OpenRelayH3Health> {
  const response = await fetchImpl(endpoint("/healthz"), {
    headers: { "x-api-key": providerKey() }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRelay H3 health returned HTTP ${response.status}`);
  return asHealth(await response.json());
}

export async function drainOpenRelayH3Worker(fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await fetchImpl(endpoint("/control/drain"), {
    method: "POST",
    headers: { "x-api-key": providerKey(), "x-worker-authorization": `Bearer ${workerToken()}` },
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`OpenRelay H3 drain returned HTTP ${response.status}`);
  const body = await response.json() as { draining?: unknown };
  if (body.draining !== true) throw new Error("OpenRelay H3 drain did not attest draining state");
  return true;
}

/** Start a stopped H3 VM and accept it only after its local model cache attests. */
export async function ensureOpenRelayH3Ready(args?: {
  fetchImpl?: FetchLike; wait?: (milliseconds: number) => Promise<void>; timeoutMs?: number;
}): Promise<OpenRelayH3Health> {
  const fetchImpl = args?.fetchImpl ?? fetch;
  const wait = args?.wait ?? sleep;
  const client = new OpenRelayVmClient({ apiKey: providerKey(), fetchImpl });
  const id = vmId();
  const deadline = Date.now() + (args?.timeoutMs ?? 8 * 60_000);
  let drainStopRequested = false;
  for (;;) {
    const vm = await client.getVm(id);
    assertManagedH3Vm(vm);
    if (vm.status === "stopped") {
      await client.restartVm(id);
    } else if (vm.status === "running") {
      try {
        const health = await fetchOpenRelayH3Health(fetchImpl);
        if (health.ready && health.persistentCacheReady && !health.draining) return health;
        if (health.draining && !drainStopRequested) {
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
