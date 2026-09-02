import assert from "node:assert/strict";

import { visionUrls } from "@/lib/vision";

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    providers: process.env.VISION_PROVIDERS,
  };
  const originalFetch = global.fetch;
  const requests: Record<string, unknown>[] = [];
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.VISION_PROVIDERS = "openrouter";
    global.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://images.test/router.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return Response.json({
        id: `router-${requests.length}`,
        model: body.model,
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    };

    for (const tier of ["bulk", "standard", "final"] as const) {
      await visionUrls({
        prompt: `openrouter-${tier}-route`,
        imageUrls: ["https://images.test/router.jpg"],
        json: true,
        noCache: true,
        tier,
        providers: ["openrouter"],
      });
    }
    await assert.rejects(
      () => visionUrls({
        prompt: "final-review-cannot-bypass-batch-envelope",
        imageUrls: [
          "https://images.test/router.jpg",
          "https://images.test/router.jpg",
          "https://images.test/router.jpg",
        ],
        json: true,
        noCache: true,
        tier: "final",
        providers: ["openrouter"],
      }),
      /at most 2/,
      "direct final-tier review calls must use the same two-image operational envelope as reviewRender",
    );
    assert.equal(requests.length, 3, "oversized final review rejects before image fetch/provider work");
    assert.deepEqual(requests.map((request) => request.model), [
      "google/gemini-3.7-flash",
      "google/gemini-3.7-flash",
      "google/gemini-3.7-flash",
    ]);
    for (const request of requests) {
      const provider = request.provider as { allow_fallbacks?: unknown; only?: unknown; data_collection?: unknown };
      assert.equal(provider.allow_fallbacks, true);
      assert.equal(provider.data_collection, "deny");
      assert.deepEqual(provider.only, ["google-ai-studio", "google-vertex"]);
    }
    assert.deepEqual(
      (requests[2]?.provider as { only?: unknown }).only,
      ["google-ai-studio", "google-vertex"],
      "final visual review stays on the pinned OpenRouter Gemini provider pair",
    );
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.providers === undefined) delete process.env.VISION_PROVIDERS;
    else process.env.VISION_PROVIDERS = saved.providers;
  }
  console.log("OpenRouter vision tier routing tests passed");
}

void main();
