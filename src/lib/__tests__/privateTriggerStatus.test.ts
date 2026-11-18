import assert from "node:assert/strict";
import http from "node:http";
import Module from "node:module";
import { ApiClient } from "@trigger.dev/core/v3";
import { retrievePrivateTriggerStatus } from "../privateTriggerStatus";

const secret = "synthetic-secret-never-returned";
const fixture = {
  id: "run_synthetic", status: "COMPLETED", taskIdentifier: "design-channel",
  isQueued: false, isExecuting: false, isWaiting: false, isCompleted: true,
  isSuccess: true, isFailed: false, isCancelled: false, isTest: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  tags: [], costInCents: 0, baseCostInCents: 0, durationMs: 1,
  depth: 0, triggerFunction: "trigger", relatedRuns: {}, output: { slug: "fixture" },
};

async function main() {
  let mode = "ok", requests = 0, leaked = 0;
  const server = http.createServer((request, response) => {
    requests++;
    if (request.url === "/leak") { leaked++; response.end("unexpected"); return; }
    assert.equal(request.url, "/api/v3/runs/run_synthetic");
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    if (mode === "redirect") { response.writeHead(302, { Location: "/leak" }); response.end(); return; }
    if (mode === "failure") { response.writeHead(500); response.end(secret); return; }
    if (mode === "malformed") { response.end("not-json"); return; }
    if (mode === "oversized") { response.end("x".repeat(2 * 1024 * 1024 + 1)); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(mode === "presigned" ? { ...fixture, output: undefined, outputPresignedUrl: "https://example.invalid/output" } : fixture));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const env = { TRIGGER_API_URL: origin, TRIGGER_SECRET_KEY: secret };
  try {
    const actual = await retrievePrivateTriggerStatus(env, "run_synthetic");
    const sdk = await new ApiClient(origin, secret).retrieveRun("run_synthetic");
    assert.deepEqual(actual, { status: sdk.status, output: sdk.output, error: sdk.error ?? null });
    assert.deepEqual(await retrievePrivateTriggerStatus({ ...env, TRIGGER_API_URL: `http://localhost:${address.port}` }, "run_synthetic"), actual);
    const before = requests;
    for (const target of [undefined, "https://api.trigger.dev", "http://example.com", `${origin}/path`]) {
      await assert.rejects(() => retrievePrivateTriggerStatus({ ...env, TRIGGER_API_URL: target }, "run_synthetic"));
    }
    await assert.rejects(() => retrievePrivateTriggerStatus(env, "../escape"));
    assert.equal(requests, before, "invalid targets and run IDs must not contact a server");
    for (mode of ["redirect", "failure", "malformed", "oversized", "presigned"]) {
      await assert.rejects(() => retrievePrivateTriggerStatus(env, "run_synthetic"), error => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /synthetic-secret|example\.invalid/);
        if (mode === "presigned") assert.match(error.message, /separately stored output/);
        return true;
      });
    }
    assert.equal(leaked, 0, "redirect must never be followed");

    const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
    const original = loader._load;
    loader._load = function(name, ...args) {
      if (name === "@/lib/operatorSession") return { authorizeStudioRoute: async () => null };
      return original.call(this, name, ...args);
    };
    try {
      process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
      process.env.TRIGGER_API_URL = origin;
      process.env.TRIGGER_SECRET_KEY = secret;
      const { GET } = await import("../../app/api/build-channel/route");
      const request = () => new Request("http://localhost/api/build-channel?id=run_synthetic");
      mode = "ok";
      const success = await GET(request());
      assert.equal(success.status, 200);
      assert.deepEqual(await success.json(), actual);
      mode = "failure";
      const failed = await GET(request());
      assert.equal(failed.status, 503);
      assert.doesNotMatch(await failed.text(), /synthetic-secret/);
      mode = "presigned";
      const presigned = await GET(request());
      assert.equal(presigned.status, 503);
      assert.match((await presigned.json()).error, /separately stored output/);
      process.env.TRIGGER_API_URL = "https://api.trigger.dev";
      assert.equal((await GET(request())).status, 503);
      assert.equal(leaked, 0);
      delete process.env.YOUTUBE_AUTOMATION_PRIVATE;
      const originalFetch = globalThis.fetch;
      let cloudUrl = "";
      globalThis.fetch = (async (input: string | URL | Request) => {
        cloudUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      try {
        const cloud = await GET(request());
        assert.equal(cloud.status, 200);
        assert.deepEqual(await cloud.json(), actual);
        assert.equal(new URL(cloudUrl).origin, "https://api.trigger.dev");
      } finally { globalThis.fetch = originalFetch; }
    } finally { loader._load = original; }
    console.log("Private status matches SDK inline output and refuses invalid targets, redirects and presigned output");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
