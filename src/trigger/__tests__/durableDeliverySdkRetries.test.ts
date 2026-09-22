import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { apiClientManager, type ApiRequestOptions } from "@trigger.dev/core/v3";
import { bundleFanoutEnvelope, bundleFanoutDispatchSchedule } from "@/lib/bundleFanout";
import { serializedProgramEpisodeBusyRetrySchedule } from "@/lib/serializedProgramEpisode";

function actualRequestOptions(file: string): ApiRequestOptions {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "tasks.trigger") calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.length, 4, "real dispatch call must override SDK retries explicitly");
  return new Function(`return (${calls[0].arguments[3].getText(source)});`)() as ApiRequestOptions;
}

test("installed SDK makes one durable delivery attempt, preserving identity after a lost response", async () => {
  let mode: "unavailable" | "rate-limit" | "lost" | "success" = "unavailable";
  const received: { payload: unknown; options: Record<string, unknown> }[] = [];
  const accepted = new Set<string>();
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/api/v1/tasks/run-pipeline/trigger");
    assert.equal(request.headers.authorization, "Bearer tr_test_fixture_only");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    received.push(body);
    response.setHeader("Content-Type", "application/json");
    if (mode === "unavailable" || mode === "rate-limit") {
      response.statusCode = mode === "unavailable" ? 503 : 429;
      response.end(JSON.stringify({ error: "fixture temporary failure" }));
      return;
    }
    const key = body.options.idempotencyKey as string;
    const reused = accepted.has(key);
    accepted.add(key);
    if (mode === "lost") { request.socket.destroy(); return; }
    response.setHeader("x-trigger-jwt", "fixture-public-token");
    response.end(JSON.stringify({ id: "run_fixture", isCached: reused }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await apiClientManager.runWithConfig({ baseURL: `http://127.0.0.1:${address.port}`, accessToken: "tr_test_fixture_only",
      requestOptions: { retry: { maxAttempts: 5, minTimeoutInMs: 1, maxTimeoutInMs: 1, factor: 1, randomize: false } },
    }, async () => {
      await assert.rejects(tasks.trigger("run-pipeline", { fixture: "control" }));
      assert.equal(received.length, 5, "control confirms inherited retry amplification in the installed SDK");
      const envelope = bundleFanoutEnvelope({ ownerId: "owner-fixture", baseRunId: "base", baseChannelId: "base-channel",
        siblingChannelId: "sibling", reuse: { language: "fr", footageKeys: [], musicKey: "retained-music" } });
      const schedules = [
        { file: "bundleFanoutDispatcher", request: bundleFanoutDispatchSchedule({ runId: "child", envelope }) },
        { file: "serializedProgramEpisodeRetryDispatcher", request: serializedProgramEpisodeBusyRetrySchedule({
          payload: { channelId: "channel", runId: "serialized", invocationSha256: "a".repeat(64) },
          channelId: "channel", runId: "serialized", retryAt: 2_000_000, attempt: 1,
        }) },
      ];
      for (const { file, request } of schedules) {
        const requestOptions = actualRequestOptions(`src/trigger/${file}.ts`);
        const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
        const options = { idempotencyKey, concurrencyKey: request.concurrencyKey, version: "fixture-worker-v1" };
        let firstBody: typeof received[number] | undefined;
        for (const failure of ["unavailable", "rate-limit", "lost"] as const) {
          mode = failure;
          const before: number = received.length;
          await assert.rejects(tasks.trigger("run-pipeline", request.payload, options, requestOptions));
          assert.equal(received.length, before + 1, `${file}: ${failure} must not multiply HTTP attempts`);
          firstBody ??= received.at(-1)!;
          assert.deepEqual(received.at(-1), firstBody, "uncertain delivery retains exact payload, key and worker pin");
          assert.equal(firstBody.options.lockToVersion, "fixture-worker-v1");
        }
        const acceptedBefore = accepted.size;
        mode = "success";
        const result = await tasks.trigger("run-pipeline", request.payload, {
          ...options, idempotencyKey: await idempotencyKeys.create(request.idempotencySeed, { scope: "global" }),
        }, requestOptions);
        assert.equal(result.id, "run_fixture");
        assert.deepEqual(received.at(-1), firstBody);
        assert.equal(accepted.size, acceptedBefore, "later delivery resolves the already-accepted fixture identity");
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
