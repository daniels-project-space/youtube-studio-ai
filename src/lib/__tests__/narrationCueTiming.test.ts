import assert from "node:assert/strict";

import { assertNarrationCueTimingEvidence } from "@/lib/narrationCueTiming";
import {
  FASTER_WHISPER_VERSION,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";

const sourceSha256 = "a".repeat(64);
const expectedSha256 = "b".repeat(64);

function proof(
  words: Array<{ text: string; startMs: number; endMs: number }>,
): NarrationTranscriptProof {
  return {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper",
    model: {
      id: NARRATION_TRANSCRIPT_MODEL_ID,
      revision: NARRATION_TRANSCRIPT_MODEL_REVISION,
      packageVersion: FASTER_WHISPER_VERSION,
      computeType: "int8-cpu",
    },
    source: { sha256: sourceSha256, byteLength: 123 },
    expected: { textSha256: expectedSha256, wordCount: words.length },
    transcript: {
      text: words.map((word) => word.text).join(" "),
      wordCount: words.length,
      words,
    },
    assessment: {
      wordErrorRate: 0.05,
      lexicalRecall: 0.95,
      missingNumericTerms: [],
      thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 },
      passed: true,
    },
  };
}

const transcript = proof([
  { text: "The", startMs: 0, endMs: 120 },
  { text: "alarm", startMs: 130, endMs: 310 },
  { text: "rang", startMs: 320, endMs: 470 },
  { text: "at", startMs: 480, endMs: 560 },
  { text: "midnight", startMs: 570, endMs: 800 },
  { text: "Then", startMs: 1450, endMs: 1600 },
  { text: "the", startMs: 1610, endMs: 1680 },
  { text: "lights", startMs: 1690, endMs: 1860 },
  { text: "went", startMs: 1870, endMs: 1990 },
  { text: "out", startMs: 2000, endMs: 2110 },
  { text: "Finally", startMs: 3000, endMs: 3180 },
  { text: "the", startMs: 3190, endMs: 3260 },
  { text: "building", startMs: 3270, endMs: 3460 },
  { text: "went", startMs: 3470, endMs: 3580 },
  { text: "silent", startMs: 3590, endMs: 3780 },
]);

const cues = [
  { text: "The alarm rang at midnight.", start: 0, end: 0.95 },
  { text: "Then the lights went out.", start: 1.35, end: 2.2 },
  { text: "Finally the building went silent.", start: 2.9, end: 3.9 },
];

const evidence = assertNarrationCueTimingEvidence({
  sentenceTimings: cues,
  transcriptProof: transcript,
  narrationDurationSec: 4,
});
assert.equal(evidence.cueCount, 3);
assert.equal(evidence.matchedTokenCount, 15);
assert.equal(evidence.timingAlignedTokenCount, 15);
assert.equal(evidence.maxTimingDriftSec, 0);

assert.throws(
  () =>
    assertNarrationCueTimingEvidence({
      sentenceTimings: cues.map((cue, index) =>
        index === 1 ? { ...cue, start: 2.86, end: 2.89 } : cue,
      ),
      transcriptProof: transcript,
      narrationDurationSec: 4,
    }),
  /matched cue words occur in their persisted time windows/,
  "a shifted middle cue must fail even when the first and final cue still align",
);

assert.throws(
  () =>
    assertNarrationCueTimingEvidence({
      sentenceTimings: cues.map((cue) => ({
        ...cue,
        start: cue.start + 3,
        end: cue.end + 3,
      })),
      transcriptProof: transcript,
      narrationDurationSec: 7,
    }),
  /first spoken word falls outside/,
  "a shifted cue schedule must not inherit a transcript-fidelity pass",
);

assert.throws(
  () =>
    assertNarrationCueTimingEvidence({
      sentenceTimings: cues,
      transcriptProof: proof([
        ...transcript.transcript.words.slice(0, 4),
        { text: "midnight", startMs: 200, endMs: 250 },
        ...transcript.transcript.words.slice(5),
      ]),
      narrationDurationSec: 4,
    }),
  /timestamps are not monotonic/,
  "timestamped transcript evidence must itself be chronologically usable",
);

console.log("narration cue timing evidence tests passed");
