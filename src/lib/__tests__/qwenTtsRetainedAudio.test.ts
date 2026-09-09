import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { prepareQwenTtsRequest, synthQwenNarration, validateRetainedQwenTtsAudio, type QwenTtsReceipt, type QwenTtsRequestArgs } from "@/lib/qwenTts";

const cases: QwenTtsRequestArgs[] = [
  { text: "A retained qualification take.", speaker: "Aiden" },
  { text: "  A retained   qualification take.  ", speaker: "Aiden" },
  { text: "Über den Bergrücken — mañana.", speaker: "Ryan", language: "German", instruction: " Speak   calmly. ", speed: 0.95 },
  { text: "A retained qualification take.", speaker: "Aiden", seed: 0, maxCostUsd: 0.25 },
  { text: "A retained qualification take.", speaker: "Aiden", seed: -1, speed: 2, maxCostUsd: 2 },
  { text: "A retained qualification take.", speaker: "Aiden", instruction: "a".repeat(650) },
];
// Captured from the exact pre-extraction synthQwenNarration implementation.
// These hash the RAW JSON transport bytes, not sorted/reconstructed JSON.
const beforeBodySha256 = [
  "d83c8ac65bf14d1d86b3ce38fa8201422050890d9ef83da6cd397168a64d5c6a",
  "d83c8ac65bf14d1d86b3ce38fa8201422050890d9ef83da6cd397168a64d5c6a",
  "9b58604f61066ec92cb9b8520054792984f8be838166f589ce0bcd904dbde02e",
  "462d8f461e2400111ac7b5bc1e74c25e51742ecbb50cbc7b84abea7b1ba3f6d0",
  "2ab74254a0c224aee9bd5fe3b6d3747624dd1ccade8b2c6ce82ee24644e81492",
  "6a8b7302aa1ed60604f462da729eaae53f4cc70881ddd79b96d19673fa75d5a5",
];
const audio = Buffer.alloc(2048, 23); audio.set([0x49, 0x44, 0x33]);
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
let posts = 0, receipt: QwenTtsReceipt | undefined;
const transportHashes: string[] = [];
process.env.QWEN3_TTS_WORKER_URL = "https://guarded.invalid/synthesize";
process.env.QWEN3_TTS_WORKER_TOKEN = "local-synthetic-token-no-real-credential-0000";
globalThis.fetch = async (_url, init) => {
  const index = posts++; const body = String(init?.body), request = JSON.parse(body);
  const actual = createHash("sha256").update(body).digest("hex"); transportHashes.push(actual);
  assert.equal(actual, beforeBodySha256[index], "valid transport bytes changed during pure extraction");
  assert.equal(new Headers(init?.headers).get("Idempotency-Key"), request.requestKey);
  const prepared = prepareQwenTtsRequest(cases[index]!);
  assert.equal(body, JSON.stringify({ ...prepared.payload, requestKey: prepared.requestKey }));
  const response = execFileSync("python3", [join(process.cwd(), "workers/qwen3-tts/contract.py"), "--fixture"], {
    input: JSON.stringify({ payload: request, idempotencyKey: request.requestKey, audioBase64: audio.toString("base64"), durationSec: 20, requestGpuSeconds: 10, gpuRateUsdPerSecond: 0.00005 }), encoding: "utf8",
  });
  return Response.json(JSON.parse(response));
};

async function main() {
  for (const item of cases) {
    const returned = await synthQwenNarration({ ...item, onReceipt: (value) => { receipt = value; } });
    assert.deepEqual(returned, new Uint8Array(audio));
    assert.equal(validateRetainedQwenTtsAudio(item, audio, receipt), receipt, "reuse original cost receipt object without rebilling");
  }
  assert.equal(posts, 6); assert.ok(receipt);
  const originalRuntime = receipt.runtime;
  const boundArgs = cases[5]!;
  delete process.env.QWEN3_TTS_WORKER_URL; delete process.env.QWEN3_TTS_WORKER_TOKEN;
  globalThis.fetch = async () => { throw new Error("offline helper must never fetch"); };
  assert.equal(validateRetainedQwenTtsAudio(boundArgs, audio, receipt), receipt);
  for (const changed of [
    { text: "A different request." }, { instruction: "different" }, { speaker: "Ryan" },
    { language: "German" }, { seed: 4243 }, { maxCostUsd: 0.2 },
  ]) assert.throws(() => validateRetainedQwenTtsAudio({ ...boundArgs, ...changed }, audio, receipt), /receipt/);
  for (const field of ["requestKey", "model", "revision", "qwenTtsPackageVersion", "transformersVersion", "dtype", "attention", "textSha256", "instructionSha256", "speaker", "language", "seed", "audioSha256", "audioFormat", "sampleRateHz", "durationSec"]) {
    assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, audio, { ...receipt, [field]: "corrupt" }), /receipt/);
  }
  assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, audio, { ...receipt, runtime: { ...originalRuntime, costUsd: 0 } }), /receipt/);
  assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, audio, { ...receipt, runtime: { ...originalRuntime, gpuSeconds: 1 } }), /upper bound/);
  assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, audio.subarray(0, 10), receipt), /bounded size/);
  assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, Buffer.alloc(2048, 0), receipt), /MP3/);
  const corrupt = Buffer.from(audio); corrupt[100] = 3;
  assert.throws(() => validateRetainedQwenTtsAudio(boundArgs, corrupt, receipt), /audio digest/);
  for (const [index, hash] of transportHashes.entries()) console.log(`transport ${index + 1}: ${hash}`);
  console.log("PASS six exact pre-extraction transport hashes; offline current-request/audio/pin/cost guards; no external provider calls");
}
main().finally(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });
