import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  generateFalNanoBananaLofiThumbnailWithReceipt,
} from "@/lib/falNanoBananaLofiThumbnail";
import { FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaLofiThumbnailContract";
import { createImageUsageScope } from "@/lib/imageUsage";

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
  const profile = FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE;
  assert.equal(profile.provider, "fal");
  assert.equal(profile.model, "fal-ai/nano-banana/edit");
  assert.equal(profile.aspectRatio, "16:9");
  assert.equal(profile.outputImageUsd, 0.039);

  const previousFetch = globalThis.fetch;
  const previousFalKey = process.env.FAL_KEY;
  const referencePng = pngHeader(1_280, 720);
  const typographyMattePng = pngHeader(1_280, 720);
  const providerPng = pngHeader(1_344, 768);
  let submissions = 0;
  let downloads = 0;
  try {
    process.env.FAL_KEY = "fixture-fal-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://fal.run/fal-ai/nano-banana/edit") {
        submissions += 1;
        assert.equal(init?.method, "POST");
        assert.equal((init?.headers as Record<string, string>).Authorization, "Key fixture-fal-key");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.aspect_ratio, "16:9");
        assert.equal(body.output_format, "png");
        assert.equal(body.num_images, 1);
        assert.equal(body.limit_generations, true);
        assert.match(String(body.prompt), /"Night Focus"/);
        assert.match(String(body.prompt), /"4K"/);
        const imageUrls = body.image_urls as string[];
        assert.equal(imageUrls.length, 2);
        assert.match(imageUrls[1] ?? "", /^data:image\/png;base64,/);
        assert.deepEqual(
          Buffer.from((imageUrls[1] ?? "").split(",", 2)[1] ?? "", "base64"),
          referencePng,
        );
        assert.match(imageUrls[0] ?? "", /^data:image\/png;base64,/);
        assert.deepEqual(
          Buffer.from((imageUrls[0] ?? "").split(",", 2)[1] ?? "", "base64"),
          typographyMattePng,
        );
        return new Response(JSON.stringify({
          images: [{
            url: "https://fal.media/files/fixture/lofi-thumbnail.png",
            content_type: "image/png",
            file_name: "lofi-thumbnail.png",
            width: 1_344,
            height: 768,
          }],
          description: "Lo-Fi frame edit",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-fal-request-id": "fixture-lofi-request",
          },
        });
      }
      if (url === "https://fal.media/files/fixture/lofi-thumbnail.png") {
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
    const generate = () => generateFalNanoBananaLofiThumbnailWithReceipt({
      prompt: "Preserve the supplied frame. Add exactly \"Night Focus\" and \"4K\".",
      referenceImage: referencePng,
      referenceMimeType: "image/png",
      typographyMatteImage: typographyMattePng,
      typographyMatteMimeType: "image/png",
      idempotencyContext: "owner-fixture/channel-fixture/run-fixture/lofi-thumbnail-attempt-1",
    });
    const first = await usageScope.run(async () => {
      const result = await generate();
      const cached = await generate();
      assert.equal(cached.receipt.providerRequestId, result.receipt.providerRequestId);
      return result;
    });
    assert.equal(submissions, 1, "the accepted Fal edit must not be purchased twice");
    assert.equal(downloads, 2, "the same paid output URL may be redownloaded after transport loss");
    assert.deepEqual(first.bytes, providerPng);
    assert.equal(first.receipt.provider, "fal");
    assert.equal(first.receipt.model, "fal-ai/nano-banana/edit");
    assert.equal(first.receipt.route, profile.route);
    assert.equal(first.receipt.referenceSha256, createHash("sha256").update(referencePng).digest("hex"));
    assert.equal(
      first.receipt.typographyMatteSha256,
      createHash("sha256").update(typographyMattePng).digest("hex"),
    );
    assert.equal(first.receipt.costUsd, 0.039);
    const usage = usageScope.snapshot();
    assert.equal(usage.calls, 1);
    assert.equal(usage.cacheHits, 1);
    assert.equal(usage.records[0]?.provider, "fal");
    assert.equal(usage.records[0]?.route, profile.route);

    await assert.rejects(
      generateFalNanoBananaLofiThumbnailWithReceipt({
        prompt: "wrong MIME",
        referenceImage: referencePng,
        referenceMimeType: "image/jpeg",
        typographyMatteImage: typographyMattePng,
        typographyMatteMimeType: "image/png",
        idempotencyContext: "invalid-reference-fixture",
      }),
      /MIME image\/jpeg does not match image\/png bytes/,
    );
    assert.equal(submissions, 1, "invalid reference evidence must stop before provider submission");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousFalKey;
  }

  console.log("FAL NANO BANANA LOFI THUMBNAIL ROUTING PASS");
}

void main();
