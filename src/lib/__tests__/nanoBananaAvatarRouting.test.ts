import assert from "node:assert/strict";

import { createImageUsageScope } from "@/lib/imageUsage";
import { generateFalNanoBananaAvatarImageWithReceipt } from "@/lib/falNanoBananaAvatar";
import { NANO_BANANA_AVATAR_PROFILE } from "@/lib/nanoBananaAvatarContract";

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function main(): Promise<void> {
  assert.equal(NANO_BANANA_AVATAR_PROFILE.provider, "fal");
  assert.equal(NANO_BANANA_AVATAR_PROFILE.model, "fal-ai/nano-banana");
  assert.equal(NANO_BANANA_AVATAR_PROFILE.aspectRatio, "1:1");
  assert.equal(NANO_BANANA_AVATAR_PROFILE.providerOutputWidth, 1_024);
  assert.equal(NANO_BANANA_AVATAR_PROFILE.providerOutputHeight, 1_024);
  assert.equal(NANO_BANANA_AVATAR_PROFILE.outputImageUsd, 0.039);

  const previousFetch = globalThis.fetch;
  const previousFalKey = process.env.FAL_KEY;
  const providerPng = pngHeader(1_024, 1_024);
  let submissions = 0;
  let downloads = 0;
  try {
    process.env.FAL_KEY = "fixture-fal-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://fal.run/fal-ai/nano-banana") {
        submissions += 1;
        assert.equal(init?.method, "POST");
        assert.equal((init?.headers as Record<string, string>).Authorization, "Key fixture-fal-key");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.aspect_ratio, "1:1");
        assert.equal(body.output_format, "png");
        assert.equal(body.num_images, 1);
        assert.equal(body.limit_generations, true);
        assert.match(String(body.prompt), /ABSOLUTE RULE — PICTURE ONLY, NO TEXT/);
        return new Response(JSON.stringify({
          images: [{
            url: "https://fal.media/files/fixture/avatar.png",
            content_type: "image/png",
            file_name: "avatar.png",
            width: 1_024,
            height: 1_024,
          }],
          description: "one square identity mark",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-fal-request-id": "fixture-avatar-request",
          },
        });
      }
      if (url === "https://fal.media/files/fixture/avatar.png") {
        downloads += 1;
        const body = providerPng.buffer.slice(
          providerPng.byteOffset,
          providerPng.byteOffset + providerPng.byteLength,
        ) as ArrayBuffer;
        return new Response(body, { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const usageScope = createImageUsageScope();
    const generate = () => generateFalNanoBananaAvatarImageWithReceipt({
      prompt: "One bold, centered, text-free channel identity mark",
      idempotencyContext: "owner-fixture/channel-fixture/avatar-v1/attempt-1",
    });
    const first = await usageScope.run(async () => {
      const result = await generate();
      const cached = await generate();
      assert.equal(cached.receipt.providerRequestId, result.receipt.providerRequestId);
      return result;
    });
    assert.equal(submissions, 1, "the accepted Fal response must be reused inside one usage scope");
    assert.equal(downloads, 2, "a cached paid response may safely redownload the same output URL");
    assert.deepEqual(first.bytes, providerPng);
    assert.equal(first.receipt.provider, NANO_BANANA_AVATAR_PROFILE.provider);
    assert.equal(first.receipt.model, NANO_BANANA_AVATAR_PROFILE.model);
    assert.equal(first.receipt.route, NANO_BANANA_AVATAR_PROFILE.route);
    assert.equal(first.receipt.width, 1_024);
    assert.equal(first.receipt.height, 1_024);
    assert.equal(first.receipt.costUsd, 0.039);
    assert.equal(first.receipt.providerRequestId, "fixture-avatar-request");
    const usage = usageScope.snapshot();
    assert.equal(usage.calls, 1);
    assert.equal(usage.cacheHits, 1);
    assert.equal(usage.records[0]?.provider, "fal");
    assert.equal(usage.records[0]?.route, NANO_BANANA_AVATAR_PROFILE.route);
    assert.equal(usage.records[0]?.width, 1_024);
    assert.equal(usage.records[0]?.height, 1_024);

    await assert.rejects(
      generateFalNanoBananaAvatarImageWithReceipt({
        prompt: "x".repeat(NANO_BANANA_AVATAR_PROFILE.maxPromptUtf8Bytes),
        idempotencyContext: "oversized-avatar-fixture",
      }),
      /fail-closed maximum/,
    );
    assert.equal(submissions, 1, "an oversized avatar prompt must fail before provider submission");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousFalKey;
  }

  console.log("FAL NANO BANANA AVATAR ROUTING PASS");
}

void main();
