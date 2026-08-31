import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { referenceQualityContractFingerprint } from "@/engine/creative/referenceQualityAttestation";
import { QualityAxisEvidenceSchema } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  assertReleaseCertificateVisualReviewBindings,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  FASTER_WHISPER_VERSION,
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMasterNarrationTranscriptAuditObjectKey,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  prepareFinalMasterNarrationTranscriptAudit,
  sealFinalMasterNarrationSemanticEvidence,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";
import {
  assertReferenceQualityFinalMasterBinding,
  createReferenceQualityEvidenceBridgeV2,
  createUnmeasuredReferenceQualityFinalMasterBinding,
  referenceQualityAudioAxisFingerprint,
  referenceQualityEvidenceBridgeV2Fingerprint,
  type ReferenceQualityEvidenceBridgeV2,
} from "@/lib/referenceQualityFinalMasterBinding";

const keyPrefix = "owner/alice/channel/bridge/";
const runId = "run-bridge-v2";
const masterSha256 = "a".repeat(64);
const narrationSourceSha256 = "b".repeat(64);
const expectedTextSha256 = "c".repeat(64);
const reviewFingerprint = "d".repeat(64);
const reviewReceiptFingerprint = "e".repeat(64);
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
const frameBytes = [Buffer.from("bridge-review-frame")];
const frameArtifacts = frameBytes.map((bytes, index) => ({
  r2Key: `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f00${index + 1}.jpg`,
  contentSha256: createHash("sha256").update(bytes).digest("hex"),
  byteLength: bytes.byteLength,
}));
const finalMaster = { sha256: masterSha256, durationSec: 60 };

function passingTranscriptProof(sourceSha256: string): NarrationTranscriptProof {
  return {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper",
    model: {
      id: NARRATION_TRANSCRIPT_MODEL_ID,
      revision: NARRATION_TRANSCRIPT_MODEL_REVISION,
      packageVersion: FASTER_WHISPER_VERSION,
      computeType: "int8-cpu",
    },
    source: { sha256: sourceSha256, byteLength: 64 },
    expected: { textSha256: expectedTextSha256, wordCount: 10 },
    transcript: {
      text: "The released narration remains clear and intelligible.",
      wordCount: 1,
      words: [{ text: "clear", startMs: 0, endMs: 200 }],
    },
    assessment: {
      wordErrorRate: 0.1,
      lexicalRecall: 0.95,
      missingNumericTerms: [],
      thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 },
      passed: true,
    },
  };
}

const preparedNarrationAudit = prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster,
  narration: {
    sourceSha256: narrationSourceSha256,
    expectedTextSha256,
    startSec: 1,
    durationSec: 30,
  },
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof(masterSha256),
});
const narrationSemantic = sealFinalMasterNarrationSemanticEvidence({
  version: "final-master-narration-semantic-evidence/v1",
  finalMaster: preparedNarrationAudit.audit.finalMaster,
  narration: preparedNarrationAudit.audit.narration,
  sourceTranscript: preparedNarrationAudit.sourceTranscript,
  finalMasterTranscript: preparedNarrationAudit.finalMasterTranscript,
  auditArtifact: {
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    r2Key: finalMasterNarrationTranscriptAuditObjectKey(
      keyPrefix,
      runId,
      preparedNarrationAudit.contentSha256,
    ),
    contentSha256: preparedNarrationAudit.contentSha256,
    byteLength: preparedNarrationAudit.bytes.byteLength,
  },
});
const audioAxis = QualityAxisEvidenceSchema.parse({
  status: "pass",
  evaluator: "audio aesthetics grader",
  evidence: ["final-master narration and bed were scored together"],
  score: 8.5,
  minimumScore: 6,
});
const visualReceipt = createVisualReviewReleaseReceipt({
  reviewFingerprint,
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint,
  verdict: "pass",
  summary: "Final-master review passed with durable frames.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: finalMaster,
    manifestKey: evidenceManifestKey,
    frameKeys: frameArtifacts.map((frame) => frame.r2Key),
    frameArtifacts,
  },
});
const visualRelease = {
  reviewFingerprint: visualReceipt.reviewFingerprint,
  reviewReceiptVersion: visualReceipt.reviewReceiptVersion,
  reviewReceiptFingerprint: visualReceipt.reviewReceiptFingerprint,
  releaseReceiptFingerprint: visualReceipt.releaseReceiptFingerprint,
  verdict: visualReceipt.verdict,
  source: visualReceipt.evidence.source,
};

function createBridge(family: "narrated_stock" | "shorts" | "illustrated_explainer") {
  return createReferenceQualityEvidenceBridgeV2({
    contract: referenceQualityContractFor(family),
    finalMaster,
    visualRelease,
    finalMasterNarration: narrationSemantic,
    audioAxis,
  });
}

