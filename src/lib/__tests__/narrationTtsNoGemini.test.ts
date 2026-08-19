import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("export const narrationTts: Block =");
const end = source.indexOf("export const stockFootage: Block =", start);
assert.ok(start >= 0 && end > start, "narration_tts source boundary must remain discoverable");
const narrationTtsSource = source.slice(start, end);

// The narration route can use its TTS provider, but never a Google/Gemini
// judging or video endpoint. Performance proof is local FFprobe/FFmpeg only.
assert.doesNotMatch(
  narrationTtsSource,
  /hasGeminiKey|geminiJson|uploadGeminiVideo|gateColdOpen|judgeNarrationTake|audioJudgeCalls/,
  "narration_tts must not construct or account for a Gemini audio-judge route",
);
assert.match(
  narrationTtsSource,
  /preflightNarrationPerformance\(\{\s*audioPath: coldOpenPath,/,
  "production cold-open proof must be physical local audio evidence",
);

const chapterMode = narrationTtsSource.slice(
  narrationTtsSource.indexOf("if (chapterMode"),
  narrationTtsSource.indexOf("// Synth PER SENTENCE"),
);
const sentenceMode = narrationTtsSource.slice(narrationTtsSource.indexOf("// Synth PER SENTENCE"));
for (const [label, route] of [["chapter", chapterMode], ["sentence", sentenceMode]] as const) {
  const preflightAt = route.indexOf("preflightNarrationPerformance");
  const uploadAt = route.indexOf("await putObject(narrationKey");
  assert.ok(preflightAt >= 0 && uploadAt > preflightAt, `${label} narration must preflight final audio before upload`);
  assert.match(route, /narrationPerformanceEvidence/, `${label} narration must persist local performance evidence for final QA`);
}

console.log("narration_tts no-Gemini final-audio wiring tests passed");
