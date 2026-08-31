import assert from "node:assert/strict";

import { laneQualityPolicy } from "@/engine/contentLane";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import { selfContainedStoryTopicFingerprint } from "@/engine/selfContainedStoryReceipt";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import { createFinalMasterVisualPacingBinding } from "@/lib/finalMasterVisualPacingBinding";
import { createStudioTransitionDecisionReceipt } from "@/engine/studioPostproductionDecision";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION,
  assertFinalMasterReleaseCertificate,
  assertReleaseCertificateVisualReviewBindings,
  assertVisualReviewReleaseReceipt,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateFingerprint,
  finalMasterReleaseEvidenceFrameArtifactsFingerprint,
  finalMasterReleaseEvidenceFrameKeysFingerprint,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  retainedFinalMasterReleaseObjectKeys,
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
  ON_SCREEN_TEXT_PROOF_VERSION,
  TESSERACT_LANGUAGE,
  TESSERACT_PAGE_SEGMENTATION_MODE,
  type OnScreenTextProof,
} from "@/lib/onScreenTextProof";
import { createUnmeasuredReferenceQualityFinalMasterBinding } from "@/lib/referenceQualityFinalMasterBinding";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-proof-01";
const masterSha256 = "a".repeat(64);
const narrationSourceSha256 = "d".repeat(64);
const approvedNarrationTextSha256 = "e".repeat(64);
const reviewReceiptFingerprint = "b".repeat(64);
const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/manifest.json`;
const frameKeys = [
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f001.jpg`,
  `${keyPrefix}runs/${runId}/visual-review/review-fingerprint/frames/f002.jpg`,
];
const frameArtifacts = frameKeys.map((r2Key, index) => ({
  id: `frame-${index + 1}`,
  tSec: 20 + index * 40,
  r2Key,
  contentSha256: `${index + 1}`.repeat(64),
  byteLength: 100 + index,
}));

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
    source: { sha256: sourceSha256, byteLength: 128 },
    expected: { textSha256: approvedNarrationTextSha256, wordCount: 10 },
    transcript: {
      text: "Narration is intelligible in the released master.",
      wordCount: 1,
      words: [{ text: "Narration", startMs: 0, endMs: 250 }],
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

function sealNarrationAudit(
  audit: ReturnType<typeof prepareFinalMasterNarrationTranscriptAudit>,
) {
  return sealFinalMasterNarrationSemanticEvidence({
    version: "final-master-narration-semantic-evidence/v1",
    finalMaster: audit.audit.finalMaster,
    narration: audit.audit.narration,
    sourceTranscript: audit.sourceTranscript,
    finalMasterTranscript: audit.finalMasterTranscript,
    auditArtifact: {
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      r2Key: finalMasterNarrationTranscriptAuditObjectKey(keyPrefix, runId, audit.contentSha256),
      contentSha256: audit.contentSha256,
      byteLength: audit.bytes.byteLength,
    },
  });
}

const finalMasterNarrationAudit = prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { sha256: masterSha256, durationSec: 92.4 },
  narration: {
    sourceSha256: narrationSourceSha256,
    expectedTextSha256: approvedNarrationTextSha256,
    startSec: 2,
    durationSec: 60,
  },
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof(masterSha256),
});
const finalMasterNarration = sealNarrationAudit(finalMasterNarrationAudit);
const onScreenText: OnScreenTextProof = {
  version: ON_SCREEN_TEXT_PROOF_VERSION,
  engine: {
    name: "tesseract" as const,
    version: "5.3.4",
    language: TESSERACT_LANGUAGE,
    pageSegmentationMode: TESSERACT_PAGE_SEGMENTATION_MODE,
  },
  source: { sha256: masterSha256, byteLength: 2_048 },
  cues: [{
    id: "short-caption-001",
    sampleSec: 1.25,
    expectedTextSha256: "f".repeat(64),
    expectedTokenCount: 4,
    recognizedText: "A clear opening hook",
    recognizedTokenCount: 4,
    tokenCoverage: 1,
    minTokenCoverage: 0.8,
    passed: true,
  }],
  passed: true,
};

const receipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "review-fingerprint",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint,
  verdict: "pass",
  summary: "Evidence-backed visual review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: { durationSec: 92.4, sha256: masterSha256 },
    manifestKey: evidenceManifestKey,
    frameKeys,
    frameArtifacts,
  },
});
const receiptKey = visualReviewReleaseReceiptKey(
  keyPrefix,
  runId,
  receipt.releaseReceiptFingerprint,
);
assert.doesNotThrow(
  () => assertVisualReviewReleaseReceipt(receipt),
  "a legacy visual-review release receipt without a wide-sample score must remain readable",
);
const {
  version: _receiptVersion,
  releaseReceiptFingerprint: _receiptFingerprint,
  ...unsignedReceipt
} = receipt;
void _receiptVersion;
void _receiptFingerprint;
const wideSampleReceipt = createVisualReviewReleaseReceipt({
  ...unsignedReceipt,
  broadQualityScore: {
    version: "visual-review-wide-sample-quality/v1",
    score: 7.4,
    broadBatchCount: 3,
  },
});
assert.doesNotThrow(
  () => assertVisualReviewReleaseReceipt(wideSampleReceipt),
  "a new wide-sample score must be accepted when it is included in the release receipt fingerprint",
);
assert.throws(
  () => assertVisualReviewReleaseReceipt({
    ...wideSampleReceipt,
    broadQualityScore: { ...wideSampleReceipt.broadQualityScore!, score: 7.3 },
  }),
  /fingerprint does not match its payload/,
  "editing a sealed wide-sample score must invalidate its release receipt",
);

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    sha256: masterSha256,
    byteLength: 2_048,
    durationSec: 92.4,
  },
  visualReview: {
    evidenceManifestKey,
    evidenceFrameKeys: frameKeys,
    evidenceFrameArtifacts: frameArtifacts,
    receiptKey,
    reviewFingerprint: "review-fingerprint",
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint,
    releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
  },
  cinematic: {
    receiptFingerprint: "c".repeat(64),
    receipt: { version: "cinematic-final-master-qa-evidence/v2", pass: true },
  },
  audio: {
    finalMix: { correlation: 0.88, narrationStartSec: 2 },
    finalMasterNarration,
    finalMasterMeters: { integratedLufs: -16.2, windowMeanDb: -21.1 },
  },
  onScreenText,
});

function selfContainedQualityBinding(narrationTextSha256: string) {
  const topic = "How a water clock changed a city";
  const qualityEvidence = buildQualityEvidence({
    episode: {
      lane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
      topic,
      story: {
        plan: {
          version: "self-contained-story-plan-evidence/v1",
          measurementScope: "plan",
          family: "whiteboard",
          storyKind: "whiteboard-storyboard/v1",
          contentLaneKey: "whiteboard_explainer",
          topic,
          topicFingerprint: selfContainedStoryTopicFingerprint(topic),
          routeFingerprint: "4".repeat(64),
          programBriefFingerprint: "5".repeat(64),
          receiptFingerprint: "6".repeat(64),
          storyFingerprint: "7".repeat(64),
          plannerId: "certificate-fixture/v1",
          receiptVersion: "self-contained-story-receipt/v1",
          narrationTextSha256,
          counts: { beatCount: 2, shotCount: 2, panelCount: 2, spokenLineCount: 2 },
        },
      },
    },
    technical: { passed: true, evaluator: "fixture", evidence: ["master validated"] },
    visual: { passed: true, evaluator: "fixture", evidence: ["review passed"] },
    temporal: { passed: true, evaluator: "fixture", evidence: ["timing passed"] },
    narrative: { passed: true, evaluator: "fixture", evidence: ["critic passed"] },
    audio: { score: 8, minimumScore: 7, evaluator: "fixture", evidence: ["audio passed"] },
    brand: { passed: true, evaluator: "fixture", evidence: ["brand passed"] },
  });
  return createFinalMasterQualityEvidenceBinding({
    finalMaster: { sha256: masterSha256, durationSec: 92.4 },
    visualReview: {
      reviewFingerprint: "review-fingerprint",
      reviewReceiptVersion: "visual-review-receipt/v1",
      reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
    },
    contentLane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
    programRoute: {
      routeFingerprint: "4".repeat(64),
      family: "whiteboard",
      contentLaneKey: "whiteboard_explainer",
      programBriefFingerprint: "5".repeat(64),
    },
    qualityEvidence,
  });
}

const { certificateFingerprint: _narrationBoundCertificateFingerprint, ...narrationBoundCertificateInput } = certificate;
void _narrationBoundCertificateFingerprint;
const selfContainedNarrationBoundCertificate = createFinalMasterReleaseCertificate({
  ...narrationBoundCertificateInput,
  qualityEvidence: selfContainedQualityBinding(approvedNarrationTextSha256),
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(selfContainedNarrationBoundCertificate),
  "a narrated self-contained plan may release only when its approved narration digest matches the audited final master",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...narrationBoundCertificateInput,
    qualityEvidence: selfContainedQualityBinding("f".repeat(64)),
  }),
  /self-contained narrated plan does not match the narration audited in the final-master certificate/,
  "a certificate must reject a self-contained plan whose approved narration differs from the audible final master",
);

