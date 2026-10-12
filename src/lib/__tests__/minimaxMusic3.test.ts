import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { canonicalJson } from "../canonicalJson";
import { assertPinnedMiniMaxMusic3Receipt, generateMiniMaxMusic3, hasQualifiedMiniMaxMusic3,
  minimaxMusic3Readiness, validateRetainedMiniMaxMusic3Audio, MiniMaxMusic3Error,
  MINIMAX_MUSIC3_WORKER_CONTRACT, MINIMAX_MUSIC3_MODEL, MINIMAX_MUSIC3_MODEL_REVISION,
  MINIMAX_MUSIC3_COMFYUI_REPOSITORY, MINIMAX_MUSIC3_COMFYUI_REVISION, MINIMAX_MUSIC3_RENDER_PROFILE,
  type LegacyMiniMaxMusic3Receipt } from "../minimaxMusic3";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../studioRenderEngineWorkflows";

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const program = createChannelMusicProgram({ channelId: "channel-rain", channelIdentityFingerprint: "b".repeat(64),
  family: "music_loop", contentLaneKey: "music_loop", topic: "Last tram through warm rain", providerPreference: "minimax_music3",
  durationSec: 10, genre: "rainy late-night lo-fi hip-hop", instrumentation: ["Rhodes piano", "upright bass", "soft boom-bap drums"],
  textures: ["vinyl grain", "tape warmth"], bpmRange: [70, 78] });
