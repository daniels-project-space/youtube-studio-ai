import assert from "node:assert/strict";
import { creativeTextJson } from "../creativeText";
import { createModelUsageScope } from "../modelUsage";
import { createWeeklyScriptCallBudget } from "../weeklyScriptCallBudget";

async function main() {
  const oldFetch = globalThis.fetch, oldKey = process.env.OPENROUTER_API_KEY, oldRates = process.env.MODEL_PRICE_OVERRIDES_JSON;
  let calls = 0, active = 0, peak = 0;
  let mode: "priced" | "unpriced" | "unknown" = "priced";
  try {
    process.env.OPENROUTER_API_KEY = "synthetic-test-only";
    delete process.env.MODEL_PRICE_OVERRIDES_JSON;
    globalThis.fetch = async (_input, init) => {
      calls++; active++; peak = Math.max(peak, active);
      const body = JSON.parse(String(init?.body));
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      if (mode === "unknown") throw new Error("synthetic transport failure");
      return Response.json({ id: `synthetic-${calls}`, model: body.model, choices: [{ message: { content: '{"ok":true}' } }], usage: mode === "unpriced" ? {} : { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40, cost: 0.03, is_byok: false } });
    };
    const usage = createModelUsageScope(), ledger = createWeeklyScriptCallBudget(1, usage.snapshot);
    await usage.run(() => ledger.run(async () => {
      const results = await Promise.all([creativeTextJson({ prompt: "first", maxTokens: 4000 }), creativeTextJson({ prompt: "second", maxTokens: 4000 })]);
      assert.deepEqual(results, [{ ok: true }, { ok: true }]);
    }));
    ledger.assertComplete();
    assert.equal(calls, 2); assert.equal(peak, 1, "paid requests are serialized within one claimed stage");
    assert.equal(usage.snapshot().calls, 2);

    calls = 0; peak = 0;
    const limitedUsage = createModelUsageScope(), limited = createWeeklyScriptCallBudget(0.04, limitedUsage.snapshot);
    const results = await limitedUsage.run(() => limited.run(() => Promise.allSettled([creativeTextJson({ prompt: "first", maxTokens: 4000 }), creativeTextJson({ prompt: "second", maxTokens: 4000 })])));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(calls, 1, "remaining allowance rejects the second call before fetch");
    assert.throws(() => limited.assertComplete(), /reserve/);

    calls = 0;
    const tinyUsage = createModelUsageScope(), tiny = createWeeklyScriptCallBudget(0.001, tinyUsage.snapshot);
    await assert.rejects(tinyUsage.run(() => tiny.run(() => creativeTextJson({ prompt: "too expensive", maxTokens: 4000 }))), /reserve/);
    assert.equal(calls, 0);

    for (const failure of ["unpriced", "unknown"] as const) {
      mode = failure; calls = 0;
      const failedUsage = createModelUsageScope(), failed = createWeeklyScriptCallBudget(1, failedUsage.snapshot);
      await failedUsage.run(() => failed.run(async () => {
        await assert.rejects(creativeTextJson({ prompt: "uncertain", maxTokens: 1000 }));
        await assert.rejects(creativeTextJson({ prompt: "must not dispatch", maxTokens: 1000 }));
      }));
      assert.equal(calls, 1, `${failure} blocks later calls`);
      assert.throws(() => failed.assertComplete());
    }
    mode = "priced"; calls = 0;
    const cachedUsage = createModelUsageScope(), cached = createWeeklyScriptCallBudget(1, cachedUsage.snapshot);
    await cachedUsage.run(() => cached.run(async () => {
      await creativeTextJson({ prompt: "identical", maxTokens: 1000 });
      await creativeTextJson({ prompt: "identical", maxTokens: 1000 });
    }));
    cached.assertComplete(); assert.equal(calls, 1); assert.equal(cachedUsage.snapshot().cacheHits, 1);
    console.log("Weekly script call reservations serialize, reject, hold unknown outcomes, and preserve cache reuse");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldRates === undefined) delete process.env.MODEL_PRICE_OVERRIDES_JSON; else process.env.MODEL_PRICE_OVERRIDES_JSON = oldRates;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
