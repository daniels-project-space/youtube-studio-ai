import assert from "node:assert/strict";

import { classifyExecutionError } from "@/engine/executionErrors";
import {
  FalImageSubmissionError,
  FalImageTransportError,
  generateFalImage,
} from "@/lib/falImage";
import {
  FAL_FLUX_PRO_V11_MODEL,
  FAL_KONTEXT_MODEL,
  FAL_SCHNELL_MODEL,
  falImageCostUsd,
} from "@/lib/falImagePricing";
import { createImageUsageScope } from "@/lib/imageUsage";

interface FetchCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function responseJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function routeContract(
  args: Parameters<typeof generateFalImage>[0],
  expected: {
    model: string;
    route: string;
    width: number;
    height: number;
    assertBody: (body: Record<string, unknown>) => void;
  },
): Promise<void> {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = requestUrl(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method ?? "GET", ...(body ? { body } : {}) });
    if (url.startsWith("https://fal.run/")) {
      return responseJson({
        images: [{ url: "https://cdn.test/output.jpg", width: expected.width, height: expected.height }],
      });
    }
    assert.equal(url, "https://cdn.test/output.jpg");
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  const bytes = await scope.run(() => generateFalImage({ ...args, maxProviderAttempts: 1 }));
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://fal.run/${expected.model}`);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].body);
  expected.assertBody(calls[0].body!);

  const usage = scope.snapshot();
  assert.equal(usage.calls, 1);
  assert.equal(usage.images, 1);
  assert.equal(usage.records[0].model, expected.model);
  assert.equal(usage.records[0].route, expected.route);
  assert.equal(usage.records[0].width, expected.width);
  assert.equal(usage.records[0].height, expected.height);
  assert.equal(
    usage.costUsd,
    falImageCostUsd({
      model: expected.model,
      width: expected.width,
      height: expected.height,
    }),
  );
}

async function routeSchemasAndPricing(): Promise<void> {
  delete process.env.FAL_IMAGE_MODEL;
  delete process.env.FAL_IMAGE_MODEL_FLASH;
  delete process.env.FAL_IMAGE_I2I_MODEL;

  await routeContract(
    { prompt: "fast picture", tier: "flash", aspectRatio: "16:9" },
    {
      model: FAL_SCHNELL_MODEL,
      route: "schnell",
      width: 1024,
      height: 576,
      assertBody: (body) => {
        assert.equal(body.image_size, "landscape_16_9");
        assert.equal(body.enable_safety_checker, true);
        assert.ok(!("safety_tolerance" in body), "Schnell must not receive the Pro-only safety field");
        assert.ok(!("image_url" in body));
      },
    },
  );

  await routeContract(
    { prompt: "quality picture", tier: "pro", aspectRatio: "4:3" },
    {
      model: FAL_FLUX_PRO_V11_MODEL,
      route: "flux-pro-v1.1",
      width: 1024,
      height: 768,
      assertBody: (body) => {
        assert.equal(body.image_size, "landscape_4_3");
        assert.equal(body.safety_tolerance, "5");
        assert.ok(!("enable_safety_checker" in body));
        assert.ok(!("image_url" in body));
      },
    },
  );

  await routeContract(
    {
      prompt: "edit this reference",
      tier: "flash",
      aspectRatio: "1:1",
      images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
    },
    {
      model: FAL_KONTEXT_MODEL,
      route: "kontext",
      width: 1024,
      height: 1024,
      assertBody: (body) => {
        assert.equal(body.aspect_ratio, "1:1");
        assert.match(String(body.image_url), /^data:image\/png;base64,/);
        assert.ok(!("image_size" in body));
        assert.ok(!("enable_safety_checker" in body));
        assert.ok(!("safety_tolerance" in body));
      },
    },
  );

  assert.equal(
    falImageCostUsd({ model: FAL_SCHNELL_MODEL, width: 1024, height: 576 }),
    (1024 * 576 * 0.003) / 1_000_000,
  );
  assert.equal(
    falImageCostUsd({ model: FAL_FLUX_PRO_V11_MODEL, width: 1344, height: 768 }),
    (1344 * 768 * 0.04) / 1_000_000,
  );
  assert.equal(
    falImageCostUsd({ model: FAL_KONTEXT_MODEL, width: 320, height: 240 }),
    0.04,
  );
}

