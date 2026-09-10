import assert from "node:assert/strict";

import { claudeJson } from "@/lib/anthropic";
import { createModelUsageScope } from "@/lib/modelUsage";

async function main(): Promise<void> {
  const savedKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    global.fetch = async (input, init) => {
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      calls += 1;
      if (calls === 1) {
        await new Promise<never>((_, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error("first request aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("first request aborted")), { once: true });
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        id: `signal-isolation-${calls}`,
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    };

    const controller = new AbortController();
    const scope = createModelUsageScope();
    const results = await scope.run(async () => {
      const first = claudeJson<{ ok: boolean }>({ prompt: "signal-isolation", signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = claudeJson<{ ok: boolean }>({ prompt: "signal-isolation" });
      setTimeout(() => controller.abort(), 10);
      return Promise.allSettled([first, second]);
    });
    assert.equal(results[0]?.status, "rejected", "the caller-owned deadline cancels only its own request");
    assert.deepEqual(results[1], { status: "fulfilled", value: { ok: true } }, "an independent caller still receives the result");
    assert.equal(calls, 2, "signal-bound requests do not join a cancelable in-flight request");
    assert.equal(scope.snapshot().calls, 1, "only the successful independent request records provider usage");
  } finally {
    global.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  }
  console.log("ANTHROPIC SIGNAL ISOLATION PASS — caller cancellation cannot abort an unrelated joined request");
}

void main();
