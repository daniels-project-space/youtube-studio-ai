import assert from "node:assert/strict";
import {
  drainOpenRelayH3Worker,
  ensureOpenRelayH3Ready,
  fetchOpenRelayH3Health,
  openRelayH3ProfileForDuration,
  reconcileOpenRelayH3Render,
  submitOpenRelayH3Render,
  type OpenRelayH3RenderRequest,
} from "@/lib/openRelayH3";

const saved = { ...process.env };
const vm = {
  id: "79d8390e-6ab8-457d-b4c4-0fd2d766662e",
  organizationId: "626c2959-4f58-4779-b867-2a74129e93e5",
  name: "yt-minimax-h3-a100-persistent",
  status: "running",
  endpointUrl: "https://yt-minimax-h3-a100-persistent-mu7qosm1.run.openrelay.inc/",
  public: false,
  gpuModelId: "12345678-1234-1234-1234-123456789abc",
  gpuModelName: "NVIDIA A100 80GB PCIe",
  gpuCount: 1,
  diskSizeGb: 150,
  pricePerHourCents: 98,
  imageUrl: "docker.io/pytorch/pytorch@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

process.env.OPENRELAY_API_KEY = "openrelay-test-token-that-is-longer-than-thirty-two-characters";
process.env.MINIMAX_H3_OPENRELAY_WORKER_TOKEN = "h3-test-token-that-is-longer-than-thirty-two-characters-123456";
process.env.MINIMAX_H3_OPENRELAY_VM_ID = vm.id;
process.env.MINIMAX_H3_OPENRELAY_WORKER_URL = "https://yt-minimax-h3-a100-persistent-mu7qosm1.run.openrelay.inc/v1/videos";
process.env.MINIMAX_H3_OPENRELAY_QUALIFIED = "1";
process.env.MINIMAX_H3_OPENRELAY_QUALIFICATION_RECEIPT_SHA256 = "e".repeat(64);

const health = {
  schema: "minimax-h3-worker/v1",
  ready: true,
  route: "minimax-h3-turbo8-a100",
  profile: "official-turbo8-native-768p",
  modelLoad: "per-job-high-vram",
  persistentCacheReady: true,
  busy: false,
  draining: false,
  idleSeconds: 301,
};

const request: OpenRelayH3RenderRequest = {
  schema: "minimax-h3-worker/v1",
  request_key: "a".repeat(64),
  prompt: "A short, deterministic test prompt.",
  seed: 7,
  first_frame_key: "h3/input.png",
  first_frame_url: "https://objects.example.test/h3/input.png?signature=redacted",
  first_frame_sha256: "b".repeat(64),
  output_key: "h3/output.mp4",
  output_put_url: "https://objects.example.test/h3/output.mp4?signature=redacted",
  execution: "on-demand",
  capacity_mode: "persistent-disk-auto-stop",
  profile: { id: "official-turbo8-native-768p", width: 1344, height: 768, fps: 24, frames: 124, steps: 8 },
  max_cost_usd: 0.5,
};

const receipt = {
  schema: "minimax-h3-worker/v1",
  requestKey: request.request_key,
  jobId: "h3-job-1",
  execution: request.execution,
  profile: request.profile,
  promptSha256: "c".repeat(64),
  seed: request.seed,
  firstFrame: { r2Key: request.first_frame_key, sha256: request.first_frame_sha256 },
  output: { r2Key: request.output_key, contentSha256: "d".repeat(64), byteLength: 123, contentType: "video/mp4" },
  runtime: {
    provider: "openrelay",
    gpuModel: "A100",
    runtimeId: "minimax-h3-turbo8-a100-v1",
    modelManifestSha256: "1e1b44f69249511e8e7308e5ceb9c9fa60efff4abde37f200dc33f28345b5ae3",
    capacityMode: "persistent-disk-auto-stop",
    costUsd: 0.42,
  },
};

async function main() {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string | undefined }> = [];
  let vmGets = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body ? String(init.body) : undefined });
    if (url.endsWith(`/v1/vms/${vm.id}`)) {
      vmGets++;
      return Response.json({ ...vm, status: vmGets === 1 ? "stopped" : "running" });
    }
    if (url.endsWith(`/v1/vms/${vm.id}/restart`)) return Response.json({ ...vm, status: "deploying" });
    if (url.endsWith("/healthz")) return Response.json(health);
    if (url.endsWith("/control/drain")) return Response.json({ draining: true });
    if (url.endsWith(`/v1/videos/${request.request_key}`)) return Response.json({ status: "complete", receipt });
    if (url.endsWith("/v1/videos") && init?.method === "POST") {
      const submitted = JSON.parse(String(init.body)) as OpenRelayH3RenderRequest;
      return Response.json({ receipt: { ...receipt, profile: submitted.profile } });
    }
    throw new Error(`unexpected request ${url}`);
  };

  assert.equal((await ensureOpenRelayH3Ready({ fetchImpl, wait: async () => {} })).route, health.route);
  assert.ok(calls.some((call) => call.url.endsWith("/restart") && call.method === "POST"));
  assert.equal((await fetchOpenRelayH3Health(fetchImpl)).persistentCacheReady, true);
  assert.equal(await drainOpenRelayH3Worker(fetchImpl), true);
  assert.equal((await submitOpenRelayH3Render(request, fetchImpl)).runtime.gpuModel, "A100");
  assert.equal(openRelayH3ProfileForDuration(10).profile.frames, 243);
  assert.equal(openRelayH3ProfileForDuration(15).nativeDurationSec, 14.375);
  assert.equal(
    (await submitOpenRelayH3Render({ ...request, profile: openRelayH3ProfileForDuration(15).profile }, fetchImpl)).profile.frames,
    345,
  );
  assert.throws(() => openRelayH3ProfileForDuration(12), /native 5, 10, or up-to-15/i);
  await assert.rejects(
    submitOpenRelayH3Render({ ...request, max_cost_usd: 0.51 }, fetchImpl),
    /sealed worker contract/i,
  );
  assert.equal((await reconcileOpenRelayH3Render(request, fetchImpl)).status, "complete");
  const renderCall = calls.find((call) => call.url.endsWith("/v1/videos") && call.method === "POST");
  assert.equal(renderCall?.headers.get("x-worker-authorization"), `Bearer ${process.env.MINIMAX_H3_OPENRELAY_WORKER_TOKEN}`);
  assert.equal(JSON.parse(renderCall?.body ?? "{}").request_key, request.request_key);
  console.log("OPENRELAY H3 LIFECYCLE CONTRACT PASS");
}

void main().finally(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
});
