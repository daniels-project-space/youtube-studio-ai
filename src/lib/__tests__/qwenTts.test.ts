import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  hasQualifiedQwenTts,
  isPinnedQwenTtsReceipt,
  qwenTtsReadiness,
  qwenTtsInstruction,
  QWEN3_TTS_MODEL,
  QWEN3_TTS_MODEL_REVISION,
  QWEN3_TTS_WORKER_CONTRACT,
  QwenTtsError,
  synthQwenNarration,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";
import { narrationTtsCost } from "@/engine/pricing";
import { normalizeTtsProvider } from "@/lib/tts";

const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };

function actualPythonWorkerResponse(request: Record<string, unknown>, audio: Uint8Array): unknown {
  const output = execFileSync(
    "python3",
    [join(process.cwd(), "workers/qwen3-tts/contract.py"), "--fixture"],
    {
      input: JSON.stringify({
        payload: request,
        idempotencyKey: request.requestKey,
        audioBase64: Buffer.from(audio).toString("base64"),
        durationSec: 2.4,
        requestGpuSeconds: 10,
        gpuRateUsdPerSecond: 0.00005,
      }),
      encoding: "utf8",
    },
  );
  return JSON.parse(output) as unknown;
}

async function main(): Promise<void> {
  delete process.env.QWEN3_TTS_WORKER_URL;
  delete process.env.QWEN3_TTS_WORKER_TOKEN;
  assert.equal(qwenTtsReadiness().configured, false);
  process.env.QWEN3_TTS_WORKER_URL = "https://qwen-worker.example/v1/synthesize";
  process.env.QWEN3_TTS_WORKER_TOKEN = "qwen-test-token-that-is-longer-than-thirty-two-characters";
  process.env.QWEN3_TTS_QUALITY_QUALIFIED = "1";
  process.env.QWEN3_TTS_QUALITY_RECEIPT_SHA256 = "a".repeat(64);
  assert.equal(hasQualifiedQwenTts(), true);
  assert.equal(normalizeTtsProvider("QWEN3"), "qwen3");
  assert.throws(() => normalizeTtsProvider("qewn3"), /Unsupported narration TTS provider/);
  assert.equal(
    narrationTtsCost("qwen3", 99_999, 0, 0.42),
    0.42,
    "Qwen runtime accounting must use the attested GPU receipt, not fictional character billing",
  );
  assert.match(qwenTtsInstruction("Calm documentary delivery.", 0.9), /unhurried/);

  const audio = new Uint8Array(2_048).fill(23);
  audio.set([0x49, 0x44, 0x33], 0);
  let requests = 0;
  let acceptedReceipt: QwenTtsReceipt | undefined;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.equal(new Headers(init?.headers).get("Authorization")?.startsWith("Bearer "), true);
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(request.model, QWEN3_TTS_MODEL);
    assert.equal(request.revision, QWEN3_TTS_MODEL_REVISION);
    assert.equal(request.schema, QWEN3_TTS_WORKER_CONTRACT);
    assert.equal(request.speaker, "Aiden");
    assert.equal(request.language, "English");
    assert.match(String(request.instruction), /measured/);
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), request.requestKey);
    return Response.json(actualPythonWorkerResponse(request, audio));
  };
  const bytes = await synthQwenNarration({
    text: "A measured open narration qualification line.",
    speaker: "Aiden",
    language: "English",
    speed: 0.95,
    onReceipt: (receipt) => { acceptedReceipt = receipt; },
  });
  assert.deepEqual(bytes, audio);
  assert.equal(requests, 1);
  assert.equal(acceptedReceipt?.runtime.accounting, "conservative-upper-bound");
  assert.equal(acceptedReceipt?.runtime.requestGpuSeconds, 10);
  assert.equal(acceptedReceipt?.runtime.gpuSeconds, 310);
  assert.equal(acceptedReceipt?.runtime.costUsd, 0.0155);
  assert.equal(isPinnedQwenTtsReceipt(acceptedReceipt), true);

  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      receipt: {
        schema: QWEN3_TTS_WORKER_CONTRACT,
        requestKey: request.requestKey,
        model: QWEN3_TTS_MODEL,
        revision: "unpinned",
      },
      audioBase64: Buffer.from(audio).toString("base64"),
    });
  };
  await assert.rejects(
    () => synthQwenNarration({ text: "Reject an unpinned worker.", speaker: "Aiden" }),
    /revision is not the pinned value/,
  );

  requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new TypeError("socket reset after upload");
  };
  await assert.rejects(
    () => synthQwenNarration({ text: "Never buy this take twice.", speaker: "Aiden" }),
    (error: unknown) => error instanceof QwenTtsError && error.retryable === false && /reconciled, not retried/.test(error.message),
  );
  assert.equal(requests, 1, "an ambiguous Qwen POST must never be resubmitted");
  await assert.rejects(
    () => synthQwenNarration({ text: "Unsupported voice.", speaker: "George" }),
    /speaker is unsupported/,
  );
  await assert.rejects(
    () => synthQwenNarration({ text: "No unsigned spend.", speaker: "Aiden", maxCostUsd: 0 }),
    /positive per-request cost ceiling/,
  );
  console.log("QWEN3 TTS ATTESTED WORKER CONTRACT PASS");
}

main().finally(() => {
  globalThis.fetch = savedFetch;
  process.env = savedEnv;
});
