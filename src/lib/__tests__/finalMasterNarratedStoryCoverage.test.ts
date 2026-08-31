import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  buildQualityEvidence,
  FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
} from "@/engine/qualityEvidence";
import { planStorySpine, storySpineFingerprint } from "@/engine/storySpine";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import {
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  FASTER_WHISPER_VERSION,
  finalMasterNarrationTranscriptAuditObjectKey,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  prepareFinalMasterNarrationTranscriptAudit,
  sealFinalMasterNarrationSemanticEvidence,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";
import {
  assertFinalMasterNarratedStoryCoverageReceiptBinding,
  deriveFinalMasterNarratedStoryCoverage,
  parseFinalMasterNarratedStoryCoverageAuditBytes,
} from "@/lib/finalMasterNarratedStoryCoverage";

const keyPrefix = "owner/test/channel/narrated-story";
const runId = "run-narrated-story";
const sourceSha256 = "a".repeat(64);
const masterBytes = Buffer.from("durable narrated final master bytes");
const masterSha256 = createHash("sha256").update(masterBytes).digest("hex");
const expectedText = [
  "Mira finds a tiny seed beside the sunny garden wall.",
  "She gives it water and light every morning before school.",
].join(" ");
const expectedTextSha256 = createHash("sha256").update(expectedText).digest("hex");
const sentenceTimings = [
  { text: "Mira finds a tiny seed beside the sunny garden wall.", start: 0, end: 6 },
  { text: "She gives it water and light every morning before school.", start: 6, end: 12 },
];
const storySpine = planStorySpine({
  topic: "Mira learns to care for a seed",
  narrationDurationSec: 12,
  sentenceTimings,
  targetShotSec: 6,
});

function wordsFor(text: string, startSec: number, durationSec: number) {
  const words = text.match(/[^\s]+/g) ?? [];
  return words.map((text, index) => {
    const startMs = Math.round((startSec + (durationSec * index) / words.length) * 1_000);
    const endMs = Math.round((startSec + (durationSec * (index + 0.75)) / words.length) * 1_000);
    return { text, startMs, endMs };
  });
}

function proof(args: { sourceSha256: string; words: ReturnType<typeof wordsFor>; text?: string }): NarrationTranscriptProof {
  const text = args.text ?? args.words.map((word) => word.text).join(" ");
  return {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper",
    model: {
      id: NARRATION_TRANSCRIPT_MODEL_ID,
      revision: NARRATION_TRANSCRIPT_MODEL_REVISION,
      packageVersion: FASTER_WHISPER_VERSION,
      computeType: "int8-cpu",
    },
    source: { sha256: args.sourceSha256, byteLength: 4_096 },
    expected: { textSha256: expectedTextSha256, wordCount: 19 },
    transcript: { text, wordCount: args.words.length, words: args.words },
    assessment: {
      wordErrorRate: 0,
      lexicalRecall: 1,
      missingNumericTerms: [],
      thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 },
      passed: true,
    },
  };
}

