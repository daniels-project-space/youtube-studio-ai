import assert from "node:assert/strict";
import { createModelUsageScope } from "@/lib/modelUsage";
import { OPENROUTER_MODELS, openRouterChat } from "@/lib/openRouter";

// The native OpenRouter completion total already includes reasoning. Exercise
// the actual transport/accounting boundary, not a duplicated pricing helper.
async function main() {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "hermetic-no-network-key";
  const failures: string[] = [];
  const run = async (name: string, usage: Record<string, unknown>, check: (value: ReturnType<ReturnType<typeof createModelUsageScope>["snapshot"]>, logs: string[]) => void) => {
    let requests = 0;
    const logs: string[] = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, OPENROUTER_MODELS.intelligence);
      assert.equal(body.max_tokens, 200, "accounting must not change output quality/limits");
      requests++;
      return Response.json({ id: "normalization-fixture", model: body.model, usage,
        choices: [{ message: { content: '{"ok":true}' } }] });
    };
    const scope = createModelUsageScope();
    await scope.run(() => openRouterChat({ model: OPENROUTER_MODELS.intelligence,
      messages: [{ role: "user", content: "Hermetic usage normalization check" }],
      maxTokens: 200, json: true, log: line => logs.push(line) }));
    assert.equal(requests, 1, "no usage lookup or provider replay is required");
    try { check(scope.snapshot(), logs); }
    catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const tokens = { prompt_tokens: 100, completion_tokens: 196, total_tokens: 296 };
  const pricedReasoning = (value: ReturnType<ReturnType<typeof createModelUsageScope>["snapshot"]>, logs: string[]) => {
    assert.ok(Math.abs(value.costUsd - 0.00081) < 1e-12, `inclusive completion price: ${value.costUsd} != 0.00081`);
    assert.equal(value.outputTokens, 7, "visible output excludes the 189 reasoning tokens");
    assert.equal(value.reasoningTokens, 189);
    assert.equal(value.totalTokens, 296);
    assert.equal(value.unpricedCalls, 0);
    assert.ok(logs.some(line => line.includes("189 of the 200-token ceiling")), "the actual nested breakdown must trigger the starvation warning");
  };
  try {
    await run("native nested breakdown", { ...tokens, completion_tokens_details: { reasoning_tokens: 189 } }, pricedReasoning);
    await run("legacy flat breakdown", { ...tokens, reasoning_tokens: 189 }, pricedReasoning);
    await run("both consistent shapes", { ...tokens, reasoning_tokens: 189, completion_tokens_details: { reasoning_tokens: 189 } }, pricedReasoning);
    await run("derived total", { prompt_tokens: 100, completion_tokens: 196, completion_tokens_details: { reasoning_tokens: 189 } }, pricedReasoning);
    await run("optional breakdown absent", tokens, (value, logs) => {
      assert.ok(Math.abs(value.costUsd - 0.00081) < 1e-12);
      assert.equal(value.outputTokens, 196);
      assert.equal(value.reasoningTokens, 0);
      assert.equal(value.unpricedCalls, 0);
      assert.ok(!logs.some(line => line.includes("STARVATION RISK")));
    });
    for (const [name, detail] of [
      ["negative reasoning", { reasoning_tokens: -1 }],
      ["reasoning exceeds completion", { reasoning_tokens: 197 }],
      ["fractional reasoning", { reasoning_tokens: 1.5 }],
      ["string reasoning", { reasoning_tokens: "189" }],
    ] as const) await run(name, { ...tokens, completion_tokens_details: detail }, value => {
      assert.equal(value.unpricedCalls, 1, "invalid provider accounting cannot be treated as fully priced");
      assert.ok(Math.abs(value.costUsd - 0.00081) < 1e-12, "retain the known inclusive-completion charge while holding malformed detail");
    });
    await run("conflicting breakdowns", { ...tokens, reasoning_tokens: 10, completion_tokens_details: { reasoning_tokens: 189 } }, value => {
      assert.equal(value.unpricedCalls, 1, "conflicting provider evidence must be explicit");
      assert.ok(Math.abs(value.costUsd - 0.00081) < 1e-12);
    });
    for (const detail of [[], "invalid", false]) await run("malformed detail object", { ...tokens, completion_tokens_details: detail }, value => {
      assert.equal(value.unpricedCalls, 1);
      assert.ok(Math.abs(value.costUsd - 0.00081) < 1e-12);
    });
    for (const completion of [undefined, null, -1, 1.5, "196", Number.MAX_SAFE_INTEGER + 1]) {
      await run("invalid completion total", { ...tokens, completion_tokens: completion }, value => {
        assert.equal(value.unpricedCalls, 1);
        assert.equal(value.costUsd, 0, "an invalid inclusive total cannot be converted to a guessed charge");
      });
    }
    await run("nullable detail with legacy evidence", { ...tokens, completion_tokens_details: null, reasoning_tokens: 189 }, pricedReasoning);
    assert.deepEqual(failures, []);
    console.log("OpenRouter inclusive completion, native/legacy reasoning, warning and malformed-usage contracts passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
