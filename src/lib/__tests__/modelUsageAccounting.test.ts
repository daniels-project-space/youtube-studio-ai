import assert from "node:assert/strict";
import { z } from "zod";

import { classifyExecutionError } from "@/engine/executionErrors";
import { accountedModelUsageCost } from "@/engine/modelUsageCost";
import { PRICE } from "@/engine/pricing";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { GEMINI_RUNTIME_OPT_IN_ENV, GeminiSubmissionError, geminiJson } from "@/lib/gemini";
import { claudeJson } from "@/lib/anthropic";
import {
  createModelUsageScope,
  getOrCreateModelResponse,
  modelRequestCacheKey,
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

  const openRouterFlash = priceModelUsage({
    provider: "openrouter",
    model: "google/gemini-3.7-flash",
    kind: "vision",
    inputTokens: 1_000,
    outputTokens: 100,
  });
  close(openRouterFlash.costUsd ?? -1, 0.001125, "OpenRouter Gemini Flash token price");

  const claude = priceModelUsage({
    provider: "anthropic",
    model: "anthropic/claude-sonnet-4-5-20250929",
    kind: "text",
    inputTokens: 1_000,
    outputTokens: 200,
  });
  // Claude Sonnet 4.5 first-party API: $3/M input + $15/M output.
  close(claude.costUsd ?? -1, 0.006, "Claude Sonnet 4.5 token price");

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

async function openRouterVisionUsageIsCaptured(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalProviders = process.env.VISION_PROVIDERS;
  process.env.OPENROUTER_API_KEY = "hermetic-openrouter-key";
  process.env.VISION_PROVIDERS = "openrouter";
  let openRouterFetches = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://images.test/accounting.jpg") {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    openRouterFetches++;
    return Response.json({
      id: "openrouter-response-test",
      model: "mistralai/ministral-8b-2512",
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25,
        total_tokens: 125,
      },
    });
  };
  try {
    const { visionUrls } = await import("@/lib/vision");
    const scope = createModelUsageScope();
    const response = await scope.run(() =>
      visionUrls({
        prompt: "model-usage-accounting-openrouter-unique-v1",
        imageUrls: ["https://images.test/accounting.jpg"],
        json: true,
        noCache: true,
      }),
    );
    assert.equal(response, '{"ok":true}');
    assert.equal(openRouterFetches, 1);
    const usage = scope.snapshot();
    assert.equal(usage.calls, 1);
    close(usage.costUsd, 0.00001875, "OpenRouter vision provider usage price");
    assert.equal(usage.groups[0]?.model, "mistralai/ministral-8b-2512");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
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

async function runnerReusesClaudeResponseAfterRetry(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.ANTHROPIC_API_KEY = "hermetic-anthropic-test-key";
  delete process.env.OPENROUTER_API_KEY;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    fetches++;
    return Response.json({
      id: "claude-retry-response",
      content: [{ type: "text", text: '{"value":"real"}' }],
      usage: { input_tokens: 1_000, output_tokens: 200 },
    });
  };

  _clear();
  let attempts = 0;
  const modelBlock: Block = {
    id: "claude_model_accounting_test",
    consumes: [],
    produces: ["x"],
    run: async () => {
      const answer = await claudeJson<{ value: string }>({
        prompt: "same paid Claude call after retry",
      });
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
      runId: "run-claude-model-accounting",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 10,
      defaultRetries: 1,
      sink,
    });
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
    assert.equal(fetches, 1, "outer retry reuses the first valid paid Claude response");
    close(result.costTotal, 0.006, "runner preserves exact first-party Claude cost");
    close(rows.find((row) => row.status === "ok")?.cost ?? -1, 0.006, "persisted Claude stage cost");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
}

async function failedSingleFlightIsNeverMemoized(): Promise<void> {
  const scope = createModelUsageScope();
  const key = modelRequestCacheKey("anthropic", "claude-sonnet-4-5-20250929", {
    prompt: "single-flight failure boundary",
  });
  let creates = 0;
  await scope.run(async () => {
    await assert.rejects(
      getOrCreateModelResponse(key, {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        kind: "text",
      }, async () => {
        creates++;
        throw new Error("ambiguous provider transport");
      }),
      /ambiguous provider transport/,
    );
    assert.equal(
      await getOrCreateModelResponse(key, {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        kind: "text",
      }, async () => {
        creates++;
        return "recovered";
      }),
      "recovered",
    );
  });
  assert.equal(creates, 2, "a rejected provider attempt is never cached as a successful response");
}

