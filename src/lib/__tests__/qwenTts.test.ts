import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { composeQwenNarrationInstruction, qwenTtsInstruction, qwenTtsReadiness, hasQualifiedQwenTts,
  synthQwenNarration, isPinnedQwenTtsReceipt, validateRetainedQwenTtsAudio, type QwenTtsReceipt } from "../qwenTts";
import { createQwenNarrationSourceEvidence, assertQwenNarrationSourceEvidence } from "../qwenTts";
import { synthNarration, normalizeTtsProvider } from "../tts";
import { narrationTtsCost } from "@/engine/pricing";
import { qwenEngineFixture } from "./fixtures/qwenEngineFixture";

const originalFetch = globalThis.fetch, env = { ...process.env };
async function main() {
  delete process.env.RENDER_MANAGEMENT_API_KEY;
  process.env.QWEN3_TTS_WORKER_URL = "https://retired-worker.invalid/synthesize";
  process.env.QWEN3_TTS_WORKER_TOKEN = "retired-worker-token";
  assert.equal(qwenTtsReadiness().configured, false);
  let contacts = 0;
  globalThis.fetch = async () => { contacts++; throw new Error("must not contact a provider"); };
  await assert.rejects(synthQwenNarration({ text: "Require Engine configuration", speaker: "Ryan" }), /management credential/);
  assert.equal(contacts, 0);
  process.env.RENDER_MANAGEMENT_API_KEY = "f".repeat(64);
  assert.equal(hasQualifiedQwenTts(), true);
  assert.equal(normalizeTtsProvider("QWEN3"), "qwen3");
  assert.throws(() => normalizeTtsProvider("qewn3"), /Unsupported/);
  assert.equal(narrationTtsCost("qwen3", 99999, 0, 0.42), 0.42);
  assert.match(qwenTtsInstruction("Calm documentary delivery.", 0.9), /unhurried/);
  assert.equal(composeQwenNarrationInstruction({ explicit: "Use a close, intimate delivery.",
    editorialBrief: "Keep the channel's explicit direction.", delivery: "warm and patient", pacing: "measured", archetype: "documentary" }),
  "Use a close, intimate delivery. Keep the channel's explicit direction. warm and patient. measured. documentary.");
  assert.equal(composeQwenNarrationInstruction({ explicit: "Warm and patient", delivery: "warm and patient", pacing: "Warm And Patient" }), "Warm and patient.");
  const fixture = qwenEngineFixture();
  globalThis.fetch = fixture.fetchImpl;
  let receipt: QwenTtsReceipt | undefined;
  let authorities = 0, characters = 0;
  const text = "A measured narration line.";
  const bytes = await synthNarration({ provider: "qwen3", text, qwenSpeaker: "Ryan", qwenLanguage: "English",
    qwenInstruction: "Measured documentary delivery.", qwenSeed: 4242, qwenMaxCostUsd: 0.1,
    qwenRequestScope: "owner:channel:run:narration", qwenAuthorize: async () => { authorities++; },
    onQwenReceipt: value => { receipt = value; }, onBillableCharacters: count => { characters += count; } });
  assert.equal(fixture.counts().submissions, 1);
  assert.ok(authorities >= 3);
  assert.equal(characters, text.length);
  assert.equal(receipt?.schema, "studio-engine-qwen-receipt/v1");
  assert.equal(receipt?.runtime.costUsd, 0.04);
  assert.equal(receipt?.audioSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(receipt?.durationSec, 2);
  assert.equal(isPinnedQwenTtsReceipt(receipt), true);
  assert.ok(receipt);
  const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const sourceEvidence = createQwenNarrationSourceEvidence({ speaker: "Ryan", language: "English",
    source: { narrationKey: "owner/test/runs/test/narration.mp3", sha256: sha(bytes), byteLength: bytes.length, durationSec: 2,
      transcriptSha256: sha(text), assembly: "concat_audio_with_gaps/v1", gapPlanSha256: sha("[0]"), mode: "sentence", voiceFx: null },
    sourceChunks: [{ ordinal: 0, textSha256: receipt.textSha256, audioSha256: sha(bytes), byteLength: bytes.length, receipt }],
    preflightReceipts: [receipt] });
  assert.equal(assertQwenNarrationSourceEvidence(sourceEvidence).totalCostUsd, 0.04,
    "one Engine job reused for preflight and source is accounted once");
  validateRetainedQwenTtsAudio({ text, speaker: "Ryan", language: "English", instruction: "Measured documentary delivery.",
    seed: 4242, requestScope: "owner:channel:run:narration" }, bytes, receipt);
  assert.throws(() => validateRetainedQwenTtsAudio({ text: "Another script", speaker: "Ryan" }, bytes, receipt), /does not match/);
  await assert.rejects(synthQwenNarration({ text, speaker: "Aiden" }), /refusing to replace/);
  assert.equal(fixture.counts().submissions, 1);
  const unknown = qwenEngineFixture(); unknown.failSubmission(); globalThis.fetch = unknown.fetchImpl;
  await assert.rejects(synthQwenNarration({ text, speaker: "Ryan" }), /original immutable key/);
  assert.equal(unknown.counts().submissions, 1);
  const unsettled = qwenEngineFixture(); unsettled.setUsage(false, 0.01); globalThis.fetch = unsettled.fetchImpl;
  await assert.rejects(synthQwenNarration({ text, speaker: "Ryan" }), /usage requires reconciliation/);
  assert.equal(unsettled.counts().submissions, 1);
  console.log("Qwen narration: Engine-only dispatch, actual encoding, preserved direction/identity, usage and recovery checks passed");
}
main().finally(() => { globalThis.fetch = originalFetch; process.env = env; }).catch(error => { console.error(error); process.exitCode = 1; });