const audio = Buffer.alloc(44 + 10 * 32000 * 4);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVE", 8);
audio.write("fmt ", 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(2, 22);
audio.writeUInt32LE(32000, 24); audio.writeUInt32LE(128000, 28); audio.writeUInt16LE(4, 32); audio.writeUInt16LE(16, 34);
audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(Math.round(Math.sin(offset / 17) * 8000), offset);

async function main() {
  delete process.env.RENDER_MANAGEMENT_API_KEY;
  process.env.MINIMAX_MUSIC3_WORKER_URL = "https://retired.example/generate";
  process.env.MINIMAX_MUSIC3_WORKER_TOKEN = "retired-key-is-not-an-engine-credential";
  process.env.MINIMAX_MUSIC3_QUALITY_QUALIFIED = "1";
  process.env.MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256 = "a".repeat(64);
  for (const suffix of ["LICENSE_ATTESTED", "UI_ATTRIBUTION_ENABLED", "DISCLOSURE_ENABLED", "SAFEGUARDS_ATTESTED"]) process.env[`MINIMAX_MUSIC3_${suffix}`] = "1";
  assert.equal(minimaxMusic3Readiness().configured, false);
  process.env.RENDER_MANAGEMENT_API_KEY = "e".repeat(64);
  assert.equal(hasQualifiedMiniMaxMusic3(), false, "Comfy qualification must not qualify the new native BF16 profile");
  process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_QUALIFIED = "1";
  process.env.MINIMAX_MUSIC3_ENGINE_QUALITY_RECEIPT_SHA256 = "f".repeat(64);
  assert.equal(hasQualifiedMiniMaxMusic3(), true);
  const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["minimax-music3"], jobId = "d".repeat(32);
  const output = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/jobs/${jobId}/output.wav`,
    bytes: audio.length, sha256: hash(audio), contentType: "audio/wav", verifiedAt: 123 };
  let posts = 0, authority = 0, manifestSha256 = "", complete = true, costUsd = 0.03;
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/music3-jobs")) {
      posts++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.workflowId, workflow.workflowId);
      assert.equal(body.request.lyrics, program.generation.lyricsControl);
      assert.equal(body.request.description, program.generation.structuredCaption);
      assert.match(body.request.description, /^### Global Metadata/m);
      assert.doesNotMatch(body.request.lyrics, /Establish|Keep the|vocals|spoken/);
      assert.equal(body.request.profileRevisionSha256, workflow.profileRevisionSha256);
      assert.equal(body.request.maxAudioSeconds, 10);
      assert.ok(!("maxCostUsd" in body.request), "legacy audit field must not masquerade as an enforced budget cap");
      manifestSha256 = hash(canonicalJson(body.request));
      return Response.json({ jobId, state: "queued", manifestSha256 });
    }
    if (String(url).includes("/jobs/output?")) return Response.json({ ...output,
      url: "https://account.r2.cloudflarestorage.com/native.wav?signature=fixture" });
    if (String(url).includes("/jobs?")) return Response.json({ jobId, workflowId: workflow.workflowId, profileId: "minimax-music3",
      requestSha256: manifestSha256, status: "completed", outputRetired: false, output, usage: { gpuSeconds: 100, costUsd, complete } });
    assert.equal(String(url), "https://account.r2.cloudflarestorage.com/native.wav?signature=fixture");
    return new Response(audio);
  };
  const result = await generateMiniMaxMusic3({ program, maxCostUsd: 1, requestScope: "owner:channel:run:music",
    authorize: async () => { authority++; } });
  assert.deepEqual(Buffer.from(result.audio), audio);
  assert.equal(result.receipt.runtime.costUsd, 0.03);
  assert.equal(posts, 1); assert.ok(authority >= 3);
  assert.equal(result.receipt.schema, "studio-engine-music3-receipt/v1");
  assert.equal(assertPinnedMiniMaxMusic3Receipt(result.receipt, program).programFingerprint, program.fingerprint);
  validateRetainedMiniMaxMusic3Audio(result.audio, result.receipt);
  assert.ok(!("url" in result.receipt.output), "signed read capabilities must not enter durable receipts");
  assert.throws(() => assertPinnedMiniMaxMusic3Receipt({ ...result.receipt, programFingerprint: "0".repeat(64) }, program));
  const changed = Buffer.from(audio); changed[100] ^= 1;
  assert.throws(() => validateRetainedMiniMaxMusic3Audio(changed, result.receipt), /integrity receipt/);
  await assert.rejects(generateMiniMaxMusic3({ program, cfgScale: 1.7 }), /legacy Comfy/);
  await assert.rejects(generateMiniMaxMusic3({ program, topK: 50 }), /legacy Comfy/);
  assert.equal(posts, 1, "unsupported controls fail before network");
  complete = false;
  await assert.rejects(generateMiniMaxMusic3({ program }), error => error instanceof MiniMaxMusic3Error &&
    (error as unknown as { engineJobId: string }).engineJobId === jobId);
  complete = true; costUsd = 2;
  await assert.rejects(generateMiniMaxMusic3({ program, maxCostUsd: 1 }), error => error instanceof MiniMaxMusic3Error && error.observedCostUsd === 2);
  process.env.MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED = "0";
  assert.equal(hasQualifiedMiniMaxMusic3(), false);
  process.env.MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED = "1";

  // Archived Comfy receipts stay readable without reviving their provider lane.
  const legacy: LegacyMiniMaxMusic3Receipt = { schema: MINIMAX_MUSIC3_WORKER_CONTRACT, requestKey: "c".repeat(64), jobId: "music-job-001",
    programFingerprint: program.fingerprint, model: MINIMAX_MUSIC3_MODEL, modelRevision: MINIMAX_MUSIC3_MODEL_REVISION,
    runtimeRepository: MINIMAX_MUSIC3_COMFYUI_REPOSITORY, runtimeRevision: MINIMAX_MUSIC3_COMFYUI_REVISION,
    captionSha256: hash(program.generation.structuredCaption), lyricsControlSha256: hash(program.generation.lyricsControl),
    seed: 4242, durationSec: 10, cfgScale: 1.7, topK: 50, renderProfile: MINIMAX_MUSIC3_RENDER_PROFILE,
    output: { url: "https://archived.example/music.wav", contentSha256: hash(audio), byteLength: audio.length,
      sampleRateHz: 32000, channels: 2, bitsPerSample: 16, codec: "pcm_s16le", container: "wav" },
    quality: { qualificationReceiptSha256: "a".repeat(64), humanAuditioned: true },
    license: { uiAttribution: "MiniMax-Music3", prominentCommercialAttributionDisplayed: true,
      generatedContentDisclosureEnabled: true, safeguardsEnabled: true, operatorAttested: true },
    runtime: { provider: "novita", gpuModel: "RTX 4090", gpuCount: 2, gpuIds: ["gpu-a", "gpu-b"], capacityMode: "spot",
      persistentStorage: true, checkpointing: true, idleShutdownSeconds: 120, gpuSeconds: 100,
      gpuRateUsdPerSecondPerGpu: 0.0001, startupUsd: 0.01, storageUsd: 0, costUsd: 0.03 } };
  assertPinnedMiniMaxMusic3Receipt(legacy, program);
  validateRetainedMiniMaxMusic3Audio(audio, legacy);
  assert.throws(() => assertPinnedMiniMaxMusic3Receipt({ ...legacy,
    license: { ...legacy.license, generatedContentDisclosureEnabled: false } }, program), /not attested/);
  assert.throws(() => assertPinnedMiniMaxMusic3Receipt({ ...legacy,
    renderProfile: { ...legacy.renderProfile, decoder: { ...legacy.renderProfile.decoder, tiled: true } } }, program), /full-VAE/);
  posts = 0;
  globalThis.fetch = async () => { posts++; throw new TypeError("socket reset"); };
  await assert.rejects(generateMiniMaxMusic3({ program }), error => error instanceof MiniMaxMusic3Error && error.retryable === false && !!error.requestKey);
  assert.equal(posts, 1, "ambiguous Engine submission is never retried");
  console.log("Music3: Engine-only dispatch, native receipts, authority, usage, source integrity and archived Comfy contracts passed");
}
main().finally(() => { globalThis.fetch = savedFetch; process.env = savedEnv; });
