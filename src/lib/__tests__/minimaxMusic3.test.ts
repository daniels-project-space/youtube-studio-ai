import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  assertPinnedMiniMaxMusic3Receipt,
  generateMiniMaxMusic3,
  hasQualifiedMiniMaxMusic3,
  MINIMAX_MUSIC3_BITS_PER_SAMPLE,
  MINIMAX_MUSIC3_CHANNELS,
  MINIMAX_MUSIC3_COMFYUI_REPOSITORY,
  MINIMAX_MUSIC3_COMFYUI_REVISION,
  MINIMAX_MUSIC3_MODEL,
  MINIMAX_MUSIC3_MODEL_REVISION,
  MINIMAX_MUSIC3_SAMPLE_RATE_HZ,
  MINIMAX_MUSIC3_UI_ATTRIBUTION,
  MINIMAX_MUSIC3_WORKER_CONTRACT,
  minimaxMusic3Readiness,
  MiniMaxMusic3Error,
  type MiniMaxMusic3Receipt,
} from "@/lib/minimaxMusic3";

const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pcmWav(durationSec: number): Uint8Array {
  const dataBytes = durationSec * MINIMAX_MUSIC3_SAMPLE_RATE_HZ * MINIMAX_MUSIC3_CHANNELS * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(MINIMAX_MUSIC3_CHANNELS, 22);
  buffer.writeUInt32LE(MINIMAX_MUSIC3_SAMPLE_RATE_HZ, 24);
  buffer.writeUInt32LE(MINIMAX_MUSIC3_SAMPLE_RATE_HZ * MINIMAX_MUSIC3_CHANNELS * 2, 28);
  buffer.writeUInt16LE(MINIMAX_MUSIC3_CHANNELS * 2, 32);
  buffer.writeUInt16LE(MINIMAX_MUSIC3_BITS_PER_SAMPLE, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let offset = 44; offset < buffer.length; offset += 2) {
    buffer.writeInt16LE(Math.round(Math.sin(offset / 17) * 8_000), offset);
  }
  return new Uint8Array(buffer);
}