async function paidReceiptSurvivesCdnFailure(): Promise<void> {
  let providerPosts = 0;
  let cdnAttempts = 0;
  globalThis.fetch = (async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://fal.run/")) {
      providerPosts++;
      return responseJson({
        images: [{ url: "https://cdn.test/retry.jpg", width: 1024, height: 576 }],
      });
    }
    cdnAttempts++;
    return cdnAttempts <= 3
      ? new Response("temporary CDN outage", { status: 503 })
      : new Response(new Uint8Array([9]), { status: 200 });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  await scope.run(async () => {
    let transportError: unknown;
    try {
      await generateFalImage({
        prompt: "receipt-stable prompt",
        tier: "flash",
        maxProviderAttempts: 1,
      });
    } catch (error) {
      transportError = error;
    }
    assert.ok(transportError instanceof FalImageTransportError);
    assert.equal(transportError.retryable, false);
    assert.equal(classifyExecutionError(transportError).retryable, false);
    assert.equal(
      transportError.observedCostUsd,
      (1024 * 576 * 0.003) / 1_000_000,
    );
    assert.equal(transportError.providerReceipt.url, "https://cdn.test/retry.jpg");

    // Simulate an over-eager outer recovery anyway: the async-local paid
    // receipt is reused and only CDN transport runs again.
    const bytes = await generateFalImage({
      prompt: "receipt-stable prompt",
      tier: "flash",
      maxProviderAttempts: 1,
    });
    assert.deepEqual([...bytes], [9]);
  });

  assert.equal(providerPosts, 1, "CDN recovery must never buy a second generation");
  assert.equal(cdnAttempts, 4);
  assert.equal(scope.snapshot().calls, 1, "the paid response is charged exactly once");
  assert.equal(scope.snapshot().cacheHits, 1);
}

async function ambiguousSubmissionIsNeverRepurchased(): Promise<void> {
  for (const failure of ["http", "transport"] as const) {
    let providerPosts = 0;
    globalThis.fetch = (async (input) => {
      assert.match(requestUrl(input), /^https:\/\/fal\.run\//);
      providerPosts++;
      if (failure === "transport") throw new TypeError("fixture connection reset after dispatch");
      return new Response("fixture upstream failure", { status: 503 });
    }) as typeof fetch;

    let submissionError: unknown;
    try {
      // Exercise the production default. No caller-provided retry limit should
      // be required to prevent a second potentially-paid POST.
      await generateFalImage({ prompt: `ambiguous-${failure}`, tier: "flash" });
    } catch (error) {
      submissionError = error;
    }
    assert.ok(submissionError instanceof FalImageSubmissionError);
    assert.equal(submissionError.retryable, false);
    assert.equal(classifyExecutionError(submissionError).retryable, false);
    assert.equal(providerPosts, 1, `${failure} ambiguity must stop before a second paid submission`);
  }
}

async function unknownOverrideFailsBeforeSpend(): Promise<void> {
  process.env.FAL_IMAGE_MODEL_FLASH = "fal-ai/custom-unpriced-model";
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls++;
    throw new Error("network must not be reached");
  }) as typeof fetch;
  await assert.rejects(
    generateFalImage({ prompt: "do not spend", tier: "flash" }),
    /unsupported Fal image model .*add an authoritative request schema and price before enabling it/,
  );
  assert.equal(networkCalls, 0);
  delete process.env.FAL_IMAGE_MODEL_FLASH;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    FAL_KEY: process.env.FAL_KEY,
    FAL_IMAGE_MODEL: process.env.FAL_IMAGE_MODEL,
    FAL_IMAGE_MODEL_FLASH: process.env.FAL_IMAGE_MODEL_FLASH,
    FAL_IMAGE_I2I_MODEL: process.env.FAL_IMAGE_I2I_MODEL,
  };
  process.env.FAL_KEY = "test-fal-key";
  try {
    await routeSchemasAndPricing();
    await paidReceiptSurvivesCdnFailure();
    await ambiguousSubmissionIsNeverRepurchased();
    await unknownOverrideFailsBeforeSpend();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log("FAL IMAGE CONTRACT PASS: exact pricing, receipt recovery, no ambiguous paid resubmission");
}

void main();
