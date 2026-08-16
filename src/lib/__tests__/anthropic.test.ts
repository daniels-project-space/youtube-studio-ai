import assert from "node:assert/strict";

import { claudeJson, claudeJsonPro, hasAnthropicKey, scriptProModel } from "@/lib/anthropic";

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
      return new Response(JSON.stringify({
        id: "msg-test",
        content: [{ type: "text", text: "```json\n{\"answer\":42}\n```" }],
        usage: { input_tokens: 11, output_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    assert.equal(hasAnthropicKey(), true);
    assert.deepEqual(await claudeJson<{ answer: number }>({ prompt: "return JSON", system: "strict" }), { answer: 42 });
    assert.deepEqual(await claudeJsonPro<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.equal(scriptProModel(), "claude-test-pro");
    assert.equal(requests.length, 2);
    assert.equal(String(requests[0]?.input), "https://api.anthropic.com/v1/messages");
    assert.equal(new Headers(requests[0]?.init?.headers).get("x-api-key"), "test-key");
    const firstPayload = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(firstPayload.system, "strict");
    assert.equal(firstPayload.messages[0].role, "user");
    assert.equal(firstPayload.messages[0].content, "return JSON");
    assert.equal(firstPayload.model, "claude-sonnet-4-5-20250929");
    const secondPayload = JSON.parse(String(requests[1]?.init?.body));
    assert.equal(secondPayload.model, "claude-test-pro");

    delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(() => claudeJson({ prompt: "no call" }), /OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required/);
    assert.equal(requests.length, 2, "missing key must fail before network");
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
