import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  assertQwenNarrationSourceBinding,
  assertQwenNarrationSourceEvidence,
  createQwenNarrationSourceEvidence,
  prepareQwenTtsRequest,
  synthQwenNarration,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";
import { assertNarrationPerformanceEvidence } from "@/lib/narrationPerformance";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const audio = Buffer.alloc(2_048, 23);
audio.set([0x49, 0x44, 0x33]);
process.env.QWEN3_TTS_WORKER_URL = "https://guarded.invalid/synthesize";
process.env.QWEN3_TTS_WORKER_TOKEN = "local-synthetic-token-no-real-credential-0000";
process.env.QWEN3_TTS_WORKER_IMAGE_DIGEST = "registry.example/ysa/qwen3-tts@sha256:" + "b".repeat(64);

function fixture(request: Record<string, unknown>): unknown {
  return JSON.parse(execFileSync(
    "python3",
    [join(process.cwd(), "workers/qwen3-tts/contract.py"), "--fixture"],
    {
      input: JSON.stringify({
        payload: request,
        idempotencyKey: request.requestKey,
        audioBase64: audio.toString("base64"),
        durationSec: 3.5,
        requestGpuSeconds: 8,
        gpuRateUsdPerSecond: 0.00005,
      }),
      encoding: "utf8",
    },
  ));
}

async function synth(text: string): Promise<{ bytes: Uint8Array; receipt: QwenTtsReceipt }> {
  let accepted: QwenTtsReceipt | undefined;
  const bytes = await synthQwenNarration({
    text,
    speaker: "Aiden",
    language: "English",
    instruction: "Measured documentary delivery.",
    speed: 0.95,
    onReceipt: (receipt) => { accepted = receipt; },
  });
  assert.ok(accepted, "the raw worker response must be independently attested before it enters the batch evidence");
  return { bytes, receipt: accepted };
}

async function main(): Promise<void> {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const prepared = prepareQwenTtsRequest({
      text: String(request.text), speaker: "Aiden", language: "English",
      instruction: "Measured documentary delivery.", speed: 0.95,
    });
    assert.equal(request.requestKey, prepared.requestKey);
    return Response.json(fixture(request));
  };
  const first = await synth("The signal changed before sunrise.");
  const second = await synth("The archive proved why it mattered.");
  const cold = await synth("The signal changed before sunrise. The archive proved why it mattered.");
  const sourceAudio = Buffer.concat([Buffer.from(first.bytes), Buffer.from(second.bytes)]);
  const transcript = "The signal changed before sunrise. The archive proved why it mattered.";
  const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const evidence = createQwenNarrationSourceEvidence({
    speaker: "Aiden",
    language: "English",
    source: {
      narrationKey: "owners/owner-a/runs/run-a/narration.mp3",
      sha256: sha(sourceAudio),
      byteLength: sourceAudio.byteLength,
      durationSec: 9.2,
      transcriptSha256: sha(transcript),
      assembly: "concat_audio_with_gaps/v1",
      gapPlanSha256: sha("[0.8,0]"),
      mode: "sentence",
      voiceFx: null,
    },
    sourceChunks: [first, second].map(({ bytes, receipt }, ordinal) => ({
      ordinal,
      textSha256: receipt.textSha256,
      audioSha256: sha(bytes),
      byteLength: bytes.byteLength,
      receipt,
    })),
    preflightReceipts: [cold.receipt],
  });
  globalThis.fetch = async () => { throw new Error("retained narration validation must never rebuy Qwen TTS"); };
  assert.equal(assertQwenNarrationSourceEvidence(evidence).sourceRequestCount, 2);
  assert.equal(
    assertQwenNarrationSourceBinding({
      evidence,
      narrationKey: evidence.source.narrationKey,
      sourceAudio,
      transcript,
      durationSec: 9.2,
    }).preflightRequestCount,
    1,
  );
  const performance = {
    version: "narration-performance-evidence/v1" as const,
    source: "local_ffmpeg" as const,
    durationSec: 9.2,
    wordCount: 12,
    wordsPerSec: 12 / 9.2,
    integratedLufs: -18,
    windowMeanDb: -20,
    qwenProviderEvidence: evidence,
  };
  assert.equal(assertNarrationPerformanceEvidence(performance).qwenProviderEvidence?.receiptSha256, evidence.receiptSha256);
  assert.doesNotThrow(() => validateArtifact(artifactContract("narrationPerformanceEvidence"), performance));

  const alteredSource = Buffer.from(sourceAudio); alteredSource[100] ^= 1;
  assert.throws(
    () => assertQwenNarrationSourceBinding({ evidence, narrationKey: evidence.source.narrationKey, sourceAudio: alteredSource, transcript, durationSec: 9.2 }),
    /does not bind the retained final narration object/,
  );
  assert.throws(
    () => assertQwenNarrationSourceEvidence({ ...evidence, receiptSha256: "0".repeat(64) }),
    /receipt digest/,
  );
  const textSwapped = structuredClone(evidence);
  textSwapped.sourceChunks[1]!.textSha256 = textSwapped.sourceChunks[0]!.textSha256;
  assert.throws(() => assertQwenNarrationSourceEvidence(textSwapped), /does not bind its receipt/);
  const oversized = structuredClone(evidence);
  oversized.sourceChunks[0]!.byteLength = 12;
  assert.throws(() => assertQwenNarrationSourceEvidence(oversized), /byte length/);
  assert.throws(
    () => validateArtifact(artifactContract("narrationPerformanceEvidence"), { ...performance, qwenProviderEvidence: { schema: "forged" } }),
    /Qwen3 narration source evidence/,
  );
  console.log("PASS Qwen narration source receipt binds attested takes, durable final bytes, transcript, cost, typed artifacts, and rejects four forged variants");
}

main().finally(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});
