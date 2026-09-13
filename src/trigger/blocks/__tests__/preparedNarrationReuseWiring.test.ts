import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../narratedBlocks.ts", import.meta.url), "utf8");
const start = source.indexOf("export const narrationTts: Block =");
const end = source.indexOf("export const stockFootage: Block =", start);
const narration = source.slice(start, end);

const prepared = narration.indexOf('const preparedNarration = ctx.store["preparedNarration"]');
const providerCredentials = narration.indexOf('if (ttsProvider === "elevenlabs")');

assert.ok(prepared >= 0, "narration_tts must recognize the runner-admitted prepared narration receipt");
assert.ok(
  providerCredentials > prepared,
  "a verified prepared narration must not require an unrelated live TTS credential or start a replacement request",
);
for (const required of [
  "canonicalJson(ctx.store[\"script\"])",
  "preparedNarration.narrationTranscriptSha256",
  "getObjectBytes(preparedNarration.narrationKey)",
  "preparedNarration.audioSha256",
  "assertNarrationPerformanceEvidence(",
  "assertFinalDeliveryRate(narrationPerformanceEvidence)",
  "assertQwenNarrationSourceBinding({",
  "no text-to-speech spend",
] as const) {
  assert.ok(narration.includes(required), `prepared narration must retain ${required}`);
}

console.log("prepared weekly narration TTS reuse wiring passed");