async function agentPostDispatchFailureNeverFallsBack(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalMastraProducerModel = process.env.MASTRA_PRODUCER_MODEL;
  const originalLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const originalLangfuseBaseUrl = process.env.LANGFUSE_BASE_URL;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  let fetches = 0;
  try {
    // Import after pinning the role model so this hermetic Mastra-boundary
    // exercise never needs a real provider credential or reaches the network.
    process.env.ANTHROPIC_API_KEY = "hermetic-agent-schema-test-key";
    process.env.MASTRA_PRODUCER_MODEL = "anthropic/claude-sonnet-4-5-20250929";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    console.warn = () => undefined;
    console.error = () => undefined;
    globalThis.fetch = async () => {
      fetches++;
      // Mastra rejects this deliberately minimal non-stream response after
      // dispatch. It might already represent paid model work, so agentJson
      // must surface its typed terminal outcome instead of issuing a second
      // REST request for the same prompt.
      return Response.json({
        id: "agent-schema-test",
        content: [{ type: "text", text: '{"answer":42}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };

    const {
      agentJson,
      MastraGenerationOutcomeUnknownError,
      parseMastraStructuredObject,
    } = await import("@/agents/mastra");
    assert.throws(
      () => parseMastraStructuredObject({
        role: "producer",
        schema: z.object({ answer: z.number() }),
        response: {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof MastraGenerationOutcomeUnknownError);
        assert.equal(error.code, "mastra_generation_outcome_unknown");
        assert.equal(error.retryable, false);
        return true;
      },
      "a completed response without structured output is terminal before any REST fallback",
    );
    const scope = createModelUsageScope();
    await scope.run(async () => {
      await assert.rejects(
        agentJson({
          role: "producer",
          prompt: "same prompt, intentionally different contracts",
          schema: z.object({ answer: z.number() }),
          log: () => undefined,
        }),
        (error: unknown) => {
          assert.ok(error instanceof MastraGenerationOutcomeUnknownError);
          assert.equal(error.code, "mastra_generation_outcome_unknown");
          assert.equal(error.retryable, false);
          return true;
        },
      );
      await assert.rejects(
        agentJson({
          role: "producer",
          prompt: "same prompt, intentionally different contracts",
          schema: z.object({ label: z.string() }),
          log: () => undefined,
        }),
        (error: unknown) => error instanceof MastraGenerationOutcomeUnknownError,
      );
    });

    // Each distinct contract made exactly one Mastra request. Neither post-
    // dispatch failure entered the REST fallback, so there is no duplicate
    // provider spend.
    assert.equal(fetches, 2, "post-dispatch Mastra failures make zero REST fallback calls");
    const usage = scope.snapshot();
    assert.equal(usage.calls, 0, "a rejected Mastra response is not misreported as a second REST success");
    assert.equal(usage.cacheHits, 0, "distinct failed structured-output contracts never share a response");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalMastraProducerModel === undefined) delete process.env.MASTRA_PRODUCER_MODEL;
    else process.env.MASTRA_PRODUCER_MODEL = originalMastraProducerModel;
    if (originalLangfusePublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
    else process.env.LANGFUSE_PUBLIC_KEY = originalLangfusePublicKey;
    if (originalLangfuseSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
    else process.env.LANGFUSE_SECRET_KEY = originalLangfuseSecretKey;
    if (originalLangfuseBaseUrl === undefined) delete process.env.LANGFUSE_BASE_URL;
    else process.env.LANGFUSE_BASE_URL = originalLangfuseBaseUrl;
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
    provider: "openrouter",
    model: "google/gemini-3.7-flash",
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
  const originalGeminiRuntime = process.env[GEMINI_RUNTIME_OPT_IN_ENV];
  process.env[GEMINI_RUNTIME_OPT_IN_ENV] = "1";
  try {
    exactPriceFromProviderTokens();
    // Generic Gemini transport is intentionally unavailable at runtime. Its
    // historical token-rate table remains for immutable old receipts, while
    // live accounting coverage below exercises the admitted non-Google routes.
    await openRouterVisionUsageIsCaptured();
    // The old runner-retry fixture intentionally exercised generic Gemini.
    // It is now unavailable by policy; equivalent live accounting coverage
    // above uses OpenRouter, while historical Gemini receipts retain exact pricing.
    await runnerReusesClaudeResponseAfterRetry();
    await failedSingleFlightIsNeverMemoized();
    await agentPostDispatchFailureNeverFallsBack();
    await explicitAndFailedCostsAreAuthoritative();
    await failedTrackedUsageIsNotLost();
    console.log("MODEL USAGE ACCOUNTING TESTS PASSED");
  } finally {
    if (originalGeminiRuntime === undefined) delete process.env[GEMINI_RUNTIME_OPT_IN_ENV];
    else process.env[GEMINI_RUNTIME_OPT_IN_ENV] = originalGeminiRuntime;
  }
}

main().catch((error) => {
  console.error("MODEL USAGE ACCOUNTING TEST FAILED", error);
  process.exit(1);
});
