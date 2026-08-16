import assert from "node:assert/strict";

import { claudeJson, claudeJsonPro, hasAnthropicKey, scriptProModel } from "@/lib/anthropic";
import { OPENROUTER_MODELS } from "@/lib/openRouter";

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const originalFetch = global.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async (input, init) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({
        id: "or-test",
        model: JSON.parse(String(init?.body)).model,
        choices: [{ message: { content: '{"answer":42}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    assert.equal(hasAnthropicKey(), true, "existing capability guards must accept the OpenRouter intelligence route");
    assert.deepEqual(await claudeJson<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.deepEqual(await claudeJsonPro<{ answer: number }>({ prompt: "return JSON" }), { answer: 42 });
    assert.equal(scriptProModel(), OPENROUTER_MODELS.creative);
    assert.equal(requests.length, 2);
    assert.equal(String(requests[0]?.input), "https://openrouter.ai/api/v1/chat/completions");
    const flash = JSON.parse(String(requests[0]?.init?.body));
    const creative = JSON.parse(String(requests[1]?.init?.body));
    assert.equal(flash.model, OPENROUTER_MODELS.intelligence);
    assert.equal(creative.model, OPENROUTER_MODELS.creative);
    for (const payload of [flash, creative]) {
      assert.equal(payload.provider.allow_fallbacks, false);
      assert.equal(payload.provider.data_collection, "deny");
      assert.ok(Array.isArray(payload.provider.only) && payload.provider.only.length === 1);
      assert.equal(payload.response_format.type, "json_object");
    }
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.anthropic;
  }
  console.log("OpenRouter intelligence routing tests passed");
}

void main();
