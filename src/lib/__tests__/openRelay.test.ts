import assert from "node:assert/strict";
import { OpenRelayApiError, OpenRelayVmClient } from "@/lib/openRelay";

const key = "openrelay-test-token-that-is-longer-than-thirty-two-characters";
const vm = {
  id: "12345678-1234-1234-1234-123456789abc",
  organizationId: "12345678-1234-1234-1234-123456789abc",
  name: "yt-qwen-3090",
  status: "running",
  endpointUrl: "https://8790-worker.run.openrelay.inc/",
  public: false,
  gpuModelId: "12345678-1234-1234-1234-123456789abc",
  gpuModelName: "RTX 3090",
  gpuCount: 1,
  diskSizeGb: 30,
  pricePerHourCents: 18,
  imageUrl: "ghcr.io/example/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const calls: Array<{ url: string; method: string; auth: string | null }> = [];
const client = new OpenRelayVmClient({
  apiKey: key,
  baseUrl: "https://provider.test/",
  fetchImpl: async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    return Response.json(vm);
  },
});

async function main() {
  assert.equal((await client.getVm(vm.id)).endpointUrl, vm.endpointUrl);
  assert.equal((await client.stopVm(vm.id)).status, "running");
  assert.equal((await client.restartVm(vm.id)).gpuModelName, "RTX 3090");
  assert.deepEqual(calls.map((call) => [call.url, call.method]), [
    ["https://provider.test/v1/vms/12345678-1234-1234-1234-123456789abc", "GET"],
    ["https://provider.test/v1/vms/12345678-1234-1234-1234-123456789abc/stop", "POST"],
    ["https://provider.test/v1/vms/12345678-1234-1234-1234-123456789abc/restart", "POST"],
  ]);
  assert.ok(calls.every((call) => call.auth === `Bearer ${key}`));
  assert.throws(() => client.getVm("not-a-vm"), /VM id is invalid/);

  const rejected = new OpenRelayVmClient({
    apiKey: key,
    fetchImpl: async () => new Response("placement refused", { status: 409 }),
  });
  await assert.rejects(() => rejected.stopVm(vm.id), (error: unknown) => error instanceof OpenRelayApiError && error.status === 409);
  console.log("OPENRELAY VM CONTROL CONTRACT PASS");
}

void main();
