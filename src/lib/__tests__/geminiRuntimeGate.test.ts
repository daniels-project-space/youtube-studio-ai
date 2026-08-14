import assert from "node:assert/strict";
import { z } from "zod";

import {
  GEMINI_RUNTIME_OPT_IN_ENV,
  GeminiRuntimeDisabledError,
  geminiJson,
  hasGeminiKey,
  parseJsonLoose,
  uploadGeminiVideo,
} from "@/lib/gemini";
import { generateNanoBananaImageWithReceipt, hasNanoBanana } from "@/lib/banana";
import { embedText, hasEmbedKey } from "@/lib/embeddings";
import { withStagehand } from "@/lib/browserbase";

const GATE_ENV = [
  "GEMINI_API_KEY",
  GEMINI_RUNTIME_OPT_IN_ENV,
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "MASTRA_PRODUCER_MODEL",
] as const;

function restoreEnv(snapshot: Record<(typeof GATE_ENV)[number], string | undefined>): void {
  for (const name of GATE_ENV) {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  }
}

function isDisabled(error: unknown): boolean {
  return error instanceof GeminiRuntimeDisabledError && error.code === "GEMINI_RUNTIME_DISABLED";
}

async function defaultDenyStopsEveryGeminiBoundaryBeforeNetwork(): Promise<void> {
  const snapshot = Object.fromEntries(GATE_ENV.map((name) => [name, process.env[name]])) as Record<
    (typeof GATE_ENV)[number],
    string | undefined
  >;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  let stagehandCallbackCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "fixture-key";
    process.env.BROWSERBASE_API_KEY = "fixture-browserbase-key";
    process.env.BROWSERBASE_PROJECT_ID = "fixture-browserbase-project";
    process.env.MASTRA_PRODUCER_MODEL = "google/gemini-2.5-flash";
    delete process.env[GEMINI_RUNTIME_OPT_IN_ENV];
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("Gemini gate test must not reach fetch");
    }) as typeof fetch;

    assert.equal(hasGeminiKey(), false, "a legacy key alone must not admit Gemini text calls");
    assert.equal(hasNanoBanana(), false, "a legacy key alone must not admit Nano Banana");
    assert.equal(hasEmbedKey(), false, "a legacy key alone must not admit Gemini embeddings");
    assert.deepEqual(parseJsonLoose<{ pure: boolean }>("{\"pure\":true}"), { pure: true });

    await assert.rejects(geminiJson({ prompt: "blocked text request" }), isDisabled);
    // The upload guard must precede both file I/O and the File API request.
    await assert.rejects(uploadGeminiVideo("/definitely/missing-video.mp4"), isDisabled);
    await assert.rejects(
      generateNanoBananaImageWithReceipt({ prompt: "blocked image request" }),
      isDisabled,
    );
    await assert.rejects(embedText("blocked embedding request"), isDisabled);
    await assert.rejects(
      withStagehand(async () => {
        stagehandCallbackCalls += 1;
        return "unreachable";
      }),
      isDisabled,
    );

    // Import after pinning the model env so this verifies Mastra's direct
    // Google route is rejected before the SDK can construct/generate.
    const { agentJson } = await import("@/agents/mastra");
    await assert.rejects(
      agentJson({
        role: "producer",
        prompt: "blocked Mastra Gemini request",
        schema: z.object({ answer: z.string() }),
      }),
      isDisabled,
    );
    assert.equal(stagehandCallbackCalls, 0, "Stagehand callback must not run after the provider refusal");
    assert.equal(networkCalls, 0, "every Gemini boundary must stop before fetch");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(snapshot);
  }
}

async function explicitOptInRetainsTheLegacyAdapterForApprovedTests(): Promise<void> {
  const snapshot = Object.fromEntries(GATE_ENV.map((name) => [name, process.env[name]])) as Record<
    (typeof GATE_ENV)[number],
    string | undefined
  >;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "fixture-key";
    process.env[GEMINI_RUNTIME_OPT_IN_ENV] = "1";
    globalThis.fetch = (async () => {
      networkCalls += 1;
      return Response.json({
        candidates: [{ content: { parts: [{ text: "{\"approved\":true}" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });
    }) as typeof fetch;

    assert.equal(hasGeminiKey(), true);
    assert.deepEqual(await geminiJson({ prompt: "explicitly approved fixture request" }), { approved: true });
    assert.equal(networkCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(snapshot);
  }
}

async function main(): Promise<void> {
  await defaultDenyStopsEveryGeminiBoundaryBeforeNetwork();
  await explicitOptInRetainsTheLegacyAdapterForApprovedTests();
  console.log("GEMINI RUNTIME GATE TESTS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
