import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getDepthMap } from "@/lib/depth";

const renderBlockSource = readFileSync(
  new URL("../../trigger/render-block.ts", import.meta.url),
  "utf8",
);
const depthSource = readFileSync(new URL("../depth.ts", import.meta.url), "utf8");
const documotionSource = readFileSync(new URL("../documotion.ts", import.meta.url), "utf8");
const runPipelineSource = readFileSync(
  new URL("../../trigger/runPipeline.ts", import.meta.url),
  "utf8",
);

// A heavy remote child can run DocuMotion's paid FAL/TTS path. A crash/OOM is
// therefore an ambiguous post-spend failure until durable per-operation resume
// exists; Trigger must not replay the whole child automatically.
assert.match(renderBlockSource, /retry:\s*\{\s*maxAttempts:\s*1,/);
assert.match(renderBlockSource, /must reconcile rather than make\s*\n\s*\/\/ Trigger replay the entire child attempt/i);

// The parent converts a failed post-dispatch DocuMotion child into the same
// durable reconciliation marker the runner understands. The amount is
// explicitly unknown until the later receipt layer can authoritatively recover
// it, and the run-level healer must not mint h+1 from that error.
assert.match(runPipelineSource, /blockId === "documotion_short"/);
assert.match(runPipelineSource, /provider cost is UNKNOWN and automatic replay\/heal is forbidden/);
assert.match(runPipelineSource, /let childDispatchStarted = false/);
assert.match(runPipelineSource, /childDispatchStarted = true/);
assert.match(
  runPipelineSource,
  /result\.error\?\.includes\(PAID_STAGE_RECONCILIATION_MARKER\)/,
);

// The foreground-cutout helper used to try a second paid FAL model if a first
// model's returned CDN URL failed delivery. Its caller already falls back to
// the full image, so a single submitted model is the only safe retry boundary.
const removeBackgroundSource = documotionSource.slice(
  documotionSource.indexOf("async function removeBackground"),
  documotionSource.indexOf("async function deriveDepthLayers"),
);
assert.match(removeBackgroundSource, /const endpoint = "fal-ai\/birefnet\/v2"/);
assert.doesNotMatch(removeBackgroundSource, /for \(const ep|fal-ai\/birefnet"\]/);
assert.match(removeBackgroundSource, /await downloadTo\(url, outPng\)/);
assert.match(
  documotionSource,
  /bg-removal failed[\s\S]{0,300}using full image/,
  "a one-model cutout failure must use the existing no-extra-spend full-image degradation",
);

// FAL can successfully return a billable output URL while its delivery CDN
// fails. That must surface to DocuMotion's existing Ken-Burns degradation, not
// submit a second paid depth prediction to Replicate.
const originalFetch = globalThis.fetch;
const originalFalKey = process.env.FAL_KEY;
const requests: Array<{ url: string; method: string }> = [];
async function main(): Promise<void> {
  try {
    process.env.FAL_KEY = "test-fal-key";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url === "https://fal.run/fal-ai/imageutils/marigold-depth") {
        return new Response(JSON.stringify({ image: { url: "https://depth-cdn.test/depth.png" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://depth-cdn.test/depth.png") {
        return new Response("temporarily unavailable", { status: 503 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    };

    await assert.rejects(
      () => getDepthMap("data:image/jpeg;base64,AA==", "/tmp/depth-never-written.png"),
      /depth: download failed HTTP 503/,
    );
    assert.deepEqual(requests, [
      { url: "https://fal.run/fal-ai/imageutils/marigold-depth", method: "POST" },
      { url: "https://depth-cdn.test/depth.png", method: "GET" },
    ]);
    assert.doesNotMatch(depthSource, /api\.replicate\.com|REPLICATE_API_TOKEN|trying replicate/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalFalKey;
  }

  console.log("DocuMotion paid retry safety tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
