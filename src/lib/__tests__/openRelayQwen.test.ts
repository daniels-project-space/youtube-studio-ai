import assert from "node:assert/strict";
import {
  drainOpenRelayQwenWorker,
  ensureOpenRelayQwenReady,
  fetchOpenRelayQwenHealth,
} from "@/lib/openRelayQwen";

const saved = { ...process.env };
const vm = {
  id: "12345678-1234-1234-1234-123456789abc",
  organizationId: "12345678-1234-1234-1234-123456789abc",
  name: "yt-qwen3-tts-3090-primary",
  status: "running",
  endpointUrl: "https://yt-qwen3-tts-3090-primary.run.openrelay.inc/",
  public: false,
  gpuModelId: "12345678-1234-1234-1234-123456789abc",
  gpuModelName: "RTX 3090",
  gpuCount: 1,
  diskSizeGb: 30,
  pricePerHourCents: 18,
  imageUrl: "docker.io/pytorch/pytorch@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

process.env.OPENRELAY_API_KEY = "openrelay-test-token-that-is-longer-than-thirty-two-characters";
process.env.QWEN3_TTS_WORKER_TOKEN = "qwen-test-token-that-is-longer-than-thirty-two-characters";
process.env.OPENRELAY_QWEN_VM_ID = vm.id;
process.env.QWEN3_TTS_WORKER_URL = "https://yt-qwen3-tts-3090-primary-mu7djbzr.run.openrelay.inc/synthesize";

const health = {
  schema: "qwen3-tts-worker/v2",
  runtimeReady: true,
  persistentCacheReady: true,
  modelLoaded: false,
  busy: false,
  draining: false,
  idleSeconds: 301,
};

async function main() {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  let vmGets = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", headers });
    if (url.endsWith(`/v1/vms/${vm.id}`)) {
      vmGets++;
      return Response.json({ ...vm, status: vmGets === 1 ? "stopped" : "running" });
    }
    if (url.endsWith(`/v1/vms/${vm.id}/restart`)) return Response.json({ ...vm, status: "deploying" });
    if (url.endsWith("/health")) return Response.json(health);
    if (url.endsWith("/control/drain")) return Response.json({ draining: true });
    throw new Error(`unexpected request ${url}`);
  };

  const ready = await ensureOpenRelayQwenReady({ fetchImpl, wait: async () => {} });
  assert.equal(ready.idleSeconds, 301);
  assert.ok(calls.some((call) => call.url.endsWith(`/restart`) && call.method === "POST"));
  assert.equal(calls.find((call) => call.url.endsWith("/health"))?.headers.get("x-api-key"), process.env.OPENRELAY_API_KEY);

  assert.equal((await fetchOpenRelayQwenHealth(fetchImpl)).persistentCacheReady, true);
  assert.equal(await drainOpenRelayQwenWorker(fetchImpl), true);
  const drainCall = calls.find((call) => call.url.endsWith("/control/drain"));
  assert.equal(drainCall?.headers.get("authorization"), null);
  assert.equal(drainCall?.headers.get("x-worker-authorization"), `Bearer ${process.env.QWEN3_TTS_WORKER_TOKEN}`);

  process.env.QWEN3_TTS_WORKER_URL = "https://wrong-worker.example/synthesize";
  const callsBeforeBadUrl = calls.length;
  await assert.rejects(
    () => ensureOpenRelayQwenReady({ fetchImpl, wait: async () => {} }),
    /pinned private HTTPS Qwen/i,
  );
  assert.equal(calls.length, callsBeforeBadUrl, "an unpinned endpoint must be rejected before a provider restart");
  console.log("OPENRELAY QWEN LIFECYCLE CONTRACT PASS");
}

void main().finally(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
});
