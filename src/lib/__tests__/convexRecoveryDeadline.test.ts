import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { makeFunctionReference } from "convex/server";
import { StudioConvexHttpClient } from "../studioConvexHttpClient";

const query = makeFunctionReference<"query">("fixture:read");
const mutation = makeFunctionReference<"mutation">("fixture:write");

test("real Convex transport aborts stalled headers and bodies without retrying mutations", async () => {
  let mode: "normal" | "headers" | "body" | "lateCommit" = "normal";
  const requests: { path: string; authorization?: string }[] = [];
  let committed = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { void _chunk; }
    requests.push({ path: request.url!, authorization: request.headers.authorization });
    if (mode === "headers") return;
    response.setHeader("Content-Type", "application/json");
    if (mode === "body") { response.write('{"status":"success","value":'); return; }
    if (mode === "lateCommit") { await delay(100); committed++; }
    response.end(JSON.stringify({ status: "success", value: ["retained"] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const config = { auth: "fixture-only-not-a-secret", skipConvexDeploymentUrlCheck: true };
  const client = new StudioConvexHttpClient(url, { ...config, requestTimeoutMs: 50 });
  try {
    assert.deepEqual(await new StudioConvexHttpClient(url, config).query(query, {}), ["retained"]);
    for (const stalled of ["headers", "body"] as const) {
      mode = stalled;
      const before = requests.length;
      const started = performance.now();
      await assert.rejects(client.query(query, {}), /abort|timeout/i);
      assert.ok(performance.now() - started < 2000, "body reads share the original request deadline");
      assert.equal(requests.length, before + 1, "timeouts cannot cause hidden transport retries");
    }
    mode = "lateCommit";
    const before = requests.length;
    await assert.rejects(client.mutation(mutation, {}), /abort|timeout/i);
    await delay(120);
    assert.equal(committed, 1, "timeout is not proof of server rollback");
    assert.equal(requests.length, before + 1, "an ambiguous mutation is never automatically resubmitted");
    mode = "normal";
    assert.deepEqual(await client.mutation(mutation, {}), ["retained"], "timed-out mutation releases the client queue");
    assert.deepEqual(await client.query(query, {}), ["retained"], "each request gets a fresh deadline");
    assert.ok(requests.every(row => row.authorization === `Bearer ${config.auth}`));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("opt-in deadline preserves caller cancellation and legacy transport behavior", async () => {
  for (const requestTimeoutMs of [undefined, 30_000]) {
    const caller = new AbortController();
    let observed: AbortSignal | null | undefined;
    const client = new StudioConvexHttpClient("https://fixture.convex.cloud", {
      auth: "fixture-only", requestTimeoutMs,
      fetch: async (_input, init) => {
        observed = init?.signal;
        caller.abort();
        assert.equal(observed?.aborted, true);
        throw caller.signal.reason;
      },
    });
    // Convex's runtime accepts standard fetch options; its public typings omit
    // this internal hook, so exercise the exact installed method deliberately.
    (client as unknown as { setFetchOptions(options: RequestInit): void }).setFetchOptions({ signal: caller.signal });
    await assert.rejects(client.query(query, {}), /abort/i);
    if (requestTimeoutMs === undefined) assert.equal(observed, caller.signal);
    else assert.notEqual(observed, caller.signal);
  }
  for (const requestTimeoutMs of [0, -1, NaN, Infinity, 0.5, 2 ** 31]) {
    assert.throws(() => new StudioConvexHttpClient("https://fixture.convex.cloud", {
      auth: "fixture-only", requestTimeoutMs,
    }), /timeout/);
  }
});

test("all six delivery owners opt in without changing the shared aggregate deadline", () => {
  for (const name of ["bundleFanout", "factualReviewContinuation", "musicAuditionContinuation",
    "reviewedDataStoryInitial", "routeQualificationBenchmark", "serializedProgramEpisodeRetry"]) {
    const source = readFileSync(`src/trigger/${name}Dispatcher.ts`, "utf8");
    assert.match(source, /new ConvexHttpClient\(url!?, \{ requestTimeoutMs: 30_000 \}\)/);
  }
  assert.doesNotMatch(readFileSync("src/trigger/sharedDeliveryRecovery.ts", "utf8"), /maxDuration\s*:/);
});
