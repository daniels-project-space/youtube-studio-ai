import assert from "node:assert/strict";

import {
  FAL_NANO_BANANA_2_MODEL,
  FalNanoBananaTransportError,
  generateFalNanoBanana2Image,
} from "@/lib/falNanoBanana";
import { createImageUsageScope } from "@/lib/imageUsage";

interface FetchCall {
  url: string;
  method: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function textAndEditContracts(): Promise<void> {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = requestUrl(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : undefined;
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
      ...(body ? { body } : {}),
    });
    if (url.startsWith("https://fal.run/")) {
      const edit = url.endsWith("/edit");
      return jsonResponse(
        {
          images: [{
            url: edit ? "https://cdn.test/edit.png" : "https://cdn.test/text.png",
            content_type: "image/png",
            width: edit ? 1280 : 1536,
            height: edit ? 720 : 1024,
          }],
          description: "",
        },
        { "x-fal-request-id": edit ? "edit-request" : "text-request" },
      );
    }
    assert.ok(url.startsWith("https://cdn.test/"));
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  const result = await scope.run(async () => ({
    text: await generateFalNanoBanana2Image({
      prompt: "a carefully composed cinematic lighthouse on a stormy coast",
      aspectRatio: "3:2",
      resolution: "1K",
      outputFormat: "png",
      idempotencyContext: "run:text",
    }),
    edit: await generateFalNanoBanana2Image({
      prompt: "create the locked storyboard frame using the supplied character sheet",
      aspectRatio: "16:9",
      resolution: "1K",
      outputFormat: "png",
      idempotencyContext: "run:edit",
      referenceImages: [{ bytes: new Uint8Array([7, 8, 9]), contentType: "image/png" }],
    }),
  }));

  assert.deepEqual([...result.text.bytes], [1, 2, 3]);
  assert.equal(result.text.receipt.model, FAL_NANO_BANANA_2_MODEL);
  assert.equal(result.text.receipt.route, "text-to-image");
  assert.equal(result.text.receipt.responseId, "text-request");
  assert.equal(result.text.receipt.width, 1536);
  assert.equal(result.text.receipt.height, 1024);
  assert.match(result.text.receipt.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(result.text.receipt.responseSha256, /^[a-f0-9]{64}$/);

  assert.deepEqual([...result.edit.bytes], [1, 2, 3]);
  assert.equal(result.edit.receipt.model, `${FAL_NANO_BANANA_2_MODEL}/edit`);
  assert.equal(result.edit.receipt.route, "image-edit");
  assert.equal(result.edit.receipt.responseId, "edit-request");
  assert.deepEqual(result.edit.receipt.referenceSha256.length, 1);

  const textRequest = calls[0];
  assert.equal(textRequest.url, `https://fal.run/${FAL_NANO_BANANA_2_MODEL}`);
  assert.equal(textRequest.method, "POST");
  assert.equal(textRequest.authorization, "Key test-fal-key");
  assert.deepEqual(textRequest.body, {
    prompt: "a carefully composed cinematic lighthouse on a stormy coast",
    num_images: 1,
    seed: textRequest.body?.seed,
    aspect_ratio: "3:2",
    output_format: "png",
    safety_tolerance: "4",
    sync_mode: false,
    resolution: "1K",
    limit_generations: true,
  });
  assert.equal(typeof textRequest.body?.seed, "number");

  const editRequest = calls[2];
  assert.equal(editRequest.url, `https://fal.run/${FAL_NANO_BANANA_2_MODEL}/edit`);
  assert.deepEqual(editRequest.body?.image_urls, ["data:image/png;base64,BwgJ"]);
  assert.equal(editRequest.body?.aspect_ratio, "16:9");
  assert.equal(editRequest.body?.resolution, "1K");

  const usage = scope.snapshot();
  assert.equal(usage.calls, 2);
  assert.equal(usage.images, 2);
  assert.equal(usage.costUsd, 0.16);
  assert.deepEqual(usage.records.map((record) => record.route), ["text-to-image", "image-edit"]);
}

async function paidCdnFailureIsNeverRepurchased(): Promise<void> {
  let providerPosts = 0;
  let cdnCalls = 0;
  let restoreCdn = false;
  globalThis.fetch = (async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://fal.run/")) {
      providerPosts += 1;
      return jsonResponse({
        images: [{
          url: "https://cdn.test/recoverable.png",
          content_type: "image/png",
          width: 1536,
          height: 1024,
        }],
      }, { "x-fal-request-id": "paid-request" });
    }
    cdnCalls += 1;
    if (!restoreCdn) return new Response("unavailable", { status: 503 });
    return new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  const request = {
    prompt: "a stable paid render",
    idempotencyContext: "run:recover",
  };
  await assert.rejects(
    () => scope.run(() => generateFalNanoBanana2Image(request)),
    (error: unknown) => error instanceof FalNanoBananaTransportError && error.observedCostUsd === 0.08,
  );
  restoreCdn = true;
  const recovered = await scope.run(() => generateFalNanoBanana2Image(request));
  assert.deepEqual([...recovered.bytes], [4, 5, 6]);
  assert.equal(providerPosts, 1, "a CDN failure must reuse the paid Fal receipt");
  assert.equal(cdnCalls, 4);
  assert.equal(scope.snapshot().calls, 1);
  assert.equal(scope.snapshot().cacheHits, 1);
}

async function costGuardFailsBeforeSpend(): Promise<void> {
  const originalCost = process.env.FAL_NANO_BANANA_2_COST_USD;
  delete process.env.FAL_NANO_BANANA_2_COST_USD;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("must not be called");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => generateFalNanoBanana2Image({ prompt: "must fail before Fal is called" }),
      /FAL_NANO_BANANA_2_COST_USD/,
    );
    assert.equal(called, false);
  } finally {
    if (originalCost === undefined) delete process.env.FAL_NANO_BANANA_2_COST_USD;
    else process.env.FAL_NANO_BANANA_2_COST_USD = originalCost;
  }
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    FAL_KEY: process.env.FAL_KEY,
    FAL_NANO_BANANA_2_COST_USD: process.env.FAL_NANO_BANANA_2_COST_USD,
  };
  process.env.FAL_KEY = "test-fal-key";
  process.env.FAL_NANO_BANANA_2_COST_USD = "0.08";
  try {
    await textAndEditContracts();
    await paidCdnFailureIsNeverRepurchased();
    await costGuardFailsBeforeSpend();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log("FAL NANO BANANA 2 CONTRACT PASS: exact schema, visual references, receipts, and no repurchase");
}

void main();
