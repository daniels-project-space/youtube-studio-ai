import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import {
  downloadTo,
  DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
} from "@/lib/files";
import { getObjectBytes } from "@/lib/storage";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

async function stalledDurableOutputReattachesWithoutAnotherRender(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "novita-durable-delivery-"));
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  try {
    let fetchCalls = 0;
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      observedSignal = init?.signal ?? undefined;
      assert.ok(observedSignal, "durable Novita output delivery carries an opt-in deadline");
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          keepAlive = setInterval(() => undefined, 1_000);
          observedSignal!.addEventListener("abort", () => {
            if (keepAlive) clearInterval(keepAlive);
            controller.error(observedSignal!.reason);
          }, { once: true });
        },
      }), { status: 200 });
    };

    let failure: unknown;
    try {
      await downloadTo("https://r2.example.test/durable-novita-output.mp4", join(directory, "clip.mp4"), {
        timeoutMs: 25,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error, "a dead durable-output body exits before the task hard cap");
    assert.equal(fetchCalls, 1, "the timed-out transfer itself is never retried or duplicated");
    assert.equal(observedSignal!.aborted, true, "the local transfer deadline aborts the stream");

    // Keep the existing retry policy: a transport timeout retries the block.
    // The direct controller below makes that retry a durable R2 reattachment,
    // not another GPU submission.
    const retry = taskErrorForRetryPolicy(failure);
    assert.equal(retry.classification.kind, "transient");
    assert.equal(retry.error, failure);

    const controller = await readFile(join(process.cwd(), "src/lib/novitaDirectRender.ts"), "utf8");
    const incompleteArtifactGuard = controller.indexOf("if (!await artifactIsComplete(worker)) {");
    const paidWaveDispatch = controller.indexOf("const receipts = await renderNovitaWorkerWave({");
    assert.ok(incompleteArtifactGuard >= 0 && paidWaveDispatch > incompleteArtifactGuard,
      "only an incomplete artifact may enter the paid direct-worker wave");
    assert.match(
      controller.slice(incompleteArtifactGuard, paidWaveDispatch),
      /if \(!await artifactIsComplete\(worker\)\) \{\s*wave\.push\(worker\);\s*\}/,
      "a retry with the same complete R2 key dispatches zero new direct workers",
    );
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
}

async function stalledR2ObjectBodyIsBounded(): Promise<void> {
  const prototype = S3Client.prototype as unknown as {
    send: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  };
  const originalSend = prototype.send;
  const savedEnv = {
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  };
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  try {
    process.env.R2_ENDPOINT = "https://r2.example.test";
    process.env.R2_ACCESS_KEY_ID = "test-access-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.R2_BUCKET = "test-bucket";
    let calls = 0;
    let observedSignal: AbortSignal | undefined;
    let destroyed = 0;
    let cancelled = 0;
    prototype.send = async (_command, options) => {
      calls += 1;
      observedSignal = options?.abortSignal;
      keepAlive = setInterval(() => undefined, 1_000);
      return {
        Body: {
          transformToByteArray: async () => await new Promise<Uint8Array>(() => undefined),
          destroy: () => { destroyed += 1; },
          cancel: async () => { cancelled += 1; },
        },
      };
    };
    await assert.rejects(
      () => getObjectBytes("durable-novita-output.mp4", undefined, { timeoutMs: 25 }),
      /timed out|timeout/i,
    );
    assert.equal(calls, 1, "a stalled R2 object body sends exactly one request");
    assert.ok(observedSignal?.aborted, "the object request carries and reaches its deadline");
    assert.equal(destroyed, 1, "the deadline tears down a Node-style R2 body");
    assert.equal(cancelled, 1, "the deadline also cancels a Web-style R2 body");
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    prototype.send = originalSend;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function directNovitaCallersUseOnlyTheOptInDeadline(): Promise<void> {
  assert.equal(DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS, 300_000,
    "five minutes protects the 1920×1088 still and short 1280×704 LTX output without task-cap stalls");
  const lofi = await readFile(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8");
  const keyframeDelivery = lofi.indexOf("const local = await downloadTo(rendered.url");
  const clipDelivery = lofi.indexOf("const local = await downloadTo(clip.url", keyframeDelivery + 1);
  assert.ok(keyframeDelivery >= 0 && clipDelivery > keyframeDelivery);
  assert.match(
    lofi.slice(keyframeDelivery, keyframeDelivery + 260),
    /timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS/,
    "the post-receipt Novita still delivery opts in without changing global downloads",
  );
  assert.match(
    lofi.slice(clipDelivery, clipDelivery + 220),
    /timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS/,
    "the post-receipt Novita clip delivery opts in without changing global downloads",
  );
  for (const relative of [
    "src/lib/novitaMedia.ts",
    "src/trigger/blocks/loreShortBlocks.ts",
    "src/trigger/blocks/genFootageBlocks.ts",
    "src/engine/forge/runtime.ts",
  ]) {
    const source = await readFile(join(process.cwd(), relative), "utf8");
    assert.match(
      source,
      /timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS/,
      `${relative} bounds only its direct Novita delivery after durable output`,
    );
  }
  const channelArt = await readFile(join(process.cwd(), "src/lib/channelArt.ts"), "utf8");
  assert.doesNotMatch(channelArt, /renderNovitaImage|downloadTo\(|DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS/,
    "channel art now uses the receipt-bound Fal route and must not be classified as a direct Novita delivery");
}

async function main(): Promise<void> {
  await stalledDurableOutputReattachesWithoutAnotherRender();
  await stalledR2ObjectBodyIsBounded();
  await directNovitaCallersUseOnlyTheOptInDeadline();
  console.log("NOVITA DURABLE DELIVERY PASS: bounded transfers reattach complete R2 artifacts without new worker spend");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