async function main(): Promise<void> {
  delete process.env.MINIMAX_MUSIC3_WORKER_URL;
  delete process.env.MINIMAX_MUSIC3_WORKER_TOKEN;
  assert.equal(minimaxMusic3Readiness().configured, false);

  process.env.MINIMAX_MUSIC3_WORKER_URL = "https://music-worker.example/v1/generate";
  process.env.MINIMAX_MUSIC3_WORKER_TOKEN = "minimax-test-token-that-is-longer-than-thirty-two-characters";
  process.env.MINIMAX_MUSIC3_QUALITY_QUALIFIED = "1";
  process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256 = "a".repeat(64);
  process.env.MINIMAX_MUSIC3_LICENSE_ATTESTED = "1";
  process.env.MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED = "1";
  process.env.MINIMAX_MUSIC3_DISCLOSURE_ENABLED = "1";
  process.env.MINIMAX_MUSIC3_SAFEGUARDS_ATTESTED = "1";
  assert.equal(hasQualifiedMiniMaxMusic3(), true);

  const program = createChannelMusicProgram({
    channelId: "channel-rain",
    channelIdentityFingerprint: "b".repeat(64),
    family: "music_loop",
    contentLaneKey: "music_loop",
    topic: "Last tram through warm rain",
    providerPreference: "minimax_music3",
    durationSec: 10,
    genre: "rainy late-night lo-fi hip-hop",
    instrumentation: ["Rhodes piano", "upright bass", "soft boom-bap drums"],
    textures: ["vinyl grain", "tape warmth"],
    bpmRange: [70, 78],
  });
  const audio = pcmWav(program.generation.durationSec);
  let postCount = 0;
  let acceptedReceipt: MiniMaxMusic3Receipt | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://music-worker.example/v1/generate") {
      postCount += 1;
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Idempotency-Key"), request.requestKey);
      assert.equal(request.model, MINIMAX_MUSIC3_MODEL);
      assert.equal(request.modelRevision, MINIMAX_MUSIC3_MODEL_REVISION);
      assert.equal(request.runtimeRepository, MINIMAX_MUSIC3_COMFYUI_REPOSITORY);
      assert.equal(request.runtimeRevision, MINIMAX_MUSIC3_COMFYUI_REVISION);
      assert.match(String(request.caption), /^### Global Metadata/mu);
      const runtime = {
        provider: "novita",
        gpuModel: "RTX 4090",
        gpuCount: 2,
        gpuIds: ["gpu-a", "gpu-b"],
        capacityMode: "spot",
        persistentStorage: true,
        checkpointing: true,
        idleShutdownSeconds: 120,
        gpuSeconds: 100,
        gpuRateUsdPerSecondPerGpu: 0.0001,
        startupUsd: 0.01,
        storageUsd: 0,
        costUsd: 0.03,
      } as const;
      const receipt = {
        schema: MINIMAX_MUSIC3_WORKER_CONTRACT,
        requestKey: request.requestKey,
        jobId: "music-job-001",
        programFingerprint: program.fingerprint,
        model: MINIMAX_MUSIC3_MODEL,
        modelRevision: MINIMAX_MUSIC3_MODEL_REVISION,
        runtimeRepository: MINIMAX_MUSIC3_COMFYUI_REPOSITORY,
        runtimeRevision: MINIMAX_MUSIC3_COMFYUI_REVISION,
        captionSha256: request.captionSha256,
        lyricsControlSha256: request.lyricsControlSha256,
        seed: request.seed,
        durationSec: request.durationSec,
        cfgScale: request.cfgScale,
        topK: request.topK,
        output: {
          url: "https://music-output.example/job-001.wav",
          contentSha256: sha256(audio),
          byteLength: audio.byteLength,
          sampleRateHz: MINIMAX_MUSIC3_SAMPLE_RATE_HZ,
          channels: MINIMAX_MUSIC3_CHANNELS,
          bitsPerSample: MINIMAX_MUSIC3_BITS_PER_SAMPLE,
          codec: "pcm_s16le",
          container: "wav",
        },
        quality: {
          qualificationReceiptSha256: process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256,
          humanAuditioned: true,
        },
        license: {
          uiAttribution: MINIMAX_MUSIC3_UI_ATTRIBUTION,
          prominentCommercialAttributionDisplayed: true,
          generatedContentDisclosureEnabled: true,
          safeguardsEnabled: true,
          operatorAttested: true,
        },
        runtime,
      };
      return Response.json({ receipt });
    }
    assert.equal(url, "https://music-output.example/job-001.wav");
    return new Response(Uint8Array.from(audio).buffer, {
      headers: { "Content-Length": String(audio.byteLength), "Content-Type": "audio/wav" },
    });
  };

  const result = await generateMiniMaxMusic3({
    program,
    maxCostUsd: 1,
    onReceipt: (receipt) => { acceptedReceipt = receipt; },
  });
  assert.deepEqual(result.audio, audio);
  assert.equal(result.receipt.runtime.costUsd, 0.03);
  assert.equal(acceptedReceipt?.jobId, "music-job-001");
  assert.equal(postCount, 1);
  assert.equal(
    assertPinnedMiniMaxMusic3Receipt(result.receipt, program).programFingerprint,
    program.fingerprint,
    "the durable release boundary must revalidate the exact channel program",
  );
  assert.throws(
    () => assertPinnedMiniMaxMusic3Receipt({
      ...result.receipt,
      license: { ...result.receipt.license, generatedContentDisclosureEnabled: false },
    }, program),
    /generatedContentDisclosureEnabled is not attested/,
    "a runtime receipt cannot release a package whose disclosure control is off",
  );

  process.env.MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED = "0";
  assert.equal(hasQualifiedMiniMaxMusic3(), false, "license attribution must fail readiness closed");
  process.env.MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED = "1";

  postCount = 0;
  globalThis.fetch = async () => {
    postCount += 1;
    throw new TypeError("socket reset after upload");
  };
  await assert.rejects(
    () => generateMiniMaxMusic3({ program }),
    (error: unknown) => error instanceof MiniMaxMusic3Error && error.retryable === false && /reconciled, not retried/u.test(error.message),
  );
  assert.equal(postCount, 1, "an ambiguous MiniMax-Music3 POST must never be resubmitted");

  console.log("MINIMAX MUSIC3 ATTESTED WORKER CONTRACT PASS");
}

main().finally(() => {
  globalThis.fetch = savedFetch;
  process.env = savedEnv;
});
