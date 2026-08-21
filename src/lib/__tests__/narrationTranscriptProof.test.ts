import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertFinalMasterNarrationTranscriptAuditBinding,
  assertNarrationTranscriptProof,
  assertFinalMasterNarrationSemanticEvidence,
  buildNarrationTranscriptProofInvocation,
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMasterNarrationTranscriptAuditObjectKey,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_PYTHON,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  parseFinalMasterNarrationTranscriptAuditBytes,
  prepareFinalMasterNarrationTranscriptAudit,
  proveNarrationTranscript,
  sealFinalMasterNarrationSemanticEvidence,
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

  const finalMasterSha256 = "b".repeat(64);
  const finalMasterProof: NarrationTranscriptProof = {
    ...valid,
    source: { sha256: finalMasterSha256, byteLength: 4_096 },
  };
  const audit = prepareFinalMasterNarrationTranscriptAudit({
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    finalMaster: { sha256: finalMasterSha256, durationSec: 45 },
    narration: {
      sourceSha256,
      expectedTextSha256,
      startSec: 3,
      durationSec: 12,
    },
    sourceTranscript: valid,
    finalMasterTranscript: finalMasterProof,
  });
  const semanticEvidence = sealFinalMasterNarrationSemanticEvidence({
    version: "final-master-narration-semantic-evidence/v1",
    finalMaster: audit.audit.finalMaster,
    narration: audit.audit.narration,
    sourceTranscript: audit.sourceTranscript,
    finalMasterTranscript: audit.finalMasterTranscript,
    auditArtifact: {
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      r2Key: finalMasterNarrationTranscriptAuditObjectKey("owner/test", "run-proof", audit.contentSha256),
      contentSha256: audit.contentSha256,
      byteLength: audit.bytes.byteLength,
    },
  });
  assert.doesNotThrow(
    () => assertFinalMasterNarrationSemanticEvidence(semanticEvidence),
    "a final-master transcript must bind the reviewed master and the same approved narration text",
  );
  assert.doesNotThrow(
    () => assertFinalMasterNarrationTranscriptAuditBinding({
      evidence: semanticEvidence,
      audit: parseFinalMasterNarrationTranscriptAuditBytes(audit.bytes),
    }),
    "the compact receipt must reconnect to the exact canonical full transcript audit",
  );
  assert.throws(
    () => parseFinalMasterNarrationTranscriptAuditBytes(Buffer.concat([audit.bytes, Buffer.from("\n")])),
    /not canonical content-addressed JSON/,
    "even JSON-equivalent whitespace changes must not satisfy the content-addressed R2 audit reference",
  );
  const { receiptFingerprint: _semanticFingerprint, ...semanticInput } = semanticEvidence;
  void _semanticFingerprint;
  assert.throws(
    () => prepareFinalMasterNarrationTranscriptAudit({
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      finalMaster: semanticInput.finalMaster,
      narration: semanticInput.narration,
      sourceTranscript: valid,
      finalMasterTranscript: {
        ...finalMasterProof,
        source: { ...finalMasterProof.source, sha256: "c".repeat(64) },
      },
    }),
    /proof source does not match the authored narration bytes/,
    "a transcript of another master cannot be relabeled as this released master",
  );
  assert.throws(
    () => prepareFinalMasterNarrationTranscriptAudit({
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      finalMaster: semanticInput.finalMaster,
      narration: { ...semanticEvidence.narration, startSec: 40, durationSec: 12 },
      sourceTranscript: valid,
      finalMasterTranscript: finalMasterProof,
    }),
    /extends beyond the released master/,
    "a sealed receipt cannot claim narration timing outside the reviewed master",
  );
  assert.throws(
    () => assertFinalMasterNarrationSemanticEvidence({
      ...semanticEvidence,
      narration: { ...semanticEvidence.narration, expectedTextSha256: sha("other approved script") },
    }),
    /fingerprint does not match/,
    "an edited narration binding must invalidate the sealed semantic receipt",
  );

  const longWords = Array.from({ length: 4_500 }, (_, index) => ({
    text: `token${index}`,
    startMs: index * 240,
    endMs: index * 240 + 180,
  }));
  const longText = longWords.map((word) => word.text).join(" ");
  const longExpectedTextSha256 = sha(longText);
  const longSourceSha256 = "c".repeat(64);
  const longMasterSha256 = "d".repeat(64);
  const longSourceProof: NarrationTranscriptProof = {
    ...valid,
    source: { sha256: longSourceSha256, byteLength: 12_000 },
    expected: { textSha256: longExpectedTextSha256, wordCount: longWords.length },
    transcript: { text: longText, wordCount: longWords.length, words: longWords },
    assessment: { ...valid.assessment, wordErrorRate: 0, lexicalRecall: 1 },
  };
  const longMasterProof: NarrationTranscriptProof = {
    ...longSourceProof,
    source: { sha256: longMasterSha256, byteLength: 16_000 },
  };
  const longAudit = prepareFinalMasterNarrationTranscriptAudit({
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    finalMaster: { sha256: longMasterSha256, durationSec: 1_400 },
    narration: {
      sourceSha256: longSourceSha256,
      expectedTextSha256: longExpectedTextSha256,
      startSec: 2,
      durationSec: 1_200,
    },
    sourceTranscript: longSourceProof,
    finalMasterTranscript: longMasterProof,
  });
  const longEvidence = sealFinalMasterNarrationSemanticEvidence({
    version: "final-master-narration-semantic-evidence/v1",
    finalMaster: longAudit.audit.finalMaster,
    narration: longAudit.audit.narration,
    sourceTranscript: longAudit.sourceTranscript,
    finalMasterTranscript: longAudit.finalMasterTranscript,
    auditArtifact: {
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      r2Key: finalMasterNarrationTranscriptAuditObjectKey("owner/test", "long-run", longAudit.contentSha256),
      contentSha256: longAudit.contentSha256,
      byteLength: longAudit.bytes.byteLength,
    },
  });
  assert.ok(longAudit.bytes.byteLength > 100_000, "adversarial timestamp evidence must exceed the runner inline limit");
  assert.ok(
    Buffer.byteLength(JSON.stringify(longEvidence)) < 10_000,
    "the stage/certificate narration receipt must remain bounded even for 4,500 transcript words",
  );
  assert.doesNotThrow(
    () => assertFinalMasterNarrationTranscriptAuditBinding({
      evidence: longEvidence,
      audit: parseFinalMasterNarrationTranscriptAuditBytes(longAudit.bytes),
    }),
    "the full 4,500-word audit must remain recoverable and cryptographically bound from the compact receipt",
  );
}

main().then(() => console.log("narration transcript proof tests passed"));