const whiteboardQualityBinding = selfContainedQualityBinding(approvedNarrationTextSha256);
const whiteboardPacingPolicy = laneQualityPolicy("whiteboard_explainer").visualPacing;
const whiteboardPacingIntervals = [
  ...Array.from({ length: 11 }, (_, index) => ({
    startSec: index * 8,
    endSec: (index + 1) * 8,
    durationSec: 8,
  })),
  { startSec: 88, endSec: 92.4, durationSec: 4.4 },
];
const whiteboardPacing = createFinalMasterVisualPacingBinding({
  finalMaster: { sha256: masterSha256, durationSec: 92.4 },
  contentLane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
  visualReview: {
    reviewFingerprint: "review-fingerprint",
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint,
    releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
  },
  qualityEvidence: {
    bindingFingerprint: whiteboardQualityBinding.bindingFingerprint,
    qualityEvidenceFingerprint: whiteboardQualityBinding.qualityEvidenceFingerprint,
  },
  visualPacing: {
    source: "ffmpeg/select-scene",
    ran: true,
    usable: true,
    enforced: true,
    verdict: "pass",
    signal: "calibrated_scene_rhythm_observed",
    durationSec: 92.4,
    policy: whiteboardPacingPolicy,
    changeTimestampsSec: Array.from({ length: 11 }, (_, index) => (index + 1) * 8),
    changeCount: 11,
    rawHoldIntervals: whiteboardPacingIntervals,
    evaluatedHoldIntervals: whiteboardPacingIntervals,
    excludedWindows: [],
    maxHoldSec: 8,
    medianHoldSec: 8,
    meetsPolicy: true,
  },
});
const pacingBoundCertificate = createFinalMasterReleaseCertificate({
  ...narrationBoundCertificateInput,
  qualityEvidence: whiteboardQualityBinding,
  visualPacing: whiteboardPacing,
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(pacingBoundCertificate),
  "a release certificate retains only pacing evidence bound to the same master, review, lane, and QA receipt",
);

const certificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  certificate.certificateFingerprint,
);
const certificateReference = createFinalMasterReleaseCertificateReference({
  keyPrefix,
  runId,
  certificateKey,
  certificate,
});

assert.deepEqual(
  certificateReference,
  {
    version: FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION,
    certificateKey,
    certificateFingerprint: certificate.certificateFingerprint,
    finalMaster: certificate.finalMaster,
    visualReview: {
      evidenceManifestKey,
      evidenceFrameCount: frameKeys.length,
      evidenceFrameKeysFingerprint: finalMasterReleaseEvidenceFrameKeysFingerprint(frameKeys),
      evidenceFrameArtifactsFingerprint: finalMasterReleaseEvidenceFrameArtifactsFingerprint(frameArtifacts),
      receiptKey,
      reviewFingerprint: "review-fingerprint",
      reviewReceiptVersion: "visual-review-receipt/v1",
      reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
    },
  },
  "the compact reference must retain the R2 certificate address and the master/review lineage without copying receipts",
);

assert.equal(
  certificateKey,
  `${keyPrefix}runs/${runId}/release-certificates/${certificate.certificateFingerprint}.json`,
  "certificate storage key must be derived from its payload fingerprint",
);
assert.deepEqual(
  parseFinalMasterReleaseCertificateBytes(Buffer.from(JSON.stringify(certificate))),
  certificate,
  "a durable certificate round-trip must preserve its content binding",
);
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificate),
  "a frozen legacy release certificate without the new reference binding must remain resumable/readable",
);

