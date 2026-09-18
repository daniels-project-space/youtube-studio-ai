import { OpenRelayVmClient, type OpenRelayVm } from "@/lib/openRelay";

export const OPENRELAY_QWEN_VM_NAME = "yt-qwen3-tts-3090-primary" as const;
export const OPENRELAY_QWEN_IDLE_SECONDS = 300 as const;

export interface OpenRelayQwenHealth {
  schema: "qwen3-tts-worker/v2";
  runtimeReady: true;
  persistentCacheReady: true;
  modelLoaded: boolean;
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

function providerKey(): string {
  return required("OPENRELAY_API_KEY", 32);
}

function workerToken(): string {
  return required("QWEN3_TTS_WORKER_TOKEN", 32);
}

function vmId(): string {
  return required("OPENRELAY_QWEN_VM_ID", 36);
}

function synthesisUrl(): URL {
  let url: URL;
  try {
    url = new URL(required("QWEN3_TTS_WORKER_URL"));
  } catch {
    throw new Error("QWEN3_TTS_WORKER_URL is missing or invalid");
  }
  if (url.protocol !== "https:" || url.pathname !== "/synthesize") {
    throw new Error("QWEN3_TTS_WORKER_URL must be the private HTTPS /synthesize endpoint");
  }
  return url;
}

function endpoint(path: "/health" | "/control/drain"): string {
  const url = synthesisUrl();
  url.pathname = path;
  url.search = "";
  return url.toString();
}

function assertManagedQwenVm(vm: OpenRelayVm): void {
  if (
    vm.name !== OPENRELAY_QWEN_VM_NAME || vm.public || vm.gpuCount !== 1 ||
    !vm.gpuModelName.includes("3090") || vm.diskSizeGb !== 30
  ) {
    throw new Error("OpenRelay Qwen VM identity no longer matches the pinned private 3090 / 30 GB configuration");
  }
}

function asHealth(value: unknown): OpenRelayQwenHealth {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenRelay Qwen health response is malformed");
  }
  const health = value as Record<string, unknown>;
  if (
    health.schema !== "qwen3-tts-worker/v2" || health.runtimeReady !== true ||
    health.persistentCacheReady !== true || typeof health.modelLoaded !== "boolean" ||
    typeof health.busy !== "boolean" || typeof health.draining !== "boolean" ||
    typeof health.idleSeconds !== "number" || !Number.isFinite(health.idleSeconds) || health.idleSeconds < 0
  ) {
    throw new Error("OpenRelay Qwen health response does not attest the pinned persistent worker");
  }
  return health as unknown as OpenRelayQwenHealth;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchOpenRelayQwenHealth(fetchImpl: FetchLike = fetch): Promise<OpenRelayQwenHealth> {
  const response = await fetchImpl(endpoint("/health"), {
    headers: { "x-api-key": providerKey() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRelay Qwen health returned HTTP ${response.status}`);
  return asHealth(await response.json());
}

/**
 * Atomically ask a healthy worker to stop accepting new requests. The caller
 * may stop the VM only after this returns true. A busy worker is deliberately
 * left alone so a paid generation can finish without interruption.
 */
export async function drainOpenRelayQwenWorker(fetchImpl: FetchLike = fetch): Promise<boolean> {
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
  if (!response.ok) throw new Error(`OpenRelay Qwen drain returned HTTP ${response.status}`);
  const body = await response.json() as { draining?: unknown };
  if (body.draining !== true) throw new Error("OpenRelay Qwen drain did not attest draining state");
  return true;
}

/**
 * Start a stopped private VM and wait for its already-persistent Qwen cache.
 * If an idle reaper has drained it but has not yet issued provider stop, this
 * function completes that safe stop then starts a fresh accepting worker.
 */
export async function ensureOpenRelayQwenReady(args?: {
  fetchImpl?: FetchLike;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<OpenRelayQwenHealth> {
  const fetchImpl = args?.fetchImpl ?? fetch;
  const wait = args?.wait ?? sleep;
  const client = new OpenRelayVmClient({ apiKey: providerKey(), fetchImpl });
  const id = vmId();
  const deadline = Date.now() + (args?.timeoutMs ?? 6 * 60_000);
  let drainStopRequested = false;

  for (;;) {
    const vm = await client.getVm(id);
    assertManagedQwenVm(vm);
    if (vm.status === "stopped") {
      await client.restartVm(id);
    } else if (vm.status === "running") {
      try {
        const health = await fetchOpenRelayQwenHealth(fetchImpl);
        if (!health.draining) return health;
        if (!drainStopRequested) {
          await client.stopVm(id);
          drainStopRequested = true;
        }
      } catch (error) {
        // A just-restarted VM has no endpoint yet. Preserve the concrete
        // provider error after the bounded wait rather than guessing.
        if (Date.now() >= deadline) throw error;
      }
    } else if (vm.status !== "deploying") {
      throw new Error(`OpenRelay Qwen VM is ${vm.status}, not restartable`);
    }
    if (Date.now() >= deadline) throw new Error("OpenRelay Qwen worker did not become ready before timeout");
    await wait(5_000);
  }
}