function narrationEvidence(finalWords: ReturnType<typeof wordsFor>, finalSha = masterSha256) {
  const sourceWords = [
    ...wordsFor(sentenceTimings[0]!.text, 0, 6),
    ...wordsFor(sentenceTimings[1]!.text, 6, 6),
  ];
  const audit = prepareFinalMasterNarrationTranscriptAudit({
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    finalMaster: { sha256: finalSha, durationSec: 14 },
    narration: {
      sourceSha256,
      expectedTextSha256,
      startSec: 2,
      durationSec: 12,
    },
    sourceTranscript: proof({ sourceSha256, words: sourceWords }),
    finalMasterTranscript: proof({ sourceSha256: finalSha, words: finalWords }),
  });
  const semantic = sealFinalMasterNarrationSemanticEvidence({
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
  return { audit, semantic };
}

const finalWords = [
  ...wordsFor(sentenceTimings[0]!.text, 2, 6),
  ...wordsFor(sentenceTimings[1]!.text, 8, 6),
];
const { audit, semantic } = narrationEvidence(finalWords);
const cueTiming = {
  version: "narration-cue-timing/v1" as const,
  sourceSha256,
  cueCount: 2,
  transcriptWordCount: 19,
  expectedTokenCount: 19,
  matchedTokenCount: 19,
  timingAlignedTokenCount: 19,
  matchedTokenRatio: 1,
  timingAlignedTokenRatio: 1,
  maxTimingDriftSec: 0,
};

const derived = deriveFinalMasterNarratedStoryCoverage({
  storySpine,
  expectedStorySpineFingerprint: storySpineFingerprint(storySpine),
  sentenceTimings,
  narrationCueTiming: cueTiming,
  finalMasterNarration: semantic,
  narrationAudit: audit.audit,
  keyPrefix,
  runId,
});

assert.equal(derived.receipt.measurementKind, "narration_semantic");
assert.equal(derived.receipt.coverage.coverageRatio, 1);
assert.equal(derived.receipt.coverage.passingBeatCount, storySpine.narrativeBeats.length);
assert.doesNotThrow(() => assertFinalMasterNarratedStoryCoverageReceiptBinding({
  receipt: derived.receipt,
  finalMasterNarration: semantic,
  narrationAudit: audit.audit,
  narrationCueTiming: cueTiming,
  coverageAudit: parseFinalMasterNarratedStoryCoverageAuditBytes(derived.preparedAudit.bytes),
}), "the compact receipt must re-measure the retained Story Spine against the exact final-master transcript");

assert.throws(
  () => parseFinalMasterNarratedStoryCoverageAuditBytes(Buffer.concat([
    derived.preparedAudit.bytes,
    Buffer.from("\n"),
  ])),
  /not canonical content-addressed JSON/,
  "whitespace-equivalent coverage audit bytes must not satisfy the content-addressed receipt",
);

const substitutedSecondSentence = wordsFor(
  "She leaves the seed alone and never returns to the garden.",
  8,
  6,
);
const substitutedEvidence = narrationEvidence([
  ...wordsFor(sentenceTimings[0]!.text, 2, 6),
  ...substitutedSecondSentence,
]);
const substituted = deriveFinalMasterNarratedStoryCoverage({
  storySpine,
  expectedStorySpineFingerprint: storySpineFingerprint(storySpine),
  sentenceTimings,
  narrationCueTiming: cueTiming,
  finalMasterNarration: substitutedEvidence.semantic,
  narrationAudit: substitutedEvidence.audit.audit,
  keyPrefix,
  runId,
});
assert.ok(
  substituted.receipt.coverage.coverageRatio < 0.95,
  "a final-master transcript that omits a planned beat must retain a truthful below-floor narrated-story coverage ratio",
);
assert.equal(
  substituted.receipt.coverage.failingBeatCount,
  1,
  "a substituted beat must fail its own narration-semantic calibration instead of hiding in a whole-transcript pass",
);

assert.throws(
  () => deriveFinalMasterNarratedStoryCoverage({
    storySpine,
    expectedStorySpineFingerprint: "c".repeat(64),
    sentenceTimings,
    narrationCueTiming: cueTiming,
    finalMasterNarration: semantic,
    narrationAudit: audit.audit,
    keyPrefix,
    runId,
  }),
  /fingerprint does not match the plan retained before rendering/,
  "a post-render substitute Story Spine cannot be relabeled as the planned one",
);

assert.throws(
  () => deriveFinalMasterNarratedStoryCoverage({
    storySpine,
    expectedStorySpineFingerprint: storySpineFingerprint(storySpine),
    sentenceTimings: [
      sentenceTimings[0]!,
      { ...sentenceTimings[1]!, text: "A different post-render sentence." },
    ],
    narrationCueTiming: cueTiming,
    finalMasterNarration: semantic,
    narrationAudit: audit.audit,
    keyPrefix,
    runId,
  }),
  /text does not match the Story Spine/,
  "replaced source timings cannot be used to manufacture final-master story coverage",
);

assert.throws(
  () => assertFinalMasterNarratedStoryCoverageReceiptBinding({
    receipt: derived.receipt,
    finalMasterNarration: semantic,
    narrationAudit: audit.audit,
    narrationCueTiming: { ...cueTiming, sourceSha256: "d".repeat(64) },
    coverageAudit: derived.preparedAudit.audit,
  }),
  /cue timing belongs to a different narration source/,
  "a cue-timing receipt from another narration source must not verify the story audit",
);

const reviewFrameBytes = Buffer.from("durable narrated review frame");
const reviewFrame = {
  id: "frame-0",
  tSec: 2,
  r2Key: `${keyPrefix}/runs/${runId}/review/frame-0.jpg`,
  contentSha256: createHash("sha256").update(reviewFrameBytes).digest("hex"),
  byteLength: reviewFrameBytes.byteLength,
};
const reviewEvidenceManifestKey = `${keyPrefix}/runs/${runId}/review/evidence.json`;
const visualReviewReleaseReceipt = createVisualReviewReleaseReceipt({
  reviewFingerprint: "review-fingerprint",
  reviewReceiptVersion: "visual-review/v1",
  reviewReceiptFingerprint: "c".repeat(64),
  verdict: "pass",
  summary: "Narrated Story Spine review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
  referenceCriteriaComplete: true,
  evidence: {
    source: { durationSec: 14, sha256: masterSha256 },
    manifestKey: reviewEvidenceManifestKey,
    frameKeys: [reviewFrame.r2Key],
    frameArtifacts: [reviewFrame],
  },
});
const visualReview = {
  reviewFingerprint: visualReviewReleaseReceipt.reviewFingerprint,
  reviewReceiptVersion: visualReviewReleaseReceipt.reviewReceiptVersion,
  reviewReceiptFingerprint: visualReviewReleaseReceipt.reviewReceiptFingerprint,
  releaseReceiptFingerprint: visualReviewReleaseReceipt.releaseReceiptFingerprint,
};
const qualityEvidence = buildQualityEvidence({
  episode: {
    lane: { key: "narrated_documentary", renderer: "narrated_stock" },
    topic: "Mira learns to care for a seed",
    story: {
      source: FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
      beatCount: derived.receipt.storySpine.beatCount,
      shotCount: derived.receipt.storySpine.shotCount,
      coverageRatio: derived.receipt.coverage.coverageRatio,
      measurementScope: "final_master",
      measurementKind: "narration_semantic",
      finalMasterNarratedStoryReceiptFingerprint: derived.receipt.receiptFingerprint,
    },
  },
  technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
  visual: { passed: true, evaluator: "visual-review", evidence: ["Chronological review passed."] },
  temporal: { passed: true, evaluator: "pacing-review", evidence: ["Pacing review passed."] },
  narrative: { passed: true, evaluator: "story-review", evidence: ["Narrative review passed."] },
  audio: {
    score: 8.1,
    minimumScore: 7,
    evaluator: "audio-aesthetics",
    evidence: ["Final-master narration and mix score passed."],
  },
  brand: { passed: true, evaluator: "identity-grader", evidence: ["Identity lock is visible."] },
});
const qualityBinding = createFinalMasterQualityEvidenceBinding({
  finalMaster: { sha256: masterSha256, durationSec: 14 },
  visualReview,
  contentLane: { key: "narrated_documentary", renderer: "narrated_stock" },
  qualityEvidence,
});
const certificateInput = {
  version: "final-master-release-certificate/v1" as const,
  finalMaster: {
    r2Key: `${keyPrefix}/runs/${runId}/master.mp4`,
    sha256: masterSha256,
    byteLength: masterBytes.byteLength,
    durationSec: 14,
  },
  visualReview: {
    evidenceManifestKey: reviewEvidenceManifestKey,
    evidenceFrameKeys: [reviewFrame.r2Key],
    evidenceFrameArtifacts: [reviewFrame],
    receiptKey: visualReviewReleaseReceiptKey(
      keyPrefix,
      runId,
      visualReview.releaseReceiptFingerprint,
    ),
    ...visualReview,
  },
  audio: { finalMasterNarration: semantic, cueTiming },
  qualityEvidence: qualityBinding,
};
assert.throws(
  () => createFinalMasterReleaseCertificate(certificateInput),
  /requires its durable coverage sidecar/,
  "a production quality receipt cannot claim final-master narrated-story coverage without its certificate sidecar",
);
const certificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  narratedStoryCoverage: derived.receipt,
});
const retained = retainedFinalMasterReleaseObjectKeys({
  keyPrefix,
  runId,
  certificateKey: finalMasterReleaseCertificateKey(
    keyPrefix,
    runId,
    certificate.certificateFingerprint,
  ),
  certificate,
});
assert.ok(
  retained.includes(derived.receipt.auditArtifact.r2Key),
  "the release certificate retains the content-addressed narrated-story coverage audit sidecar",
);