const { byteLength: _newMasterByteLength, ...legacyFinalMaster } = certificate.finalMaster;
void _newMasterByteLength;
const { certificateFingerprint: _legacyCertificateFingerprint, ...certificateWithoutFingerprint } = certificate;
void _legacyCertificateFingerprint;
const legacyUnsignedCertificate = {
  ...certificateWithoutFingerprint,
  finalMaster: legacyFinalMaster,
};
const legacyCertificate = {
  ...legacyUnsignedCertificate,
  certificateFingerprint: finalMasterReleaseCertificateFingerprint(legacyUnsignedCertificate),
};
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(legacyCertificate),
  "a pre-byte-receipt certificate with its original fingerprint remains readable for historical provenance",
);
assert.throws(
  () => createFinalMasterReleaseCertificate(legacyUnsignedCertificate),
  /lacks a byte-bound final-master receipt/,
  "new release certificates must bind the final master byte length",
);
assert.throws(
  () => createFinalMasterReleaseCertificateReference({
    keyPrefix,
    runId,
    certificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      legacyCertificate.certificateFingerprint,
    ),
    certificate: legacyCertificate,
  }),
  /lacks a byte-bound final-master receipt/,
  "new compact certificate references must retain the final master byte length",
);

const retained = retainedFinalMasterReleaseObjectKeys({
  keyPrefix,
  runId,
  certificateKey,
  certificate,
});
assert.deepEqual(
  retained,
  [...new Set([
    certificate.finalMaster.r2Key,
    evidenceManifestKey,
    receiptKey,
    finalMasterNarration.auditArtifact.r2Key,
    ...frameKeys,
    certificateKey,
  ])].sort(),
  "cleanup must retain the final master, certificate, receipt, narration audit, evidence manifest, and every evidence frame",
);

assert.doesNotThrow(() => assertReleaseCertificateVisualReviewBindings({
  certificate,
  receipt,
  evidenceManifest: {
    source: { durationSec: 92.4, sha256: masterSha256 },
    manifestKey: evidenceManifestKey,
    frames: frameArtifacts,
  },
}));
for (const [label, framePatch] of [
  ["identity", { id: "forged-frame-id" }],
  ["timestamp", { tSec: 20.25 }],
  ["content hash", { contentSha256: "f".repeat(64) }],
  ["byte length", { byteLength: 999 }],
] as const) {
  assert.throws(
    () => assertReleaseCertificateVisualReviewBindings({
      certificate,
      receipt,
      evidenceManifest: {
        source: { durationSec: 92.4, sha256: masterSha256 },
        manifestKey: evidenceManifestKey,
        frames: frameArtifacts.map((frame, index) =>
          index === 0 ? { ...frame, ...framePatch } : frame,
        ),
      },
    }),
    /does not match its visual-review evidence manifest/,
    `release-manifest replay must reject a forged visual-review frame ${label}`,
  );
}

assert.throws(
  () => assertFinalMasterReleaseCertificate({ ...certificate, finalMaster: { ...certificate.finalMaster, sha256: "d".repeat(64) } }),
  /fingerprint does not match/,
  "a certificate must fail closed if its master binding changes",
);
assert.throws(
  () => assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt: { ...receipt, summary: "tampered verdict detail" },
    evidenceManifest: {
      source: { durationSec: 92.4, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    },
  }),
  /release receipt fingerprint does not match/,
  "upload must reject a retained receipt whose verdict-bearing content changed",
);
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey,
    certificate: {
      ...certificate,
      visualReview: {
        ...certificate.visualReview,
        evidenceFrameKeys: ["owner/alice/channel/another/runs/other/visual-review/f001.jpg"],
      },
    },
  }),
  /fingerprint does not match|escapes the scoped run namespace/,
  "cleanup must reject a certificate that tries to retain evidence outside its run namespace",
);

