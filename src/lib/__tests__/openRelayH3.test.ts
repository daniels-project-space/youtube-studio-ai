import assert from "node:assert/strict";
import {
  drainOpenRelayH3Worker,
  ensureOpenRelayH3Ready,
  fetchOpenRelayH3Health,
  OPENRELAY_H3_DISK_SIZE_GB,
} from "@/lib/openRelayH3";

const saved = { ...process.env };
process.env.OPENRELAY_API_KEY = "openrelay-test-key-that-is-longer-than-thirty-two-characters";
process.env.MINIMAX_H3_OPENRELAY_VM_ID = "11111111-1111-4111-8111-111111111111";
process.env.MINIMAX_H3_OPENRELAY_WORKER_TOKEN = "h3-test-token-that-is-longer-than-thirty-two-characters";
process.env.MINIMAX_H3_OPENRELAY_WORKER_URL = "https://yt-minimax-h3-a100-fallback.run.openrelay.inc/v1/videos";

let status = "stopped";
const vm = () => ({
  id: process.env.MINIMAX_H3_OPENRELAY_VM_ID,
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "yt-minimax-h3-a100-fallback",
  status,
  endpointUrl: "yt-minimax-h3-a100-fallback.run.openrelay.inc",
  public: false,
  gpuModelId: "33333333-3333-4333-8333-333333333333",
  gpuModelName: "NVIDIA A100",
  gpuCount: 1,
  diskSizeGb: OPENRELAY_H3_DISK_SIZE_GB,
  pricePerHourCents: 44,
  imageUrl: "docker.io/pytorch/pytorch@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

const health = {
  schema: "minimax-h3-worker/v1", ready: true, persistentCacheReady: true,
  busy: false, draining: false, idleSeconds: 301,
};

const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/restart")) { status = "running"; return new Response(JSON.stringify(vm())); }
  if (url.endsWith("/stop")) { status = "stopped"; return new Response(JSON.stringify(vm())); }
  if (url.includes("/v1/vms/")) return new Response(JSON.stringify(vm()));
  if (url.endsWith("/healthz")) return new Response(JSON.stringify(health));
  if (url.endsWith("/control/drain")) {
    assert.equal(new Headers(init?.headers).get("x-worker-authorization"), `Bearer ${process.env.MINIMAX_H3_OPENRELAY_WORKER_TOKEN}`);
    return new Response(JSON.stringify({ draining: true }));
  }
  throw new Error(`unexpected OpenRelay test URL: ${url}`);
};

async function main() {
  const ready = await ensureOpenRelayH3Ready({ fetchImpl, wait: async () => {} });
  assert.equal(ready.persistentCacheReady, true);
  assert.equal((await fetchOpenRelayH3Health(fetchImpl)).ready, true);
  assert.equal(await drainOpenRelayH3Worker(fetchImpl), true);
  console.log("OpenRelay H3 persistent lifecycle contracts passed");
}

void main().finally(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
