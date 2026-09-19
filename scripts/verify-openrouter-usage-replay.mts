/** Read-only replay of retained provider bytes. No live transport or writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { OpenRouterJsonSchema } from "../src/lib/openRouter";

// Match the application's CJS/alias module identity so this ESM diagnostic
// observes the same AsyncLocalStorage instance as the real transport.
const require = createRequire(import.meta.url);
const moduleRoot = resolve(process.env.ACCOUNTING_REPLAY_MODULE_ROOT ?? process.cwd());
const jsonObjectOnly = process.argv.includes("--json-object-only");
assert.ok(process.argv.slice(2).every(arg => arg === "--json-object-only"), "unknown replay option");
const { createModelUsageScope } = require(join(moduleRoot, "src/lib/modelUsage")) as typeof import("../src/lib/modelUsage");
const { openRouterChat } = require(join(moduleRoot, "src/lib/openRouter")) as typeof import("../src/lib/openRouter");

type Row = Record<string, unknown>;
const root = join(process.cwd(), "test-fixtures/title-pilot-2026-09");
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".jsonl") ? [join(directory, entry.name)] : []);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_API_KEY = "offline-retained-response-only";
const ids = new Set<string>();
let count = 0, schemaResponsesExcluded = 0, providerReportedUsd = 0, replayAccountedUsd = 0, reasoningTokens = 0;
try {
  for (const file of files(root)) {
    const rows = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line) as Row);
    if (rows.find(row => row.type === "experiment")?.mode !== "live") continue;
    for (const response of rows.filter(row => row.type === "response")) {
      const rawBody = String(response.rawBody);
      assert.equal(hash(rawBody), response.rawBodySha256, "retained response bytes changed");
      const request = rows.find(row => row.type === "request" && row.index === response.index);
      assert.ok(request);
      const body = request.body as Row;
      assert.equal(hash(JSON.stringify(body)), request.requestSha256);
      assert.equal(request.requestSha256, response.requestSha256);
      const format = body.response_format as { type?: string; json_schema?: OpenRouterJsonSchema } | undefined;
      if (jsonObjectOnly && format?.type !== "json_object") {
        assert.equal(format?.type, "json_schema", "only the separately held structured-output experiments may be excluded");
        schemaResponsesExcluded++;
        continue;
      }
      const payload = JSON.parse(rawBody);
      assert.equal(typeof payload.id, "string");
      assert.ok(!ids.has(payload.id), "duplicate provider receipt would count spend twice");
      ids.add(payload.id);
      const usage = payload.usage;
      assert.equal(payload.model, "google/gemini-3.7-flash");
      assert.ok(Number.isFinite(usage.cost) && usage.cost >= 0);
      let dispatches = 0;
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(init?.method, "POST");
        assert.equal(hash(String(init?.body)), request.requestSha256, "replay must use the exact historical request, not a rewritten prompt");
        dispatches++;
        return new Response(rawBody, { status: Number(response.status), headers: { "content-type": "application/json" } });
      };
      const scope = createModelUsageScope();
      await scope.run(() => openRouterChat({
        model: String(body.model), messages: body.messages as Parameters<typeof openRouterChat>[0]["messages"],
        maxTokens: Number(body.max_tokens),
        ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
        json: format?.type === "json_object",
        ...(format?.type === "json_schema" ? { jsonSchema: format.json_schema } : {}),
      }));
      const result = scope.snapshot();
      assert.equal(dispatches, 1);
      assert.equal(result.calls, 1, "the real transport must participate in the observed accounting scope");
      assert.equal(result.unpricedCalls, 0);
      const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0;
      assert.equal(result.reasoningTokens, reasoning);
      assert.equal(result.outputTokens + result.reasoningTokens, usage.completion_tokens);
      assert.equal(result.totalTokens, usage.total_tokens);
      close(result.costUsd, usage.cost);
      providerReportedUsd += usage.cost; replayAccountedUsd += result.costUsd;
      reasoningTokens += result.reasoningTokens; count++;
    }
  }
  assert.equal(count, jsonObjectOnly ? 30 : 66, "all retained responses in the explicit replay scope must be verified");
  assert.equal(schemaResponsesExcluded, jsonObjectOnly ? 36 : 0);
  if (!jsonObjectOnly) close(providerReportedUsd, 0.1895565);
  close(replayAccountedUsd, providerReportedUsd);
  console.log(JSON.stringify({ responses: count, schemaResponsesExcluded, moduleRoot,
    clientSha256: hash(readFileSync(join(moduleRoot, "src/lib/openRouter.ts"), "utf8")),
    providerReportedUsd, replayAccountedUsd, reasoningTokens,
    requestAndResponseHashesVerified: true, liveRequests: 0, historicalWrites: 0 }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
}
