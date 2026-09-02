import assert from "node:assert/strict";

import {
  ClaudeGenerationOutcomeUnknownError,
  claudeJson,
  claudeJsonPro,
  hasAnthropicKey,
  scriptProModel,
} from "@/lib/anthropic";
import { OPENROUTER_MODELS, OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { createModelUsageScope } from "@/lib/modelUsage";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

async function main(): Promise<void> {
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  try {
    // A legacy key must never restore the direct endpoint. The OpenRouter key
    // is the single admission source for every historical claudeJson caller.
    process.env.ANTHROPIC_API_KEY = "retired-direct-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    global.fetch = async (input, init) => {
      requests.push({ input, init });
      const payload = JSON.parse(String(init?.body));
      const prompt = payload.messages?.at(-1)?.content;
      if (prompt === "ambiguous transport after router submit") {
        assert.ok(init?.signal, "router POST carries a bounded timeout signal");
        throw Object.assign(new Error("request aborted after submission timeout"), { name: "TimeoutError" });
      }
      if (prompt === "ambiguous 503 after router submit") {
        assert.ok(init?.signal, "router 5xx POST carries its bounded timeout signal");
        return Response.json({ error: { message: "upstream unavailable after submit" } }, { status: 503 });
      }
      return new Response(JSON.stringify({
        id: prompt === "paid response without text" ? "or-paid-empty" : "or-test",
        model: payload.model,
        choices: prompt === "paid response without text"
          ? []
          : [{ message: { content: "```json\n{\"answer\":42}\n```" } }],
        usage: prompt === "paid response without text"
          ? { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 }
          : { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    assert.equal(hasAnthropicKey(), true, "compatibility guard admits only the OpenRouter route");
    assert.deepEqual(await claudeJson<{ answer: number }>({ prompt: "return JSON", system: "strict" }), { answer: 42 });
    assert.deepEqual(await claudeJsonPro<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.equal(scriptProModel(), OPENROUTER_MODELS.creative);
    assert.equal(requests.length, 2);
    assert.equal(String(requests[0]?.input), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer test-openrouter-key");
    const firstPayload = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(firstPayload.model, OPENROUTER_MODELS.intelligence);
    assert.equal(firstPayload.messages[0].content, "strict");
    assert.equal(firstPayload.messages[1].content, "return JSON");
    assert.equal(firstPayload.provider.data_collection, "deny");

    // The shared model scope still collapses exact concurrent calls before the
    // one paid OpenRouter request, without weakening the response contract.
    const scope = createModelUsageScope();
    const beforeConcurrent = requests.length;
    await scope.run(async () => {
      const exact = { prompt: "shared exact request", system: "strict", temperature: 0.2 };
      const [first, second] = await Promise.all([
        claudeJson<{ answer: number }>(exact),
        claudeJson<{ answer: number }>(exact),
      ]);
      assert.deepEqual(first, { answer: 42 });
      assert.deepEqual(second, { answer: 42 });
      assert.deepEqual(
        await claudeJson<{ answer: number }>({ ...exact, temperature: 0.3 }),
        { answer: 42 },
      );
    });
    assert.equal(requests.length, beforeConcurrent + 2);
    const scopedUsage = scope.snapshot();
    assert.equal(scopedUsage.calls, 2);
    assert.equal(scopedUsage.cacheHits, 1);

    const paidMalformedScope = createModelUsageScope();
    await paidMalformedScope.run(() => assert.rejects(
      claudeJson({ prompt: "paid response without text" }),
      (error: unknown) =>
        error instanceof OpenRouterGenerationOutcomeUnknownError &&
        error instanceof ClaudeGenerationOutcomeUnknownError &&
        error.retryable === false,
    ));
    const paidMalformedUsage = paidMalformedScope.snapshot();
    assert.equal(paidMalformedUsage.calls, 1);
    assert.equal(paidMalformedUsage.inputTokens, 17);
    assert.equal(paidMalformedUsage.outputTokens, 3);

    for (const [prompt, expectedStatus] of [
      ["ambiguous transport after router submit", undefined],
      ["ambiguous 503 after router submit", 503],
    ] as const) {
      const before: number = requests.length;
      let failure: unknown;
      try {
        await claudeJson({ prompt });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof OpenRouterGenerationOutcomeUnknownError);
      assert.equal((failure as OpenRouterGenerationOutcomeUnknownError).retryable, false);
      assert.equal((failure as OpenRouterGenerationOutcomeUnknownError).status, expectedStatus);
      assert.equal(requests.length, before + 1);
      const taskOutcome = taskErrorForRetryPolicy(failure);
      assert.equal(taskOutcome.classification.kind, "deterministic");
      assert.equal((taskOutcome.error as Error).name, "AbortTaskRunError");
    }

    delete process.env.OPENROUTER_API_KEY;
    assert.equal(hasAnthropicKey(), false, "a direct Anthropic key cannot admit the retired route");
    await assert.rejects(() => claudeJson({ prompt: "no call" }), /OPENROUTER_API_KEY is required/);
    assert.equal(requests.length, 7, "missing OpenRouter key fails before a network dispatch");
  } finally {
    global.fetch = originalFetch;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
  console.log("Creative-text OpenRouter-only routing tests passed");
}

void main();