const { certificateFingerprint: _certificateFingerprint, ...certificateInput } = certificate;
void _certificateFingerprint;
const certificatePostproductionDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: { editor_brief: { transitions: "hardcut" } },
  explicitTransition: "hardcut",
  studioTransitionPreset: "crossfade",
  studioSourceEntryFingerprints: ["a".repeat(64)],
});
const certificateWithPostproductionDecision = createFinalMasterReleaseCertificate({
  ...certificateInput,
  studioPostproductionDecisions: [certificatePostproductionDecision],
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificateWithPostproductionDecision),
  "a certificate may retain one sealed decision that records the transition actually selected for the master",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    studioPostproductionDecisions: [certificatePostproductionDecision, certificatePostproductionDecision],
  }),
  /cannot repeat a Studio post-production decision/i,
  "a certificate may not duplicate a post-production decision receipt",
);
const referenceReviewFingerprint = "e".repeat(64);
const certificateWithReferenceQuality = createFinalMasterReleaseCertificate({
  ...certificateInput,
  visualReview: {
    ...certificateInput.visualReview,
    reviewFingerprint: referenceReviewFingerprint,
  },
  referenceQuality: createUnmeasuredReferenceQualityFinalMasterBinding({
    contract: referenceQualityContractFor("illustrated_explainer"),
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: referenceReviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificateWithReferenceQuality),
  "a certificate must validate its sealed reference contract against the exact master and visual-review receipt",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    referenceQuality: createUnmeasuredReferenceQualityFinalMasterBinding({
      contract: referenceQualityContractFor("illustrated_explainer"),
      finalMasterSha256: "d".repeat(64),
      visualReviewFingerprint: referenceReviewFingerprint,
      visualReviewReceiptFingerprint: reviewReceiptFingerprint,
    }),
    visualReview: {
      ...certificateInput.visualReview,
      reviewFingerprint: referenceReviewFingerprint,
    },
  }),
  /different final master/,
  "certificate creation must fail closed when the reference contract is attached to different master bytes",
);
const mismatchedFinalMasterNarration = sealNarrationAudit(prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { ...finalMasterNarration.finalMaster, sha256: "f".repeat(64) },
  narration: finalMasterNarration.narration,
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof("f".repeat(64)),
}));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    audio: {
      ...certificateInput.audio,
      finalMasterNarration: mismatchedFinalMasterNarration,
    },
  }),
  /belongs to a different released master/,
  "certificate creation must reject a narration audition receipt for other master bytes",
);
const mismatchedFinalMasterNarrationTiming = sealNarrationAudit(prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster: { ...finalMasterNarration.finalMaster, durationSec: 91.5 },
  narration: finalMasterNarration.narration,
  sourceTranscript: passingTranscriptProof(narrationSourceSha256),
  finalMasterTranscript: passingTranscriptProof(masterSha256),
}));
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    audio: {
      ...certificateInput.audio,
      finalMasterNarration: mismatchedFinalMasterNarrationTiming,
    },
  }),
  /duration does not match the released master/,
  "certificate creation must reject a narration audition receipt with different master timing",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    onScreenText: {
      ...onScreenText,
      source: { ...onScreenText.source, sha256: "f".repeat(64) },
    },
  }),
  /on-screen text proof belongs to a different released master/,
  "certificate creation must reject timed OCR evidence for different final-master bytes",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    onScreenText: {
      ...onScreenText,
      passed: false,
    },
  }),
  /on-screen text proof does not pass every required cue/,
  "certificate creation must reject a non-passing timed OCR caption receipt",
);
const nonContentAddressedReceiptCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  visualReview: {
    ...certificate.visualReview,
    receiptKey: `${keyPrefix}runs/${runId}/visual-review/receipts/${"d".repeat(64)}.json`,
  },
});
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      nonContentAddressedReceiptCertificate.certificateFingerprint,
    ),
    certificate: nonContentAddressedReceiptCertificate,
  }),
  /visual-review receipt key is not content-addressed/,
  "upload and cleanup must reject a receipt path that is not derived from its receipt fingerprint",
);
const nonContentAddressedFinalMasterNarration = sealFinalMasterNarrationSemanticEvidence({
  version: finalMasterNarration.version,
  finalMaster: finalMasterNarration.finalMaster,
  narration: finalMasterNarration.narration,
  sourceTranscript: finalMasterNarration.sourceTranscript,
  finalMasterTranscript: finalMasterNarration.finalMasterTranscript,
  auditArtifact: {
    ...finalMasterNarration.auditArtifact,
    r2Key: `${keyPrefix}runs/${runId}/narration-transcript-audits/${"f".repeat(64)}.json`,
  },
});
const nonContentAddressedNarrationAuditCertificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  audio: {
    ...certificateInput.audio,
    finalMasterNarration: nonContentAddressedFinalMasterNarration,
  },
});
assert.throws(
  () => retainedFinalMasterReleaseObjectKeys({
    keyPrefix,
    runId,
    certificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      nonContentAddressedNarrationAuditCertificate.certificateFingerprint,
    ),
    certificate: nonContentAddressedNarrationAuditCertificate,
  }),
  /narration transcript audit key is not content-addressed/,
  "cleanup must retain only the content-addressed narration transcript audit for this release",
);

assert.throws(
  () => assertReleaseCertificateVisualReviewBindings({
    certificate,
    receipt,
    evidenceManifest: {
      source: { durationSec: 92.4, sha256: "d".repeat(64) },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    },
  }),
  /does not match its visual-review evidence manifest/,
  "upload must reject visual-review evidence that is not bound to the released master",
);

console.log("final-master release certificate tests passed");
