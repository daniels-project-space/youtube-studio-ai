import assert from "node:assert/strict";

import { classifyExecutionError } from "@/engine/executionErrors";
import {
  FalNanoBananaWideSubmissionError,
  FalNanoBananaWideTransportError,
  generateFalNanoBananaWideImageWithReceipt,
} from "@/lib/falNanoBananaWideImage";
import { FAL_NANO_BANANA_BANNER_PROFILE } from "@/lib/falNanoBananaBannerContract";
import { createImageUsageScope } from "@/lib/imageUsage";

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function nativePictureOnlyContract(): Promise<void> {
  const image = pngHeader(1344, 756);
  let providerPosts = 0;
  let cdnGets = 0;
  globalThis.fetch = (async (input, init) => {
    const url = requestUrl(input);
    if (url.startsWith("https://fal.run/")) {
      providerPosts++;
      assert.equal(url, "https://fal.run/fal-ai/nano-banana/edit");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.num_images, 1);
      assert.equal(body.aspect_ratio, "16:9");
      assert.equal(body.output_format, "png");
      assert.equal(body.limit_generations, true);
      assert.match(String(body.prompt), /PICTURE ONLY, NO TEXT/i);
      assert.deepEqual(body.image_urls, ["data:image/png;base64,AAAA"]);
      assert.ok(!("image_url" in body));
      return new Response(JSON.stringify({
        request_id: "provider-request-01",
        images: [{
          url: "https://cdn.test/native.png",
          content_type: "image/png",
          width: 1344,
          height: 756,
          file_size: image.byteLength,
        }],
      }), { status: 200, headers: { "content-type": "application/json", "x-fal-request-id": "header-request-01" } });
    }
    assert.equal(url, "https://cdn.test/native.png");
    cdnGets++;
    return new Response(Buffer.from(image), { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  await scope.run(async () => {
    const first = await generateFalNanoBananaWideImageWithReceipt({
      profile: FAL_NANO_BANANA_BANNER_PROFILE,
      prompt: "a quiet marble philosopher at dawn",
      idempotencyContext: "owner/channel/art/banner/v1/candidate-01",
      label: "fixture banner",
      referenceImageDataUri: "data:image/png;base64,AAAA",
    });
    const second = await generateFalNanoBananaWideImageWithReceipt({
      profile: FAL_NANO_BANANA_BANNER_PROFILE,
      prompt: "a quiet marble philosopher at dawn",
      idempotencyContext: "owner/channel/art/banner/v1/candidate-01",
      label: "fixture banner",
      referenceImageDataUri: "data:image/png;base64,AAAA",
    });
    assert.deepEqual([...first.bytes], [...image]);
    assert.deepEqual([...second.bytes], [...image]);
    assert.equal(first.receipt.providerRequestId, "header-request-01");
    assert.equal(first.receipt.width, 1344);
    assert.equal(first.receipt.height, 756);
    assert.equal(first.receipt.sourceContentType, "image/png");
    assert.equal(first.receipt.costUsd, 0.039);
    assert.match(first.receipt.providerRequestCanonicalJson, /fal-ai\/nano-banana/);
  });
  assert.equal(providerPosts, 1, "the same idempotency context must never buy a second image in one run");
  assert.equal(cdnGets, 2, "only the provider response is reused; the stored output is re-downloaded");
  const usage = scope.snapshot();
  assert.equal(usage.calls, 1);
  assert.equal(usage.cacheHits, 1);
  assert.equal(usage.costUsd, 0.039);
  assert.equal(usage.records[0].route, FAL_NANO_BANANA_BANNER_PROFILE.route);
}

async function paidReceiptSurvivesCdnFailure(): Promise<void> {
  const image = pngHeader(1280, 720);
  let providerPosts = 0;
  let cdnGets = 0;
  globalThis.fetch = (async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://fal.run/")) {
      providerPosts++;
      return new Response(JSON.stringify({
        images: [{ url: "https://cdn.test/recovery.png", content_type: "image/png", width: 1280, height: 720, file_size: image.byteLength }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    cdnGets++;
    return cdnGets <= 3
      ? new Response("temporary CDN outage", { status: 503 })
      : new Response(Buffer.from(image), { status: 200 });
  }) as typeof fetch;

  const scope = createImageUsageScope();
  await scope.run(async () => {
    await assert.rejects(
      generateFalNanoBananaWideImageWithReceipt({
        profile: FAL_NANO_BANANA_BANNER_PROFILE,
        prompt: "mist over an ancient forum",
        idempotencyContext: "owner/channel/art/banner/v1/candidate-cdn",
        label: "fixture banner",
        referenceImageDataUri: "data:image/png;base64,AAAA",
      }),
      (error: unknown) => {
        assert.ok(error instanceof FalNanoBananaWideTransportError);
        assert.equal(error.retryable, false);
        assert.equal(classifyExecutionError(error).retryable, false);
        return true;
      },
    );
    const recovered = await generateFalNanoBananaWideImageWithReceipt({
      profile: FAL_NANO_BANANA_BANNER_PROFILE,
      prompt: "mist over an ancient forum",
      idempotencyContext: "owner/channel/art/banner/v1/candidate-cdn",
      label: "fixture banner",
      referenceImageDataUri: "data:image/png;base64,AAAA",
    });
    assert.deepEqual([...recovered.bytes], [...image]);
  });
  assert.equal(providerPosts, 1, "recovery must reuse the paid provider receipt");
  assert.equal(cdnGets, 4);
  assert.equal(scope.snapshot().calls, 1);
}

async function invalidOrAmbiguousOutputFailsClosed(): Promise<void> {
  let providerPosts = 0;
  globalThis.fetch = (async (input) => {
    assert.match(requestUrl(input), /^https:\/\/fal\.run\//);
    providerPosts++;
    return new Response("upstream unavailable", { status: 503 });
  }) as typeof fetch;
  await assert.rejects(
    generateFalNanoBananaWideImageWithReceipt({
      profile: FAL_NANO_BANANA_BANNER_PROFILE,
      prompt: "must not retry an ambiguous paid request",
      idempotencyContext: "owner/channel/art/banner/v1/candidate-ambiguous",
      label: "fixture banner",
      referenceImageDataUri: "data:image/png;base64,AAAA",
    }),
    (error: unknown) => {
      assert.ok(error instanceof FalNanoBananaWideSubmissionError);
      assert.equal(error.retryable, false);
      assert.equal(classifyExecutionError(error).retryable, false);
      return true;
    },
  );
  assert.equal(providerPosts, 1);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalFalKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-fal-key";
  try {
    await nativePictureOnlyContract();
    await paidReceiptSurvivesCdnFailure();
    await invalidOrAmbiguousOutputFailsClosed();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalFalKey;
  }
  console.log("FAL NANO BANANA WIDE IMAGE PASS: picture-only, receipt recovery, no ambiguous repurchase");
}

void main();
