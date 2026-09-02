import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FalNanoBananaProThumbnailSubmissionError,
  generateFalNanoBananaProThumbnailWithReceipt,
} from "@/lib/falNanoBananaProThumbnail";
import { FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE as PROFILE } from "@/lib/falNanoBananaProThumbnailContract";
import { solidImage } from "@/lib/ffmpeg";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "fal-nano-banana-pro-test-"));
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FAL_KEY;
  try {
    const providerPath = await solidImage(join(root, "provider.png"), 2_048, 1_152, "#10203a");
    const providerBytes = await readFile(providerPath);
    process.env.FAL_KEY = "fixture-fal-key";
    let submissions = 0;
    let downloads = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === `https://fal.run/${PROFILE.model}`) {
        submissions += 1;
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body["prompt"], `Render exact headline "$1K/MO" then "CASH ENGINE".`);
        assert.equal(body["resolution"], "2K");
        assert.equal(body["aspect_ratio"], "16:9");
        assert.equal(body["image_urls"], undefined, "native Pro route must never attach Golden/reference images");
        return new Response(JSON.stringify({
          request_id: "fixture-native-pro",
          images: [{
            url: "https://fal.media/native-pro.png",
            content_type: "image/png",
            width: 2_048,
            height: 1_152,
            file_size: providerBytes.byteLength,
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json", "x-fal-request-id": "fixture-native-pro" },
        });
      }
      if (url === "https://fal.media/native-pro.png") {
        downloads += 1;
        return new Response(providerBytes, { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const result = await generateFalNanoBananaProThumbnailWithReceipt({
      prompt: `Render exact headline "$1K/MO" then "CASH ENGINE".`,
      idempotencyContext: "fixture-native-pro-success",
    });
    assert.equal(submissions, 1);
    assert.equal(downloads, 1);
    assert.deepEqual(result.bytes, providerBytes);
    assert.equal(result.receipt.provider, "fal");
    assert.equal(result.receipt.model, "fal-ai/nano-banana-pro");
    assert.equal(result.receipt.route, "fal-nano-banana-pro-native-thumbnail");
    assert.equal(result.receipt.width, 2_048);
    assert.equal(result.receipt.height, 1_152);
    assert.equal(result.receipt.costUsd, 0.15);
    assert.match(result.receipt.providerRequestSha256, /^[a-f0-9]{64}$/);
    assert.match(result.receipt.responseSha256, /^[a-f0-9]{64}$/);

    let ambiguousSubmissions = 0;
    globalThis.fetch = (async () => {
      ambiguousSubmissions += 1;
      throw new Error("socket closed after submission");
    }) as typeof fetch;
    await assert.rejects(
      generateFalNanoBananaProThumbnailWithReceipt({
        prompt: "A second valid native thumbnail prompt",
        idempotencyContext: "fixture-native-pro-ambiguous",
      }),
      (error: unknown) =>
        error instanceof FalNanoBananaProThumbnailSubmissionError && error.retryable === false,
    );
    assert.equal(ambiguousSubmissions, 1, "ambiguous paid submissions must never be replayed");
    console.log("Fal Nano Banana Pro thumbnail tests: ok");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}

void main();
