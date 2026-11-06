import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertHrsQwenNarrationSourceBinding,
  assertHrsQwenTtsReceipt,
  createHrsQwenNarrationSourceEvidence,
  renderHyperYoutubeQwenTts,
} from "@/lib/hyperYoutubeQwenTts";
import type { configuredHyperYoutubeStageClient } from "@/lib/hyperYoutubeStageClient";
import { canonicalJson } from "@/lib/canonicalJson";
import { assertNarrationPerformanceEvidence, NARRATION_PERFORMANCE_EVIDENCE_VERSION } from "@/lib/narrationPerformance";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const wav = Buffer.from("RIFF HRS verified wav fixture");
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1_100, 7)]);
  const job = {
    id: jobId,
    projectId,
    modelId: "qwen3-tts",
    state: "completed",
    generation: 1,
    idempotencyKey: "",
    outputDestination: { bucket: "youtube", projectPrefix: "projects/youtube/" },
    output: { projectId, jobId, generation: 1, bucket: "youtube",
      key: `projects/youtube/jobs/${jobId}/1/output.wav`, sha256: hash(wav), bytes: wav.length,
      contentType: "audio/wav", available: true, downloadUrl: "https://r2.example/wav" },
  };
  const captured: Array<{ stage: unknown; key: string }> = [];
  const client = {
    binding: async () => ({ projectId, outputBucket: "youtube" }),
    submit: async (stage: unknown, key: string) => {
      captured.push({ stage, key });
      return { ...job, idempotencyKey: key };
    },
    get: async () => { throw new Error("completed submit should not poll"); },
    download: async () => wav,
  } as unknown as ReturnType<typeof configuredHyperYoutubeStageClient>;
  const options = {
    text: "  Hello   there, friend. ", speaker: "Ryan", language: "English", speed: 1,
    instruction: "Warm, measured narration.", requestScope: "owner/channel/run/sentence-0",
    client, wait: async () => { throw new Error("completed job should not wait"); }, transcode: async () => mp3,
  };
  const rendered = await renderHyperYoutubeQwenTts(options);
  const repeated = await renderHyperYoutubeQwenTts(options);
  assert.deepEqual(rendered.audio, mp3);
  assert.equal(captured.length, 2);
  assert.equal(captured[0]!.key, captured[1]!.key, "retry must reuse the same HRS idempotency key");
  assert.equal(captured[0]!.key, rendered.receipt.idempotencyKey);
  assert.deepEqual(captured[0]!.stage, captured[1]!.stage);
  assert.equal(repeated.receipt.encodedAudio.sha256, rendered.receipt.encodedAudio.sha256);
  assert.equal(rendered.receipt.nativeOutput.sha256, hash(wav));
  assert.equal(assertHrsQwenTtsReceipt(rendered.receipt).jobId, jobId);
  assert.throws(() => assertHrsQwenTtsReceipt({ ...rendered.receipt, inputSha256: "0".repeat(64) }), /input digest/i);

  let waitCount = 0;
  let pollCount = 0;
  let submittedPendingKey = "";
  const pendingClient = {
    binding: async () => ({ projectId, outputBucket: "youtube" }),
    submit: async (_stage: unknown, key: string) => {
      submittedPendingKey = key;
      return { ...job, state: "queued", output: null, idempotencyKey: key };
    },
    get: async (id: string, _stage: unknown, key: string) => {
      pollCount += 1;
      assert.equal(id, jobId);
      assert.equal(key, submittedPendingKey);
      return { ...job, idempotencyKey: key };
    },
    download: async () => wav,
  } as unknown as ReturnType<typeof configuredHyperYoutubeStageClient>;
  const polled = await renderHyperYoutubeQwenTts({ ...options, requestScope: "owner/channel/run/resumable",
    client: pendingClient, wait: async () => { waitCount += 1; }, transcode: async () => mp3 });
  assert.equal(waitCount, 1, "queued job should checkpoint once before polling");
  assert.equal(pollCount, 1, "polling should resume the same submitted job");
  assert.equal(polled.receipt.jobId, jobId);

  const failedClient = {
    ...pendingClient,
    submit: async (_stage: unknown, key: string) => ({ ...job, state: "failed", output: null, idempotencyKey: key }),
    get: async () => { throw new Error("failed job must not be retried as a new render"); },
    download: async () => { throw new Error("failed job must not download an output"); },
  } as unknown as ReturnType<typeof configuredHyperYoutubeStageClient>;
  await assert.rejects(renderHyperYoutubeQwenTts({ ...options, requestScope: "owner/channel/run/failed",
    client: failedClient, wait: async () => { throw new Error("failed job must not wait"); }, transcode: async () => mp3 }), /ended failed/);

  const transcript = "Hello there, friend.";
  const evidence = createHrsQwenNarrationSourceEvidence({
    speaker: "Ryan", language: "English",
    source: { narrationKey: "projects/youtube/runs/run-1/narration.mp3", sha256: hash(mp3), byteLength: mp3.length,
      durationSec: 2, transcriptSha256: hash(transcript), assembly: "concat_audio_with_gaps/v1",
      gapPlanSha256: hash(canonicalJson([0])), mode: "sentence", voiceFx: null },
    sourceChunks: [{ ordinal: 0, textSha256: rendered.receipt.textSha256, audioSha256: rendered.receipt.encodedAudio.sha256,
      byteLength: rendered.receipt.encodedAudio.bytes, receipt: rendered.receipt }],
    preflightReceipts: [],
  });
  assert.equal(assertHrsQwenNarrationSourceBinding({ evidence, narrationKey: evidence.source.narrationKey,
    sourceAudio: mp3, transcript, durationSec: 2 }).receiptSha256, evidence.receiptSha256);
  const performance = assertNarrationPerformanceEvidence({
    version: NARRATION_PERFORMANCE_EVIDENCE_VERSION, source: "local_ffmpeg", durationSec: 2,
    wordCount: 3, wordsPerSec: 1.5, integratedLufs: -20, windowMeanDb: -18, hrsQwenProviderEvidence: evidence,
  });
  assert.equal(performance.hrsQwenProviderEvidence?.billing, "prepaid-worker");
  assert.throws(() => assertHrsQwenNarrationSourceBinding({ evidence, narrationKey: evidence.source.narrationKey,
    sourceAudio: Buffer.from("different audio"), transcript, durationSec: 2 }), /does not bind/);
  assert.throws(() => createHrsQwenNarrationSourceEvidence({ ...{
    speaker: "Ryan" as const, language: "English" as const, source: evidence.source,
    sourceChunks: [{ ...evidence.sourceChunks[0]!, audioSha256: "0".repeat(64) }], preflightReceipts: [],
  } }), /does not match/);
  console.log("YouTube HRS Qwen narration fixtures: ok");
}

void main();
