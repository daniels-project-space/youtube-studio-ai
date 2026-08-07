import assert from "node:assert/strict";

import { classifyExecutionError } from "@/engine/executionErrors";
import { accountedModelUsageCost } from "@/engine/modelUsageCost";
import { PRICE } from "@/engine/pricing";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { GeminiSubmissionError, geminiJson } from "@/lib/gemini";
import {
  createModelUsageScope,
  priceModelUsage,
  recordModelUsage,
} from "@/lib/modelUsage";

interface StageRow {
  status: string;
  cost?: number;
}

function sinkRows(): { sink: RunStageSink; rows: StageRow[] } {
  const rows: StageRow[] = [];
  return {
    rows,
    sink: {
      async upsert(args) {
        rows.push({ status: args.status, cost: args.cost });
      },
    },
  };
}

function close(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} !== ${expected}`);
}

function exactPriceFromProviderTokens(): void {
  const priced = priceModelUsage({
    provider: "gemini",
    model: "gemini-2.5-flash",
    kind: "audio",
    inputTokens: 1_000,
    audioInputTokens: 400,
    cachedInputTokens: 200,
    cachedAudioInputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
  });
  // 500 non-audio input @ .30/M + 300 audio @ 1/M +
  // 100 cached text @ .03/M + 100 cached audio @ .10/M +
  // 250 output/reasoning @ 2.50/M.
  close(priced.costUsd ?? -1, 0.001088, "Gemini modality/cache price");

  const groq = priceModelUsage({
    provider: "groq",
    model: "qwen/qwen3.6-27b",
    kind: "vision",
    inputTokens: 1_000,
    outputTokens: 100,
  });
  close(groq.costUsd ?? -1, 0.0009, "Groq token price");

  const unknown = priceModelUsage({
    provider: "gemini",
    model: "future-model-with-no-rate",
    kind: "text",
    inputTokens: 1,
    outputTokens: 1,
  });
  assert.equal(unknown.costUsd, undefined, "unknown rates must never become guessed zero cost");
  assert.match(unknown.unpricedReason ?? "", /no exact rate configured/);
}

async function geminiUsageAndMemo(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "hermetic-test-key";
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({
      responseId: "response-test",
      modelVersion: "gemini-2.5-flash",
      candidates: [{ content: { parts: [{ text: '{"answer":"yes"}' }] } }],
      usageMetadata: {
        promptTokenCount: 1_000,
        cachedContentTokenCount: 100,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 50,
        totalTokenCount: 1_250,
      },
    });
  };
  try {
    const scope = createModelUsageScope();
    await scope.run(async () => {
      assert.deepEqual(await geminiJson({ prompt: "one memoized request" }), { answer: "yes" });
      assert.deepEqual(await geminiJson({ prompt: "one memoized request" }), { answer: "yes" });
    });
    const usage = scope.snapshot();
    assert.equal(fetches, 1, "identical valid response is paid only once in the retry scope");
    assert.equal(usage.calls, 1);
    assert.equal(usage.cacheHits, 1);
    close(usage.costUsd, 0.000898, "Gemini response metadata price");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
}

async function exhaustedProviderRetryIsTerminal(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalDelay = process.env.GEMINI_RETRY_BASE_MS;
  process.env.GEMINI_API_KEY = "hermetic-test-key";
  process.env.GEMINI_RETRY_BASE_MS = "0";
  try {
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches++;
      return Response.json({ error: { message: "capacity" } }, { status: 503 });
    };
    let failure: unknown;
    try {
      await geminiJson({ prompt: "ambiguous server submission" });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof GeminiSubmissionError);
    assert.equal(fetches, 1, "an ambiguous 5xx must never resubmit a potentially-billed call");
    assert.equal(
      classifyExecutionError(failure).retryable,
      false,
      "engine must not multiply an ambiguous provider submission",
    );

    fetches = 0;
    globalThis.fetch = async () => {
      fetches++;
      throw new TypeError("fixture connection reset after dispatch");
    };
    await assert.rejects(
      geminiJson({ prompt: "ambiguous transport submission" }),
      (error: unknown) =>
        error instanceof GeminiSubmissionError &&
        classifyExecutionError(error).retryable === false,
    );
    assert.equal(fetches, 1, "an ambiguous transport failure must never resubmit");

    // Explicit 429 is a definite pre-admission rejection, so the adapter may
    // retain its one bounded retry budget without duplicating token spend.
    fetches = 0;
    globalThis.fetch = async () => {
      fetches++;
      return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    };
    await assert.rejects(
      geminiJson({ prompt: "definite rate-limit rejection" }),
      /provider retry budget exhausted.*HTTP 429/i,
    );
    assert.equal(fetches, 4, "explicit pre-admission 429 responses retain bounded retries");

    // The one deterministic request-shape recovery remains safe: the first
    // request is rejected during validation and the accepted retry omits the
    // unsupported thinking field.
    fetches = 0;
    let acceptedBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      fetches++;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (fetches === 1) {
        return Response.json({ error: { message: "thinkingConfig is unsupported" } }, { status: 400 });
      }
      acceptedBody = body;
      return Response.json({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      });
    };
    assert.deepEqual(await geminiJson({ prompt: "thinking validation rejection", model: "gemini-2.5-flash" }), { ok: true });
    assert.equal(fetches, 2);
    assert.equal(
      "thinkingConfig" in ((acceptedBody?.["generationConfig"] as Record<string, unknown>) ?? {}),
      false,
      "the accepted retry must remove the deterministically rejected field",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalDelay === undefined) delete process.env.GEMINI_RETRY_BASE_MS;
    else process.env.GEMINI_RETRY_BASE_MS = originalDelay;
  }
}

async function groqVisionUsageIsCaptured(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalProviders = process.env.VISION_PROVIDERS;
  process.env.GROQ_API_KEY = "hermetic-groq-key";
  process.env.VISION_PROVIDERS = "groq";
  let groqFetches = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://images.test/accounting.jpg") {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    assert.match(url, /api\.groq\.com\/openai\/v1\/chat\/completions/);
    groqFetches++;
    return Response.json({
      id: "groq-response-test",
      model: "qwen/qwen3.6-27b",
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25,
        total_tokens: 125,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });
  };
  try {
    const { visionUrls } = await import("@/lib/vision");
    const scope = createModelUsageScope();
    const response = await scope.run(() =>
      visionUrls({
        prompt: "model-usage-accounting-groq-unique-v1",
        imageUrls: ["https://images.test/accounting.jpg"],
        json: true,
        noCache: true,
      }),
    );
    assert.equal(response, '{"ok":true}');
    assert.equal(groqFetches, 1);
    const usage = scope.snapshot();
    assert.equal(usage.calls, 1);
    close(usage.costUsd, 0.000135, "Groq vision provider usage price");
    assert.equal(usage.groups[0]?.model, "qwen/qwen3.6-27b");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalProviders === undefined) delete process.env.VISION_PROVIDERS;
    else process.env.VISION_PROVIDERS = originalProviders;
  }
}

async function runnerAccountsAndReusesModelResponse(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "hermetic-test-key";
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({
      modelVersion: "gemini-2.5-flash",
      candidates: [{ content: { parts: [{ text: '{"value":"real"}' }] } }],
      usageMetadata: {
        promptTokenCount: 1_000,
        candidatesTokenCount: 200,
        totalTokenCount: 1_200,
      },
    });
  };

  _clear();
  let attempts = 0;
  const modelBlock: Block = {
    id: "model_accounting_test",
    consumes: [],
    produces: ["x"],
    run: async () => {
      const answer = await geminiJson<{ value: string }>({ prompt: "same paid call after retry" });
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("later transport failed"), {
          retryable: true,
          retryAfterMs: 0,
        });
      }
      return { x: answer.value };
    },
  };
  register(modelBlock);
  const { sink, rows } = sinkRows();
  try {
    const result = await runPipeline(validatePipeline([{ block: modelBlock.id }]), {
      ownerId: "owner",
      runId: "run-model-accounting",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 10,
      defaultRetries: 1,
      sink,
    });
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
    assert.equal(fetches, 1, "outer block retry reuses the already-paid valid response");
    close(result.costTotal, 0.0008, "runner exact text-model cost");
    close(rows.find((row) => row.status === "ok")?.cost ?? -1, 0.0008, "persisted stage cost");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
}

async function explicitAndFailedCostsAreAuthoritative(): Promise<void> {
  _clear();
  const composite: Block = {
    id: "explicit_cost_test",
    consumes: [],
    produces: ["x"],
    paid: true,
    run: async () => {
      recordModelUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        kind: "vision",
        inputTokens: 1_000,
        outputTokens: 100,
      });
      return { x: "ok", [COST_PATCH_KEY]: 0.5 };
    },
  };
  register(composite);
  const success = await runPipeline(validatePipeline([{ block: composite.id }]), {
    ownerId: "owner",
    runId: "run-explicit-cost",
    channelId: "channel",
    keyPrefix: "test/",
    budgetUsd: 1,
    sink: sinkRows().sink,
  });
  assert.equal(success.costTotal, 0.5, "explicit composite patch must not double-count model cost");

  const conceptUsage = {
    provider: "gemini",
    model: "gemini-2.5-flash",
    kind: "text" as const,
    inputTokens: 2_400,
    outputTokens: 640,
  };
  const exactConceptCost = priceModelUsage(conceptUsage).costUsd;
  assert.notEqual(exactConceptCost, undefined);
  const pricedVisionUsage = {
    provider: "groq",
    model: "qwen/qwen3.6-27b",
    kind: "vision" as const,
    inputTokens: 1_000,
    outputTokens: 100,
  };
  const exactVisionCost = priceModelUsage(pricedVisionUsage).costUsd;
  assert.notEqual(exactVisionCost, undefined);
  const unpricedVisionUsage = {
    provider: "fal",
    model: "fal-ai/any-llm/vision",
    kind: "vision" as const,
    unpricedReason: "Fal response omitted billable usage and routed model",
  };
  const recordThumbnailModelUsage = (): void => {
    recordModelUsage(conceptUsage);
    recordModelUsage(pricedVisionUsage);
    recordModelUsage(unpricedVisionUsage);
  };
  const expectedThumbnailCost =
    0.04 +
    (exactConceptCost ?? 0) +
    (exactVisionCost ?? 0) +
    PRICE.visionGraderUsd;

  _clear();
  const thumbnailComposite: Block = {
    id: "thumbnail_composite_cost_test",
    consumes: [],
    produces: ["x"],
    run: async (ctx) => {
      recordThumbnailModelUsage();
      const conceptCost = accountedModelUsageCost(
        ctx,
        ["text"],
        PRICE.thumbnailConceptUsd,
      );
      const visionAccounting = ctx.modelUsageAccounting?.(["vision"]);
      assert.equal(conceptCost, exactConceptCost, "composite block sees exact scoped concept spend");
      assert.equal(visionAccounting?.costUsd, exactVisionCost);
      assert.equal(visionAccounting?.unpricedCalls, 1);
      const visionCost = accountedModelUsageCost(
        ctx,
        ["vision"],
        PRICE.visionGraderUsd,
      );
      return {
        x: "ok",
        [COST_PATCH_KEY]: 0.04 + conceptCost + visionCost,
      };
    },
  };
  register(thumbnailComposite);
  const thumbnailSuccess = await runPipeline(
    validatePipeline([{ block: thumbnailComposite.id }]),
    {
      ownerId: "owner",
      runId: "run-thumbnail-composite-cost",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 1,
      sink: sinkRows().sink,
    },
  );
  assert.ok(
    Math.abs(thumbnailSuccess.costTotal - expectedThumbnailCost) < 1e-12,
    "priced vision is exact and only one genuinely unpriced vision call receives the fallback",
  );

  _clear();
  const failed: Block = {
    id: "failed_cost_test",
    consumes: [],
    produces: ["x"],
    run: async (ctx) => {
      recordThumbnailModelUsage();
      const exactObservedConcept = accountedModelUsageCost(
        ctx,
        ["text"],
        PRICE.thumbnailConceptUsd,
      );
      const exactObservedVision = accountedModelUsageCost(
        ctx,
        ["vision"],
        PRICE.visionGraderUsd,
      );
      throw Object.assign(new Error("paid response was unusable"), {
        retryable: false,
        // Simulates a candidate rendered and judged before a gate/storage error.
        observedCostUsd: 0.04 + exactObservedConcept + exactObservedVision,
      });
    },
  };
  register(failed);
  const failedSink = sinkRows();
  const result = await runPipeline(validatePipeline([{ block: failed.id }]), {
    ownerId: "owner",
    runId: "run-failed-cost",
    channelId: "channel",
    keyPrefix: "test/",
    budgetUsd: 1,
    sink: failedSink.sink,
  });
  assert.equal(result.ok, false);
  const failedWholeCost = expectedThumbnailCost;
  assert.ok(
    Math.abs(result.costTotal - failedWholeCost) < 1e-12,
    "failed paid attempt stays in the run total",
  );
  assert.ok(
    Math.abs((failedSink.rows.find((row) => row.status === "failed")?.cost ?? 0) - failedWholeCost) < 1e-12,
    "failed stage persists concept, image, and vision spend",
  );
}

async function failedTrackedUsageIsNotLost(): Promise<void> {
  _clear();
  const failed: Block = {
    id: "failed_model_usage_test",
    consumes: [],
    produces: ["x"],
    run: async () => {
      recordModelUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        kind: "text",
        inputTokens: 1_000,
        outputTokens: 200,
      });
      throw Object.assign(new Error("schema rejected provider output"), { retryable: false });
    },
  };
  register(failed);
  const result = await runPipeline(validatePipeline([{ block: failed.id }]), {
    ownerId: "owner",
    runId: "run-failed-model-usage",
    channelId: "channel",
    keyPrefix: "test/",
    budgetUsd: 1,
    sink: sinkRows().sink,
  });
  assert.equal(result.ok, false);
  close(result.costTotal, 0.0008, "failed response metadata cost is preserved");
}

async function main(): Promise<void> {
  exactPriceFromProviderTokens();
  await geminiUsageAndMemo();
  await exhaustedProviderRetryIsTerminal();
  await groqVisionUsageIsCaptured();
  await runnerAccountsAndReusesModelResponse();
  await explicitAndFailedCostsAreAuthoritative();
  await failedTrackedUsageIsNotLost();
  console.log("MODEL USAGE ACCOUNTING TESTS PASSED");
}

main().catch((error) => {
  console.error("MODEL USAGE ACCOUNTING TEST FAILED", error);
  process.exit(1);
});
