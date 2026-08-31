import assert from "node:assert/strict";

import {
  ClaudeGenerationOutcomeUnknownError,
  claudeJson,
  claudeJsonPro,
  hasAnthropicKey,
  scriptProModel,
} from "@/lib/anthropic";
import { createModelUsageScope } from "@/lib/modelUsage";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

async function main(): Promise<void> {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  try {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_CREATIVE_PRO_MODEL = "claude-test-pro";
    global.fetch = async (input, init) => {
      requests.push({ input, init });
      const prompt = typeof init?.body === "string"
        ? JSON.parse(init.body).messages?.[0]?.content
        : undefined;
      if (prompt === "ambiguous transport after Claude submit") {
        assert.ok(init?.signal, "direct Claude POST carries its bounded timeout signal");
        throw Object.assign(new Error("request aborted after submission timeout"), { name: "TimeoutError" });
      }
      if (prompt === "ambiguous 503 after Claude submit") {
        assert.ok(init?.signal, "direct Claude 5xx request carries its bounded timeout signal");
        return Response.json({ error: { message: "upstream unavailable after submit" } }, { status: 503 });
      }
      return new Response(JSON.stringify({
        id: prompt === "paid response without text" ? "msg-paid-empty" : "msg-test",
        content: prompt === "paid response without text"
          ? []
          : [{ type: "text", text: "```json\n{\"answer\":42}\n```" }],
        usage: prompt === "paid response without text"
          ? { input_tokens: 17, output_tokens: 3 }
          : { input_tokens: 11, output_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    assert.equal(hasAnthropicKey(), true);
    assert.deepEqual(await claudeJson<{ answer: number }>({ prompt: "return JSON", system: "strict" }), { answer: 42 });
    assert.deepEqual(await claudeJsonPro<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.equal(scriptProModel(), "claude-test-pro");
    assert.equal(requests.length, 2);
    assert.equal(String(requests[0]?.input), "https://api.anthropic.com/v1/messages");
    assert.equal(new Headers(requests[0]?.init?.headers).get("x-api-key"), "test-key");
    assert.ok(requests[0]?.init?.signal, "successful direct Claude calls keep the request deadline");
    const firstPayload = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(firstPayload.system, "strict");
    assert.equal(firstPayload.messages[0].role, "user");
    assert.equal(firstPayload.messages[0].content, "return JSON");
    assert.equal(firstPayload.model, "claude-sonnet-4-5-20250929");
    const secondPayload = JSON.parse(String(requests[1]?.init?.body));
    assert.equal(secondPayload.model, "claude-test-pro");

    // The shared model scope must collapse an exact concurrent submission
    // before either caller reaches the paid provider boundary. A changed
    // generation parameter remains a separate request, so the optimization
    // cannot blur the quality contract of two distinct prompts/settings.
    const scope = createModelUsageScope();
    const beforeConcurrent = requests.length;
    await scope.run(async () => {
      const exact = {
        prompt: "shared exact request",
        system: "strict",
        temperature: 0.2,
      };
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
    assert.equal(
      requests.length,
      beforeConcurrent + 2,
      "only an exact concurrent request may join the first paid Claude response",
    );
    const scopedUsage = scope.snapshot();
    assert.equal(scopedUsage.calls, 2, "one creator per distinct request is billed");
    assert.equal(scopedUsage.cacheHits, 1, "the concurrent identical caller joins the first request");

    // A provider can charge for a malformed 200 response. The response must
    // still count even when the missing text block makes the request fail.
    const paidMalformedScope = createModelUsageScope();
    await paidMalformedScope.run(() => assert.rejects(
      claudeJson({ prompt: "paid response without text" }),
      (error: unknown) =>
        error instanceof ClaudeGenerationOutcomeUnknownError &&
        error.retryable === false &&
        /response contained no text block/.test(error.message),
    ));
    const paidMalformedUsage = paidMalformedScope.snapshot();
    assert.equal(paidMalformedUsage.calls, 1, "a paid malformed response remains accounted");
    assert.equal(paidMalformedUsage.inputTokens, 17);
    assert.equal(paidMalformedUsage.outputTokens, 3);

    for (const [prompt, expectedStatus] of [
      ["ambiguous transport after Claude submit", undefined],
      ["ambiguous 503 after Claude submit", 503],
    ] as const) {
      const before: number = requests.length;
      let failure: unknown;
      try {
        await claudeJson({ prompt });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof ClaudeGenerationOutcomeUnknownError);
      assert.equal(failure.retryable, false);
      assert.equal(failure.code, "claude_generation_outcome_unknown");
      assert.equal(failure.status, expectedStatus);
      assert.equal(requests.length, before + 1, `${prompt} must make exactly one provider POST`);
      const taskOutcome = taskErrorForRetryPolicy(failure);
      assert.equal(taskOutcome.classification.kind, "deterministic");
      assert.ok(taskOutcome.error instanceof Error);
      assert.equal(taskOutcome.error.name, "AbortTaskRunError", `${prompt} must not trigger a task replay`);
    }

    delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(() => claudeJson({ prompt: "no call" }), /OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required/);
    assert.equal(requests.length, 7, "missing key must fail before network");
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
    else process.env.ANTHROPIC_CREATIVE_PRO_MODEL = previousModel;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
  console.log("Anthropic JSON boundary tests passed");
}

void main();
