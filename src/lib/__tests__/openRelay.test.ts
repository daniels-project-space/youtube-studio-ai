import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
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

  const requestId = "2a92881d-6be8-4b35-a6ff-fbd5264bd042";
  for (const body of [
    JSON.stringify({ code: "FORBIDDEN", requestId, error: `Bearer ${key}` }),
    JSON.stringify({ code: key, requestId: key, error: key }),
    `<html>${key}</html>`,
    JSON.stringify({ code: "FORBIDDEN", requestId, error: key.repeat(100) }),
  ]) {
    let attempts = 0;
    let redirect: RequestRedirect | undefined;
    const denied = new OpenRelayVmClient({ apiKey: key, fetchImpl: async (_url, init) => {
      attempts++;
      redirect = init?.redirect;
      return new Response(body, { status: 403 });
    } });
    await assert.rejects(() => denied.restartVm(vm.id), (error: unknown) => {
      assert.ok(error instanceof OpenRelayApiError);
      assert.equal(error.status, 403);
      assert.ok(!error.message.includes(key));
      assert.ok(!error.message.includes("<html>"));
      const valid = body.length < 4096 && body.includes('"code":"FORBIDDEN"');
      assert.equal(error.message.includes("FORBIDDEN"), valid);
      assert.equal(error.message.includes(requestId), valid);
      return true;
    });
    assert.equal(attempts, 1, "authorization errors must not retry the write");
    assert.equal(redirect, "error", "control-plane credentials must not follow redirects");
  }

  const transportFailure = new OpenRelayVmClient({ apiKey: key, fetchImpl: async () => {
    const error = new Error(key);
    error.name = key;
    throw error;
  } });
  await assert.rejects(() => transportFailure.getVm(vm.id), (error: unknown) =>
    error instanceof OpenRelayApiError && error.status === 0 && !error.message.includes(key));

  const malformed = new OpenRelayVmClient({ apiKey: key,
    fetchImpl: async () => new Response(key, { status: 200 }),
  });
  await assert.rejects(() => malformed.getVm(vm.id), (error: unknown) =>
    error instanceof Error && !error.message.includes(key));

  let canceled = false;
  let pulls = 0;
  const oversized = new OpenRelayVmClient({ apiKey: key, fetchImpl: async () =>
    new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024).fill(32)); },
      cancel() { canceled = true; },
    }), { status: 403 }),
  });
  await assert.rejects(() => oversized.getVm(vm.id), (error: unknown) =>
    error instanceof OpenRelayApiError && error.message === "OpenRelay get VM failed with HTTP 403");
  assert.equal(canceled, true, "oversized provider bodies must be canceled");
  assert.ok(pulls <= 6, "error diagnostics must stop reading after 4 KiB");

  let redirected = false;
  let redirectResponse = false;
  const server = createServer((req, res) => {
    if (req.url === "/credential-sink") redirected = true;
    if (redirectResponse) {
      res.writeHead(307, { location: "/credential-sink" }).end();
    } else {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "FORBIDDEN", requestId, error: req.headers.authorization }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const live = new OpenRelayVmClient({ apiKey: key, baseUrl: `http://127.0.0.1:${address.port}` });
    await assert.rejects(() => live.restartVm(vm.id), (error: unknown) => {
      assert.ok(error instanceof OpenRelayApiError);
      assert.equal(error.status, 403);
      assert.ok(error.message.includes(requestId));
      assert.ok(!error.message.includes(key));
      return true;
    });
    redirectResponse = true;
    await assert.rejects(() => live.restartVm(vm.id), (error: unknown) =>
      error instanceof OpenRelayApiError && error.status === 0 && !error.message.includes(key));
    assert.equal(redirected, false, "actual fetch must not follow a control-plane redirect");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  const rejected = new OpenRelayVmClient({
    apiKey: key,
    fetchImpl: async () => new Response("placement refused", { status: 409 }),
  });
  await assert.rejects(() => rejected.stopVm(vm.id), (error: unknown) => error instanceof OpenRelayApiError && error.status === 409);
  console.log("OPENRELAY VM CONTROL CONTRACT PASS");
}

void main();