function assertBridge(bridge: ReferenceQualityEvidenceBridgeV2) {
  return assertReferenceQualityFinalMasterBinding({
    binding: bridge,
    finalMasterSha256: masterSha256,
    finalMasterDurationSec: finalMaster.durationSec,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptVersion: visualReceipt.reviewReceiptVersion,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReceipt.releaseReceiptFingerprint,
    finalMasterNarration: narrationSemantic,
    audioAxis,
    visualRelease,
  });
}

function resignBridge(
  bridge: ReferenceQualityEvidenceBridgeV2,
  changes: Partial<Omit<ReferenceQualityEvidenceBridgeV2, "bridgeFingerprint">>,
): ReferenceQualityEvidenceBridgeV2 {
  const { bridgeFingerprint: _fingerprint, ...unsigned } = { ...bridge, ...changes };
  void _fingerprint;
  return {
    ...unsigned,
    bridgeFingerprint: referenceQualityEvidenceBridgeV2Fingerprint(unsigned),
  };
}

const illustrated = createBridge("illustrated_explainer");
assert.equal(illustrated.version, "reference-quality-evidence-bridge/v2");
assert.equal(illustrated.assessment, "partially_measured");
assert.deepEqual(
  illustrated.evidence.filter((item) => item.measurementState === "measured").map((item) => ({
    requirementId: item.requirementId,
    evidenceId: item.evidenceId,
  })),
  [{
    requirementId: "comprehensible-narration",
    evidenceId: "audio-intelligibility-or-continuity-evidence",
  }],
  "illustrated explainer V2 may attest only the single allowlisted narration/audio pair",
);
assert.ok(
  illustrated.evidence.filter((item) => item.measurementState !== "measured")
    .every((item) => item.measurementState === "unmeasured"),
  "all non-allowlisted contract requirements remain unmeasured",
);
assert.deepEqual(assertBridge(illustrated), illustrated);
assert.throws(
  () => assertBridge({ ...illustrated, bridgeFingerprint: "0".repeat(64) }),
  /bridge v2 fingerprint does not match/,
  "a persisted V2 bridge must fail before any untrusted payload can be interpreted",
);

const shorts = createBridge("shorts");
assert.deepEqual(
  shorts.evidence.filter((item) => item.measurementState === "measured").map((item) => item.requirementId),
  ["intelligible-short-narration"],
  "Shorts use their distinct allowlisted requirement rather than inheriting illustrated proof",
);

const narratedStock = createBridge("narrated_stock");
assert.deepEqual(
  narratedStock.evidence.filter((item) => item.measurementState === "measured").map((item) => ({
    requirementId: item.requirementId,
    evidenceId: item.evidenceId,
  })),
  [{
    requirementId: "measured-documentary-narration",
    evidenceId: "audio-intelligibility-or-continuity-evidence",
  }],
  "narrated stock may reuse the same final-master narration recipe only for its own documentary narration pair",
);
assert.deepEqual(assertBridge(narratedStock), narratedStock);

const v1 = createUnmeasuredReferenceQualityFinalMasterBinding({
  contract: referenceQualityContractFor("illustrated_explainer"),
  finalMasterSha256: masterSha256,
  visualReviewFingerprint: reviewFingerprint,
  visualReviewReceiptFingerprint: reviewReceiptFingerprint,
});
assert.equal(
  assertReferenceQualityFinalMasterBinding({
    binding: v1,
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }).version,
  "reference-quality-final-master-binding/v1",
  "historical V1 records remain valid without V2 sibling receipts",
);

assert.throws(
  () => createReferenceQualityEvidenceBridgeV2({
    contract: referenceQualityContractFor("quizyear"),
    finalMaster,
    visualRelease,
    finalMasterNarration: narrationSemantic,
    audioAxis,
  }),
  /does not permit measured evidence for family quizyear/,
  "identical narration receipts cannot upgrade a non-narrated quiz family",
);
assert.throws(
  () => createReferenceQualityEvidenceBridgeV2({
    contract: referenceQualityContractFor("sleep"),
    finalMaster,
    visualRelease,
    finalMasterNarration: narrationSemantic,
    audioAxis,
  }),
  /does not permit measured evidence for family sleep/,
  "wordless ambient audio remains unmeasured until it has its own final-master continuity receipt",
);

