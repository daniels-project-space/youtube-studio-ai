import assert from "node:assert/strict";
import { createModelUsageScope, priceModelUsage, type ModelUsageRecord } from "@/lib/modelUsage";
import { OPENROUTER_MODELS, openRouterChat } from "@/lib/openRouter";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";

// Real transport and accountant, deterministic response boundary. No live
// request, price lookup, provider fallback or historical receipt mutation.
async function main() {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "offline-reported-charge-fixture";
  const tokens = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
    completion_tokens_details: { reasoning_tokens: 190 } };
  const cases: { name: string; usage: Record<string, unknown>; cost: number; incomplete?: boolean; model?: string }[] = [
    { name: "standard", usage: { ...tokens, cost: 0.0015, is_byok: false }, cost: 0.0015 },
    { name: "discounted", usage: { ...tokens, cost: 0.00075, is_byok: false }, cost: 0.00075 },
    { name: "higher rate", usage: { ...tokens, cost: 0.0027, is_byok: false }, cost: 0.0027 },
    { name: "free reported charge", usage: { ...tokens, cost: 0, is_byok: false }, cost: 0 },
    { name: "upstream is included for credits", usage: { ...tokens, cost: 0.0015, is_byok: false,
      cost_details: { upstream_inference_cost: 0.0015 } }, cost: 0.0015 },
    { name: "cache discount already in bill", usage: { ...tokens, cost: 0.0004, is_byok: false,
      prompt_tokens_details: { cached_tokens: 999 } }, cost: 0.0004 },
    { name: "reported cost without configured model rate", model: "future/provider-model",
      usage: { ...tokens, cost: 0.002, is_byok: false }, cost: 0.002 },
    { name: "BYOK external bill plus router fee", usage: { ...tokens, cost: 0.00005, is_byok: true,
      cost_details: { upstream_inference_cost: 0.001 } }, cost: 0.00105 },
    { name: "BYOK free router fee is not free inference", usage: { ...tokens, cost: 0, is_byok: true,
      cost_details: { upstream_inference_cost: 0.001 } }, cost: 0.001 },
    { name: "BYOK missing external bill", usage: { ...tokens, cost: 0.00005, is_byok: true }, cost: 0.00005, incomplete: true },
    { name: "BYOK missing router fee", usage: { ...tokens, is_byok: true,
      cost_details: { upstream_inference_cost: 0.001 } }, cost: 0.001, incomplete: true },
    { name: "funding mode missing", usage: { ...tokens, cost: 0.001 }, cost: 0.001, incomplete: true },
    { name: "funding mode malformed", usage: { ...tokens, cost: 0.001, is_byok: "false" }, cost: 0.001, incomplete: true },
    { name: "malformed completion retains known charge", usage: { ...tokens, completion_tokens: "200", cost: 0.001, is_byok: false }, cost: 0.001, incomplete: true },
    { name: "malformed reasoning retains known charge", usage: { ...tokens, cost: 0.001, is_byok: false,
      completion_tokens_details: { reasoning_tokens: 201 } }, cost: 0.001, incomplete: true },
    { name: "legacy configured-rate compatibility", usage: tokens, cost: 0.0015 },
  ];
  for (const cost of [null, "0.001", -1, false, {}, Number.MAX_SAFE_INTEGER + 1]) cases.push({ name: "invalid credit charge " + JSON.stringify(cost),
    usage: { ...tokens, cost, is_byok: false }, cost: 0, incomplete: true });
  for (const upstream of [null, "0.001", -1, false]) cases.push({ name: "invalid upstream charge " + JSON.stringify(upstream),
    usage: { ...tokens, cost: 0.00005, is_byok: true, cost_details: { upstream_inference_cost: upstream } },
    cost: 0.00005, incomplete: true });
  const failures: string[] = [];
  try {
    for (const row of cases) {
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 200); assert.equal(body.model, OPENROUTER_MODELS.intelligence);
        calls++;
        return Response.json({ id: "cost-fixture", model: row.model ?? body.model, usage: row.usage,
          choices: [{ message: { content: "unchanged response" } }] });
      };
      const scope = createModelUsageScope();
      await scope.run(async () => assert.equal(await openRouterChat({ model: OPENROUTER_MODELS.intelligence,
        messages: [{ role: "user", content: "Exact cost boundary" }], maxTokens: 200 }), "unchanged response"));
      const actual = scope.snapshot();
      try {
        assert.equal(calls, 1, "no extra billing request or retry");
        assert.ok(Math.abs(actual.costUsd - row.cost) < 1e-12, `${actual.costUsd} != ${row.cost}`);
        assert.equal(actual.unpricedCalls, row.incomplete ? 1 : 0);
        assert.equal(actual.inputTokens, 1000); assert.equal(actual.totalTokens, 1200);
      } catch (error) { failures.push(row.name + ": " + String(error)); }
    }
    const native = { provider: "gemini", model: "gemini-2.5-flash", kind: "text" as const,
      inputTokens: 1000, outputTokens: 200, reasoningTokens: 50 };
    assert.equal(priceModelUsage(native).costUsd, 0.000925, "other providers retain separate output/reasoning pricing");
    for (const reportedCostUsd of [NaN, Infinity, -1, null, "0.01", Number.MAX_SAFE_INTEGER + 1]) {
      const priced = priceModelUsage({ ...native, reportedCostUsd } as ModelUsageRecord);
      assert.equal(priced.costUsd, undefined); assert.match(priced.unpricedReason!, /invalid USD charge/);
    }
    assert.deepEqual(priceModelUsage({ ...native, reportedCostUsd: 0.003, unpricedReason: "unknown extra fee" }),
      { costUsd: 0.003, unpricedReason: "unknown extra fee" }, "known charge survives incomplete detail");
    // The actual engine must persist the response-reported charge on both
    // success and downstream failure. This block is a test consumer, not a
    // claim that every existing composite cost patch has been qualified.
    for (const failAfterResponse of [false, true]) {
      const amount = failAfterResponse ? 0.0027 : 0.00075;
      let dispatches = 0;
      const stages: { status: string; cost?: number }[] = [];
      globalThis.fetch = async (url) => {
        assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions"); dispatches++;
        return Response.json({ id: "engine-charge", model: OPENROUTER_MODELS.intelligence,
          usage: { ...tokens, cost: amount, is_byok: false }, choices: [{ message: { content: "result" } }] });
      };
      _clear(); register({ id: "reported_charge_fixture", consumes: [], produces: ["result"], paid: true,
        run: async () => {
          const result = await openRouterChat({ model: OPENROUTER_MODELS.intelligence,
            messages: [{ role: "user", content: "Engine charge fixture" }], maxTokens: 200 });
          if (failAfterResponse) throw new Error("fixture failure after received response");
          return { result };
        } });
      const result = await runPipeline(validatePipeline([{ block: "reported_charge_fixture" }]), {
        ownerId: "fixture-owner", channelId: "fixture-channel", runId: "fixture-run", keyPrefix: "fixture/",
        budgetUsd: 1, defaultRetries: 0, sink: { upsert: async row => { stages.push(row); } },
      });
      assert.equal(result.ok, !failAfterResponse); assert.equal(dispatches, 1);
      assert.equal(result.costTotal, amount); assert.equal(stages.at(-1)?.cost, amount);
    }
    assert.deepEqual(failures, []);
    console.log(`OpenRouter reported-charge transport: ${cases.length} cases passed (offline boundaries only)`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