async function verifyDurableNarratedStoryCoverageReload(): Promise<void> {
  const durableCertificate = parseFinalMasterReleaseCertificateBytes(
    Buffer.from(JSON.stringify(certificate)),
  );
  const objects = new Map<string, Buffer>([
    [certificate.finalMaster.r2Key, masterBytes],
    [certificate.visualReview.receiptKey, Buffer.from(JSON.stringify(visualReviewReleaseReceipt))],
    [certificate.visualReview.evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 14, sha256: masterSha256 },
      manifestKey: reviewEvidenceManifestKey,
      frames: [reviewFrame],
    }))],
    [reviewFrame.r2Key, reviewFrameBytes],
    [semantic.auditArtifact.r2Key, audit.bytes],
    [derived.receipt.auditArtifact.r2Key, derived.preparedAudit.bytes],
  ]);
  const getObjectBytes = async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object missing");
    return bytes;
  };
  const getObjectIntegrity = async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object missing");
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
    };
  };

  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: durableCertificate,
      getObjectBytes,
      getObjectIntegrity,
    }),
    "certificate reload must re-read and re-measure the content-addressed narrated Story Spine audit",
  );

  objects.set(
    derived.receipt.auditArtifact.r2Key,
    Buffer.concat([derived.preparedAudit.bytes, Buffer.from("\n")]),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: durableCertificate,
      getObjectBytes,
      getObjectIntegrity,
    }),
    /not canonical content-addressed JSON/,
    "a rewritten narrated Story Spine audit must fail closed on certificate reload",
  );
}

verifyDurableNarratedStoryCoverageReload()
  .then(() => console.log("final-master narrated Story Spine coverage tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