assert.throws(
  () => assertBridge(resignBridge(illustrated, {
    finalMaster: { ...finalMaster, sha256: "1".repeat(64) },
  })),
  /different final master/,
  "a re-signed persisted V2 bridge cannot move to a different master",
);
assert.throws(
  () => assertBridge(resignBridge(illustrated, {
    visualRelease: { ...visualRelease, reviewFingerprint: "2".repeat(64) },
  })),
  /different visual-release receipt/,
  "a re-signed V2 bridge cannot move to another visual review",
);
assert.throws(
  () => assertBridge(resignBridge(illustrated, {
    visualRelease: { ...visualRelease, reviewReceiptVersion: "visual-review-receipt/v99" },
  })),
  /different visual-release receipt/,
  "a V2 bridge also binds the exact visual-review receipt contract version",
);
assert.throws(
  () => assertBridge(resignBridge(illustrated, {
    evidence: illustrated.evidence.map((item) => item.measurementState === "measured"
      ? { ...item, narrationSemanticFingerprint: "3".repeat(64) }
      : item),
  })),
  /narration semantic fingerprint does not match/,
  "a measured item must name the exact final-master narration receipt",
);
assert.throws(
  () => assertReferenceQualityFinalMasterBinding({
    binding: illustrated,
    finalMasterSha256: masterSha256,
    finalMasterDurationSec: finalMaster.durationSec,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptVersion: visualReceipt.reviewReceiptVersion,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualReceipt.releaseReceiptFingerprint,
    finalMasterNarration: narrationSemantic,
    audioAxis: { ...audioAxis, evaluator: "other audio evaluator" },
    visualRelease,
  }),
  /audio-axis fingerprint does not match/,
  "a differently canonicalized audio-axis receipt cannot be substituted",
);
const crossFamilyContract = referenceQualityContractFor("narrated_stock");
assert.throws(
  () => assertBridge(resignBridge(illustrated, {
    family: crossFamilyContract.family,
    contract: crossFamilyContract,
    contractFingerprint: referenceQualityContractFingerprint(crossFamilyContract),
  })),
  /does not enumerate every required evidence item/,
  "even a re-signed persisted V2 claim cannot transfer illustrated requirements to narrated stock",
);

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    ...finalMaster,
    byteLength: 2_048,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: frameArtifacts.map((frame) => frame.r2Key),
    evidenceFrameArtifacts: frameArtifacts,
    receiptKey: visualReviewReleaseReceiptKey(keyPrefix, runId, visualReceipt.releaseReceiptFingerprint),
    reviewFingerprint,
    reviewReceiptVersion: visualReceipt.reviewReceiptVersion,
    reviewReceiptFingerprint,
    releaseReceiptFingerprint: visualReceipt.releaseReceiptFingerprint,
  },
  referenceQuality: illustrated,
  audio: {
    finalMasterNarration: narrationSemantic,
    qualityAxis: audioAxis,
  },
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificate),
  "a V2 bridge verifies against its certificate's same-master narration, audio, and visual siblings",
);
const { certificateFingerprint: _certificateFingerprint, ...certificateInput } = certificate;
void _certificateFingerprint;
const narratedStockCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  referenceQuality: narratedStock,
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(narratedStockCertificate),
  "narrated stock keeps the same certificate-bound narration, audio, and visual tamper checks",
);
assert.doesNotThrow(
  () => assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt: visualReceipt,
    evidenceManifest: {
      source: finalMaster,
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    },
  }),
  "durable visual-release reload must cross-validate the V2 bridge against the exact reviewed master",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    audio: {
      ...certificateInput.audio,
      qualityAxis: { ...audioAxis, evaluator: "substituted audio receipt" },
    },
  }),
  /audio-axis fingerprint does not match/,
  "a certificate must fail closed rather than silently demote a malformed V2 bridge",
);
assert.equal(
  referenceQualityAudioAxisFingerprint(audioAxis),
  referenceQualityAudioAxisFingerprint({ ...audioAxis }),
  "audio receipt fingerprinting is canonical and stable",
);

async function verifyDurableV2Bridge() {
  const certificateKey = finalMasterReleaseCertificateKey(
    keyPrefix,
    runId,
    certificate.certificateFingerprint,
  );
  const objects = new Map<string, Buffer>([
    [certificateKey, Buffer.from(JSON.stringify(certificate))],
    [certificate.visualReview.receiptKey, Buffer.from(JSON.stringify(visualReceipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: finalMaster,
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    }))],
    [narrationSemantic.auditArtifact.r2Key, Buffer.from(preparedNarrationAudit.bytes)],
    ...frameArtifacts.map((frame, index) => [frame.r2Key, frameBytes[index]!] as const),
  ]);
  const getObjectBytes = async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("missing durable object");
    return bytes;
  };
  const getObjectIntegrity = async (key: string) => {
    assert.equal(key, certificate.finalMaster.r2Key);
    return {
      sha256: certificate.finalMaster.sha256,
      byteLength: certificate.finalMaster.byteLength!,
    };
  };
  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({ certificate, getObjectBytes, getObjectIntegrity }),
    "V2 must revalidate the stored master, durable visual receipt, narration audit, and exact reviewed frame bytes",
  );
  objects.delete(narrationSemantic.auditArtifact.r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({ certificate, getObjectBytes, getObjectIntegrity }),
    /narration audit is unavailable/,
    "a missing V2 narration audit must fail closed instead of degrading to unmeasured provenance",
  );
}

void verifyDurableV2Bridge()
  .then(() => console.log("reference-quality evidence bridge v2 tests passed"))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
