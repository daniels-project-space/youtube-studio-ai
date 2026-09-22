import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { api } from "../../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

test("six actual recovery handlers share bounded HTTP, isolate a stalled outbox, and tolerate overlapping idle ticks", async () => {
  let stalled: "none" | "headers" | "body" = "none";
  const calls: string[] = [];
  let clients = 0;
  let providerCalls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const { path } = JSON.parse(Buffer.concat(chunks).toString()) as { path: string };
    calls.push(path);
    assert.equal(request.headers.authorization, "Bearer fixture-only");
    if (path === "musicAuditionCheckpoints:prepareResumeDispatch" && stalled !== "none") {
      if (stalled === "body") {
        response.setHeader("Content-Type", "application/json");
        response.write('{"status":"success","value":');
      }
      return;
    }
    const value = path.endsWith(":prepareResumeDispatch")
      ? { recovery: { requeued: 0, blocked: 0 }, pending: [], yue2Pending: [] }
      : path.endsWith(":reapExpiredQueued") ? { checked: 0, requeued: 0, blocked: 0 } : [];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "success", value }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  class FixtureClient extends StudioConvexHttpClient {
    constructor(target: string, options?: { requestTimeoutMs?: number }) {
      assert.equal(target, url);
      assert.equal(options?.requestTimeoutMs, 30_000, "every real delivery constructor must opt in");
      clients++;
      super(target, { auth: "fixture-only", skipConvexDeploymentUrlCheck: true, requestTimeoutMs: 200 });
    }
  }
  const loaded = new Map<string, Record<string, unknown>>();
  const forbidden = () => { providerCalls++; throw new Error("No generation, enqueue or creative planning in an idle recovery tick"); };
  const load = (file: string): Record<string, unknown> => {
    if (loaded.has(file)) return loaded.get(file)!;
    const compiled = ts.transpileModule(readFileSync(`src/trigger/${file}.ts`, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const evaluated = { exports: {} as Record<string, unknown> };
    const requireFixture = (name: string): unknown => {
      if (name === "@trigger.dev/sdk") return { schedules: { task: (value: unknown) => value },
        tasks: { trigger: forbidden }, idempotencyKeys: { create: forbidden } };
      if (name === "../../convex/_generated/api") return { api };
      if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: FixtureClient };
      if (name === "@/lib/deliveryRecoveryMode") return { deliveryRecoveryMode: () => "shared" };
      if (name.startsWith("./") && name.endsWith("Dispatcher")) return load(name.slice(2));
      return new Proxy({}, { get: () => forbidden });
    };
    new Function("require", "module", "exports", "process", compiled)(requireFixture, evaluated, evaluated.exports,
      { env: { NEXT_PUBLIC_CONVEX_URL: url } });
    loaded.set(file, evaluated.exports);
    return evaluated.exports;
  };
  const task = load("sharedDeliveryRecovery").sharedDeliveryRecovery as { run(): Promise<Record<string, { triggered: number }>> };
  const expected = ["runs:listDueBundleFanoutDispatches", "runs:listDueSerializedProgramEpisodeRetries",
    "factualReviewCheckpoints:prepareResumeDispatch", "musicAuditionCheckpoints:prepareResumeDispatch",
    "reviewedDataStoryRunAdmissions:reapExpiredQueued", "reviewedDataStoryRunAdmissions:listPending",
    "routeQualificationBenchmarkRuns:reapExpiredQueued", "routeQualificationBenchmarkRuns:listPending"].sort();
  try {
    const [first, second] = await Promise.all([task.run(), task.run()]);
    assert.equal(clients, 12);
    assert.deepEqual(calls.slice().sort(), [...expected, ...expected].sort());
    assert.equal(Object.keys(first).length, 6);
    assert.deepEqual(first, second);
    assert.ok(Object.values(first).every(result => result.triggered === 0));
    for (const failure of ["headers", "body"] as const) {
      calls.length = 0;
      stalled = failure;
      await assert.rejects(task.run(), /^Error: Delivery recovery failed for: music$/);
      assert.deepEqual(calls.slice().sort(), expected, "a stalled music preparation cannot suppress other outboxes");
    }
    calls.length = 0;
    stalled = "none";
    assert.deepEqual(await task.run(), first, "later tick recovers without stale aborted signals");
    assert.deepEqual(calls.slice().sort(), expected);
    assert.equal(providerCalls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
