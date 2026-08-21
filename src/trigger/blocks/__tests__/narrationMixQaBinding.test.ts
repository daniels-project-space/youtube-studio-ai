import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "trigger", "blocks", "narratedBlocks.ts"),
  "utf8",
);

assert.match(
  source,
  /measureNarrationMixCorrelation\(/,
  "final QA must compare the authored narration source against the released master",
);
assert.match(
  source,
  /narration local path is unavailable and no narrationKey can rehydrate it/,
  "narration-mix QA must survive a worker retry by rehydrating the durable narration artifact",
);
assert.match(
  source,
  /narration missing or masked in final mix: source correlation/,
  "a low source-to-master correlation must block production release",
);
assert.match(
  source,
  /narrationMixEvaluator=ffmpeg\/axcorrelate-presence-only/,
  "quality evidence must retain the scope of the audibility proof without claiming intelligibility",
);
assert.match(
  source,
  /audioPath: video,[\s\S]{0,240}sourceSha256: finalMasterTranscriptSha256/,
  "final QA must independently transcribe the released master, not only the pristine narration source",
);
assert.match(
  source,
  /sealFinalMasterNarrationSemanticEvidence\(/,
  "the final-master transcript must be sealed to the reviewed master and approved narration contract",
);
assert.match(
  source,
  /final-master narration semantic evidence unavailable:/,
  "a missing or unintelligible final-master narration transcript must block production release",
);
assert.match(
  source,
  /finalMasterNarrationEvaluator=faster-whisper-small\.en\/offline-speech-semantic/,
  "quality evidence must describe the final-master transcript as local speech-semantic evidence, not FX semantics",
);
assert.match(
  source,
  /finalMasterNarration: finalMasterNarrationSemantic/,
  "the durable release certificate must retain the final-master narration semantic receipt",
);
assert.match(
  source,
  /assertCinematicFinalMasterAudioAesthetics\(\s*ctx\.params\["audioQa"\],\s*audioAestheticScore,\s*\)/,
  "a source-bound cinematic master must not substitute loudness-only evidence when final-mix aesthetics scoring is unavailable",
);
assert.match(
  source,
  /const narrationTranscriptText = items\.map\(speakOf\)\.join\(" "\)/,
  "chapter-mode narration proof must bind to the actual spoken headings and body, not display text",
);
assert.match(
  source,
  /proveNarrationTranscript\(/,
  "production QA must independently transcribe the authored narration source",
);
assert.match(
  source,
  /narration transcript fidelity failure:/,
  "a transcript mismatch must block production release",
);
assert.match(
  source,
  /narrationTranscriptEvaluator=faster-whisper-small\.en\/offline/,
  "quality evidence must make the local transcript evaluator explicit",
);
assert.match(
  source,
  /assertNarrationCueTimingEvidence\(/,
  "final QA must bind caption and story cue timecodes to the independently timestamped narration source",
);
assert.match(
  source,
  /narrationCueEvaluator=faster-whisper-small\.en\/timestamped-source/,
  "quality evidence must retain the scope of the source-backed cue-timing proof",
);
assert.match(
  source,
  /narrationMix: finalNarrationMix/,
  "the operator-facing QA report must preserve the final narration-mix receipt",
);
assert.match(
  source,
  /narrationPerformanceEvidence/,
  "final QA must retain the measured narration performance receipt, not only log it during TTS",
);
assert.match(
  source,
  /assertNarrationPerformanceEvidence\(ctx\.store\["narrationPerformanceEvidence"\]\)/,
  "production QA must reject a missing or malformed narration-performance receipt",
);

console.log("narration mix final-QA binding test passed");
