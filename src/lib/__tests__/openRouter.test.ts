import assert from "node:assert/strict";
import { z } from "zod";

import { agentJson } from "@/agents/mastra";
import { claudeJson, claudeJsonPro, hasAnthropicKey, scriptProModel } from "@/lib/anthropic";
import {
  OPENROUTER_MODELS,
  OpenRouterGenerationOutcomeUnknownError,
  openRouterChat,
  openRouterModel,
} from "@/lib/openRouter";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    intelligenceModel: process.env.OPENROUTER_INTELLIGENCE_MODEL,
  };
  const originalFetch = global.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async (input, init) => {
      requests.push({ input, init });
      const payload = JSON.parse(String(init?.body));
      const prompt = payload.messages?.at(-1)?.content;
      if (prompt === "OpenRouter transport ambiguity") {
        assert.ok(init?.signal, "OpenRouter post carries a bounded timeout signal");
        throw Object.assign(new Error("request aborted after submission timeout"), { name: "TimeoutError" });
      }
      if (prompt === "OpenRouter 503 ambiguity") {
        assert.ok(init?.signal, "OpenRouter 5xx post carries a bounded timeout signal");
        return Response.json({ error: { message: "upstream unavailable after submit" } }, { status: 503 });
      }
      if (prompt === "OpenRouter pre-admission 400") {
        return Response.json({ error: { message: "invalid request" } }, { status: 400 });
      }
      return new Response(JSON.stringify({
        id: "or-test",
        model: payload.model,
        choices: prompt === "OpenRouter missing text"
          ? []
          : [{ message: { content: prompt === "OpenRouter invalid JSON" ? "not valid JSON" : '{"answer":42}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    assert.equal(hasAnthropicKey(), true, "existing capability guards must accept the OpenRouter intelligence route");
    assert.equal(
      OPENROUTER_MODELS.intelligence,
      "google/gemini-3.7-flash",
      "shared structured planning stays on the pinned Gemini 3.7 Flash route",
    );
    process.env.OPENROUTER_INTELLIGENCE_MODEL = "openai/gpt-oss-20b";
    assert.throws(
      () => openRouterModel("intelligence"),
      /prohibited: Studio runtime must not use OpenAI API models/,
      "an environment override must not reintroduce an OpenAI model through OpenRouter",
    );
    delete process.env.OPENROUTER_INTELLIGENCE_MODEL;
    const beforeBlockedModel = requests.length;
    await assert.rejects(
      openRouterChat({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "must not dispatch" }],
        maxTokens: 32,
      }),
      /prohibited: Studio runtime must not use OpenAI API models/,
    );
    assert.equal(requests.length, beforeBlockedModel, "a prohibited model must fail before any provider POST");
    assert.deepEqual(await claudeJson<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.deepEqual(await claudeJsonPro<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.equal(scriptProModel(), OPENROUTER_MODELS.creative);
    assert.equal(requests.length, 2);
    assert.equal(String(requests[0]?.input), "https://openrouter.ai/api/v1/chat/completions");
    assert.ok(requests[0]?.init?.signal, "successful OpenRouter calls retain their request deadline");
    const flash = JSON.parse(String(requests[0]?.init?.body));
    const creative = JSON.parse(String(requests[1]?.init?.body));
    assert.equal(flash.model, OPENROUTER_MODELS.intelligence);
    assert.equal(creative.model, OPENROUTER_MODELS.creative);
    for (const payload of [flash, creative]) {
      assert.equal(payload.provider.allow_fallbacks, true);
      assert.equal(payload.provider.data_collection, "deny");
      assert.deepEqual(payload.provider.only, ["google-ai-studio", "google-vertex"]);
      assert.equal(payload.response_format.type, "json_object");
    }

    // A present Mastra package must not route an Anthropic-named role to the
    // native gateway when only the explicitly supported OpenRouter credential
    // is available. This is the same production shape used by the whiteboard
    // storyboard path.
    assert.deepEqual(
      await agentJson({
        role: "producer",
        prompt: "OpenRouter-only Mastra fallback",
        schema: z.object({ answer: z.number() }),
      }),
      { answer: 42 },
    );
    assert.equal(requests.length, 3, "OpenRouter-only role uses one REST request without native Mastra dispatch");

    for (const [prompt, expectedStatus] of [
      ["OpenRouter transport ambiguity", undefined],
      ["OpenRouter 503 ambiguity", 503],
      ["OpenRouter missing text", 200],
      ["OpenRouter invalid JSON", 200],
    ] as const) {
      const before: number = requests.length;
      let failure: unknown;
      try {
        await claudeJson({ prompt });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof OpenRouterGenerationOutcomeUnknownError);
      assert.equal(failure.retryable, false);
      assert.equal(failure.code, "openrouter_generation_outcome_unknown");
      assert.equal(failure.status, expectedStatus);
      assert.equal(requests.length, before + 1, `${prompt} must make exactly one provider POST`);
      const taskOutcome = taskErrorForRetryPolicy(failure);
      assert.equal(taskOutcome.classification.kind, "deterministic");
      assert.ok(taskOutcome.error instanceof Error);
      assert.equal(taskOutcome.error.name, "AbortTaskRunError", `${prompt} must not trigger task replay`);
    }

    const before400: number = requests.length;
    await assert.rejects(
      claudeJson({ prompt: "OpenRouter pre-admission 400" }),
      (error: unknown) =>
        !(error instanceof OpenRouterGenerationOutcomeUnknownError) &&
        error instanceof Error &&
        /OpenRouter HTTP 400/.test(error.message),
    );
    assert.equal(requests.length, before400 + 1, "explicit pre-admission 400 remains one request and untyped");
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.anthropic;
    if (saved.intelligenceModel === undefined) delete process.env.OPENROUTER_INTELLIGENCE_MODEL;
    else process.env.OPENROUTER_INTELLIGENCE_MODEL = saved.intelligenceModel;
  }
  console.log("OpenRouter intelligence routing tests passed");
}

void main();
