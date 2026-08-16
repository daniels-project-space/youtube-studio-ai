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
