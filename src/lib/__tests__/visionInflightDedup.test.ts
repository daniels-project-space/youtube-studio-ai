import assert from "node:assert/strict";

import { createModelUsageScope } from "@/lib/modelUsage";
import { visionUrls } from "@/lib/vision";

async function main(): Promise<void> {
  const saved = {
    key: process.env.OPENROUTER_API_KEY,
    providers: process.env.VISION_PROVIDERS,
    bulkModel: process.env.OPENROUTER_VISION_BULK_MODEL,
  };
  const originalFetch = global.fetch;
  let imageGets = 0;
  let providerPosts = 0;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.VISION_PROVIDERS = "openrouter";
    delete process.env.OPENROUTER_VISION_BULK_MODEL;
    global.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://images.test/inflight.jpg") {
        imageGets += 1;
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.ok(init?.signal, "the coalesced provider request keeps its bounded signal");
      providerPosts += 1;
      const body = JSON.parse(String(init?.body)) as { model?: string };
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({
        id: `inflight-${providerPosts}`,
        model: body.model,
        choices: [{ message: { content: '{"verdict":"pass"}' } }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      });
    };

    const prompt = `vision-inflight-coalescing-${Date.now()}-${Math.random()}`;
    const modelScope = createModelUsageScope();
    const [first, second] = await modelScope.run(() => Promise.all([
      visionUrls({ prompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }),
      visionUrls({ prompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }),
    ]));
    assert.equal(first, second, "identical concurrent reviews share the same provider result");
    assert.equal(providerPosts, 1, "identical concurrent reviews make one provider POST");
    assert.equal(imageGets, 2, "input downloads remain caller-local; only paid review work is coalesced");
    assert.equal(modelScope.snapshot().cacheHits, 1, "the coalesced joiner is visible as a model cache hit");

    const beforeDiskHit = modelScope.snapshot();
    const diskHit = await modelScope.run(() => visionUrls({ prompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }));
    assert.equal(diskHit, first);
    const afterDiskHit = modelScope.snapshot();
    assert.equal(afterDiskHit.cacheHits, beforeDiskHit.cacheHits + 1, "completed disk reuse is counted even when image preparation finishes after the first request");
    assert.equal(afterDiskHit.calls, beforeDiskHit.calls);
    assert.equal(afterDiskHit.costUsd, beforeDiskHit.costUsd);
    assert.equal(providerPosts, 1, "a disk hit never dispatches another provider request");

    const laterScope = createModelUsageScope();
    await laterScope.run(() => visionUrls({ prompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }));
    assert.equal(laterScope.snapshot().cacheHits, 1, "a later run owns its disk-reuse observation");
    assert.equal(laterScope.snapshot().calls, 0);
    assert.equal(laterScope.snapshot().costUsd, 0, "historical provider cost is not charged to the new scope");
    assert.equal(providerPosts, 1);

    const modelPrompt = `vision-cache-model-binding-${Date.now()}-${Math.random()}`;
    await modelScope.run(async () => {
      await visionUrls({ prompt: modelPrompt, imageUrls: ["https://images.test/inflight.jpg"], json: true, tier: "bulk" });
      process.env.OPENROUTER_VISION_BULK_MODEL = "mistralai/ministral-3b-2512";
      await visionUrls({ prompt: modelPrompt, imageUrls: ["https://images.test/inflight.jpg"], json: true, tier: "bulk" });
    });
    assert.equal(providerPosts, 3, "changing the approved model invalidates the prior disk verdict key");

    const failedPrompt = `vision-inflight-failure-cleanup-${Date.now()}-${Math.random()}`;
    global.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://images.test/inflight.jpg") {
        return new Response(new Uint8Array([5, 6, 7]), { status: 200 });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.ok(init?.signal);
      providerPosts += 1;
      return Response.json({ error: { message: "temporary upstream failure" } }, { status: 503 });
    };
    await modelScope.run(async () => {
      await assert.rejects(
        () => visionUrls({ prompt: failedPrompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }),
        /all vision providers failed/,
      );
      await assert.rejects(
        () => visionUrls({ prompt: failedPrompt, imageUrls: ["https://images.test/inflight.jpg"], json: true }),
        /all vision providers failed/,
      );
    });
    assert.equal(providerPosts, 5, "a failed request is removed so a deliberate later retry can proceed");
  } finally {
    global.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.providers === undefined) delete process.env.VISION_PROVIDERS;
    else process.env.VISION_PROVIDERS = saved.providers;
    if (saved.bulkModel === undefined) delete process.env.OPENROUTER_VISION_BULK_MODEL;
    else process.env.OPENROUTER_VISION_BULK_MODEL = saved.bulkModel;
  }
  console.log("VISION IN-FLIGHT DEDUP PASS — concurrent reviews coalesce without hiding deliberate retries");
}

void main();
