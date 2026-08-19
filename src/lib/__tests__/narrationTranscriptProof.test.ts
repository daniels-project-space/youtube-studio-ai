import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertNarrationTranscriptProof,
  buildNarrationTranscriptProofInvocation,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_PYTHON,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  proveNarrationTranscript,
  sha256NarrationTranscriptSource,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const words = [{ text: "The", startMs: 0, endMs: 100 }, { text: "narration", startMs: 120, endMs: 300 }];

async function main() {
  const temp = mkdtempSync(join(tmpdir(), "narration-proof-test-"));
  const audioPath = join(temp, "narration.mp3");
  const audio = Buffer.from("synthetic narration audio bytes");
  const expectedText = "The narration is an independently transcribed exact approved source with enough words for a stable test.";
  writeFileSync(audioPath, audio);
  const sourceSha256 = await sha256NarrationTranscriptSource(audioPath);
  const expectedTextSha256 = sha(expectedText);
  const valid: NarrationTranscriptProof = {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper",
    model: { id: NARRATION_TRANSCRIPT_MODEL_ID, revision: NARRATION_TRANSCRIPT_MODEL_REVISION, packageVersion: "1.2.1", computeType: "int8-cpu" },
    source: { sha256: sourceSha256, byteLength: audio.length },
    expected: { textSha256: expectedTextSha256, wordCount: 16 },
    transcript: { text: "The narration is an independently transcribed exact approved source with enough words for a stable test", wordCount: words.length, words },
    assessment: { wordErrorRate: 0.1, lexicalRecall: 0.95, missingNumericTerms: [], thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 }, passed: true },
  };

  const invocation = buildNarrationTranscriptProofInvocation({ audioPath, expectedTextPath: "/tmp/expected.txt", sourceSha256, expectedTextSha256 });
  assert.equal(invocation.command, NARRATION_TRANSCRIPT_PROOF_PYTHON);
  assert.ok(invocation.args.includes("--model-dir"));
  assert.ok(invocation.args.includes(NARRATION_TRANSCRIPT_MODEL_ID) === false, "model identity is fixed in the worker receipt, not caller controlled");

  const proof = proveNarrationTranscript({
    audioPath,
    expectedText,
    sourceSha256,
    runner: () => ({ status: 0, stdout: JSON.stringify(valid), stderr: "" }),
  });
  assert.equal(proof.assessment.passed, true);
  assert.throws(() => assertNarrationTranscriptProof({
    ...valid,
    assessment: { ...valid.assessment, wordErrorRate: 0.4, passed: true },
  }, { sourceSha256, sourceByteLength: audio.length, expectedTextSha256 }), /pass flag does not match/);
  assert.throws(() => assertNarrationTranscriptProof({
    ...valid,
    expected: { ...valid.expected, textSha256: sha("different script") },
  }, { sourceSha256, sourceByteLength: audio.length, expectedTextSha256 }), /expected text does not match/);
}

main().then(() => console.log("narration transcript proof tests passed"));
