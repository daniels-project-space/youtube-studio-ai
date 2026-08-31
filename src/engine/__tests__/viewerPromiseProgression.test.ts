import assert from "node:assert/strict";

import {
  assertViewerPromiseProgressionCertificateBinding,
  assertViewerPromiseProgressionReceipt,
  createViewerPromiseProgressionReceipt,
  deriveViewerPromiseProgression,
} from "@/engine/viewerPromiseProgression";
import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  FASTER_WHISPER_VERSION,
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  NARRATION_TRANSCRIPT_MODEL_ID,
  NARRATION_TRANSCRIPT_MODEL_REVISION,
  NARRATION_TRANSCRIPT_PROOF_VERSION,
  prepareFinalMasterNarrationTranscriptAudit,
  sealFinalMasterNarrationSemanticEvidence,
  type NarrationTranscriptProof,
} from "@/lib/narrationTranscriptProof";

const masterSha256 = "a".repeat(64);
const narrationSourceSha256 = "b".repeat(64);
const expectedTextSha256 = "c".repeat(64);
const finalMaster = { sha256: masterSha256, durationSec: 12 };

function routeFor(args: { family: string; contentLaneKey: string }) {
  return {
    version: "channel-program-route-seed/v1" as const,
    // The module intentionally accepts a sealed run seed and does not infer
    // route identity from a mutable catalog lookup.
    routeKey: "narrated-stock/foundation/v1" as const,
    routeFingerprint: args.family === "music_loop" ? "1".repeat(64) : "2".repeat(64),
    family: args.family,
    contentLaneKey: args.contentLaneKey,
    programBriefFingerprint: "3".repeat(64),
    directives: {
      viewerJob: "Help a curious viewer understand a clear idea from beginning to end.",
      claimMode: "editorial_lane_policy" as const,
      topicRules: ["Use one concrete educational topic."],
      scriptRules: ["Advance the viewer through a coherent explanation."],
      criticFocus: ["Check that visual treatment supports the explanation."],
    },
    requiredBlocks: ["topic_select", "qa_visual"],
    context: { locale: "en", nicheKey: "educational" },
  };
}

const narratedRoute = routeFor({
  family: "narrated_stock",
  contentLaneKey: "narrated_documentary",
});
const narratedLane = {
  version: "content-lane/v1" as const,
  key: "narrated_documentary" as const,
  family: "narrated_stock",
  primaryRenderer: "stock_footage",
};

const storySpine = {
  version: "1.0.0" as const,
  timedScript: {
    version: "1.0.0" as const,
    narrationDurationSec: 12,
    sentences: [
      {
        id: "sentence-opening",
        text: "Mira finds a tiny seed.",
        t0: 0,
        t1: 6,
        sectionId: "section-opening",
        evidenceRefs: [],
      },
      {
        id: "sentence-lesson",
        text: "Mira gives it water and light.",
        t0: 6,
        t1: 12,
        sectionId: "section-lesson",
        evidenceRefs: [],
      },
    ],
  },
  narrativeBeats: [
    {
      id: "beat-opening",
      sourceSentenceIds: ["sentence-opening"],
      t0: 0,
      t1: 6,
      purpose: "Question",
      evidenceRefs: [],
    },
    {
      id: "beat-lesson",
      sourceSentenceIds: ["sentence-lesson"],
      t0: 6,
      t1: 12,
      purpose: "Answer",
      evidenceRefs: [],
    },
  ],
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [{ id: "character-mira", name: "Mira", look: "yellow raincoat" }],
    locations: [{ id: "setting-garden", name: "Garden", look: "raised garden bed" }],
    era: "present day",
    wardrobe: ["yellow raincoat"],
    props: ["seed", "watering can"],
    palette: ["yellow", "green"],
    cameraGrammar: ["gentle push"],
    negativeConstraints: ["logos"],
  },
  shotList: [
    {
      id: "shot-opening",
      beatId: "beat-opening",
      sourceSentenceIds: ["sentence-opening"],
      t0: 0,
      t1: 6,
      coveragePurpose: "Question",
      literalContent: "Mira holds a seed.",
      entities: ["character-mira"],
      locationId: "setting-garden",
      era: "present day",
      wardrobe: ["yellow raincoat"],
      props: ["seed"],
      continuityState: "Mira in the garden",
      cameraMove: "static" as const,
      shotScale: "medium" as const,
      lens: "35mm",
      lighting: "sunny",
      motion: "Mira raises her hand.",
      negative: "logos",
      generationProfile: "production" as const,
      candidateCount: 1,
      imageMinScore: 0.8,
      shotMinScore: 0.8,
      prompt: "Mira holds a seed.",
      seconds: 6,
      storyFunction: "opening",
      section: "section-opening",
      seed: 1,
    },
    {
      id: "shot-lesson",
      beatId: "beat-lesson",
      sourceSentenceIds: ["sentence-lesson"],
      t0: 6,
      t1: 12,
      coveragePurpose: "Answer",
      literalContent: "Mira waters a seed.",
      entities: ["character-mira"],
      locationId: "setting-garden",
      era: "present day",
      wardrobe: ["yellow raincoat"],
      props: ["watering can"],
      continuityState: "Mira remains in the garden",
      cameraMove: "static" as const,
      shotScale: "medium" as const,
      lens: "35mm",
      lighting: "sunny",
      motion: "Mira waters the seed.",
      negative: "logos",
      generationProfile: "production" as const,
      candidateCount: 1,
      imageMinScore: 0.8,
      shotMinScore: 0.8,
      prompt: "Mira waters a seed.",
      seconds: 6,
      storyFunction: "lesson",
      section: "section-lesson",
      seed: 2,
    },
  ],
  dpVisualSpecs: [
    {
      shotId: "shot-opening",
      keyframePrompt: "Mira holds a seed.",
      motionPrompt: "gentle hand movement",
      negativePrompt: "logos",
      styleLock: "warm educational illustration",
      firstFrameConstraint: "Mira holds seed",
      lastFrameConstraint: "Mira looks at seed",
      continuityState: "Mira in garden",
    },
    {
      shotId: "shot-lesson",
      keyframePrompt: "Mira waters a seed.",
      motionPrompt: "gentle water pour",
      negativePrompt: "logos",
      styleLock: "warm educational illustration",
      firstFrameConstraint: "Mira holds watering can",
      lastFrameConstraint: "water reaches soil",
      continuityState: "Mira in garden",
    },
  ],
  editorEdl: {
    version: "1.0.0" as const,
    durationSec: 12,
    shots: [
      { shotId: "shot-opening", sourceSentenceIds: ["sentence-opening"], t0: 0, t1: 6 },
      { shotId: "shot-lesson", sourceSentenceIds: ["sentence-lesson"], t0: 6, t1: 12 },
    ],
  },
  coverage: { mappedSec: 12, totalSec: 12, ratio: 1, gaps: [] },
};

function transcriptProof(sourceSha256: string): NarrationTranscriptProof {
  return {
    schemaVersion: NARRATION_TRANSCRIPT_PROOF_VERSION,
    provider: "faster-whisper" as const,
    model: {
      id: NARRATION_TRANSCRIPT_MODEL_ID,
      revision: NARRATION_TRANSCRIPT_MODEL_REVISION,
      packageVersion: FASTER_WHISPER_VERSION,
      computeType: "int8-cpu" as const,
    },
    source: { sha256: sourceSha256, byteLength: 256 },
    expected: { textSha256: expectedTextSha256, wordCount: 10 },
    transcript: {
      text: "Mira waters.",
      wordCount: 1,
      words: [
        { text: "Mira", startMs: 0, endMs: 300 },
      ],
    },
    assessment: {
      wordErrorRate: 0,
      lexicalRecall: 1,
      missingNumericTerms: [],
      thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 },
      passed: true,
    },
  };
}

const finalMasterNarrationAudit = prepareFinalMasterNarrationTranscriptAudit({
  version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMaster,
  narration: {
    sourceSha256: narrationSourceSha256,
    expectedTextSha256,
    startSec: 0,
    durationSec: 12,
  },
  sourceTranscript: transcriptProof(narrationSourceSha256),
  finalMasterTranscript: transcriptProof(masterSha256),
});
const finalMasterNarration = sealFinalMasterNarrationSemanticEvidence({
  version: "final-master-narration-semantic-evidence/v1",
  finalMaster: finalMasterNarrationAudit.audit.finalMaster,
  narration: finalMasterNarrationAudit.audit.narration,
  sourceTranscript: finalMasterNarrationAudit.sourceTranscript,
  finalMasterTranscript: finalMasterNarrationAudit.finalMasterTranscript,
  auditArtifact: {
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    r2Key: "owner/test/runs/run-1/narration-transcript-audits/receipt.json",
    contentSha256: "d".repeat(64),
    byteLength: 1_024,
  },
});

const narrationCueTiming = {
  version: "narration-cue-timing/v1" as const,
  sourceSha256: narrationSourceSha256,
  cueCount: 2,
  transcriptWordCount: 2,
  expectedTokenCount: 2,
  matchedTokenCount: 2,
  timingAlignedTokenCount: 2,
  matchedTokenRatio: 1,
  timingAlignedTokenRatio: 1,
  maxTimingDriftSec: 0,
};

const visualReview = {
  reviewFingerprint: "review-fingerprint",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "e".repeat(64),
  releaseReceiptFingerprint: "f".repeat(64),
  evidence: {
    version: "visual-review/v1",
    source: finalMaster,
    frames: [
      {
        id: "frame-opening",
        tSec: 3,
        selectionReasons: [],
        r2Key: "owner/test/runs/run-1/visual-review/frames/opening.jpg",
        contentSha256: "0".repeat(64),
        byteLength: 100,
      },
      {
        id: "frame-closing",
        tSec: 9,
        selectionReasons: [],
        r2Key: "owner/test/runs/run-1/visual-review/frames/closing.jpg",
        contentSha256: "9".repeat(64),
        byteLength: 101,
      },
    ],
    coverage: { maxGapSec: 6, maxAllowedGapSec: 8, focusedWindows: [] },
  },
};

const progressiveInput = {
  route: narratedRoute,
  contentLane: narratedLane,
  finalMaster,
  visualReview,
  timedScript: storySpine.timedScript,
  narrativeBeats: storySpine.narrativeBeats,
  continuityLedger: storySpine.continuityLedger,
  shotList: storySpine.shotList,
  dpVisualSpecs: storySpine.dpVisualSpecs,
  editorEdl: storySpine.editorEdl,
  storyCoverage: storySpine.coverage,
  sentenceTimings: storySpine.timedScript.sentences.map((sentence) => ({
    id: sentence.id,
    text: sentence.text,
    start: sentence.t0,
    end: sentence.t1,
  })),
  narrationCueTiming,
  finalMasterNarration,
};

const progressive = deriveViewerPromiseProgression(progressiveInput);
assert.equal(progressive.status, "measured", "a complete Story Spine and existing review samples are measured");
if (progressive.status !== "measured") throw new Error("expected a measured progression receipt");
const progressiveReceipt = progressive.receipt;
assert.equal(progressiveReceipt.mode, "progressive");
assert.equal(progressiveReceipt.plan.source, "story_spine");
assert.equal(progressiveReceipt.coverage.milestoneCount, 2);
assert.equal(progressiveReceipt.coverage.sampledMilestoneCount, 2);
assert.deepEqual(
  progressiveReceipt.milestones.map((milestone) => milestone.reviewFrame?.r2Key),
  visualReview.evidence.frames.map((frame) => frame.r2Key),
  "the receipt selects only already-retained frames and does not request new samples",
);
assert.deepEqual(
  deriveViewerPromiseProgression(progressiveInput),
  progressive,
  "the observation is deterministic for unchanged sealed inputs",
);

const narratedProgramRouteBinding = {
  routeFingerprint: narratedRoute.routeFingerprint,
  family: narratedRoute.family,
  contentLaneKey: narratedRoute.contentLaneKey,
  programBriefFingerprint: narratedRoute.programBriefFingerprint,
  routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(narratedRoute),
};
const durableReviewFrameArtifacts = visualReview.evidence.frames.map((frame) => ({
  id: frame.id,
  tSec: frame.tSec,
  r2Key: frame.r2Key,
  contentSha256: frame.contentSha256,
  byteLength: frame.byteLength,
}));
const { receiptFingerprint: _progressiveReceiptFingerprint, ...progressiveReceiptInput } = progressiveReceipt;
void _progressiveReceiptFingerprint;
function receiptForRouteSeed(routeSeedFingerprint: string) {
  return createViewerPromiseProgressionReceipt({
    ...progressiveReceiptInput,
    viewerPromise: {
      ...progressiveReceipt.viewerPromise,
      routeSeedFingerprint,
    },
  });
}
function assertProgressionCertificateBindingForRoute(
  sealedRoute: unknown,
  receipt = progressiveReceipt,
) {
  const parsedRoute = parseChannelProgramRouteRunSeed(sealedRoute);
  return assertViewerPromiseProgressionCertificateBinding({
    receipt,
    finalMaster,
    visualReview: {
      reviewFingerprint: visualReview.reviewFingerprint,
      reviewReceiptVersion: visualReview.reviewReceiptVersion,
      reviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
      releaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
    },
    programRoute: {
      routeFingerprint: parsedRoute.routeFingerprint,
      family: parsedRoute.family,
      contentLaneKey: parsedRoute.contentLaneKey,
      programBriefFingerprint: parsedRoute.programBriefFingerprint,
      routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(parsedRoute),
    },
    sealedRoute,
    contentLane: narratedLane,
    evidenceFrameArtifacts: durableReviewFrameArtifacts,
    finalMasterNarration,
    narrationCueTiming,
  });
}

assert.doesNotThrow(() => assertProgressionCertificateBindingForRoute(narratedRoute));
const viewerJobTamperedRoute = {
  ...narratedRoute,
  directives: {
    ...narratedRoute.directives,
    viewerJob: "A forged viewer job that changes the sealed audience promise.",
  },
};
assert.throws(
  () => assertProgressionCertificateBindingForRoute(
    viewerJobTamperedRoute,
    receiptForRouteSeed(channelProgramRouteRunSeedFingerprint(
      parseChannelProgramRouteRunSeed(viewerJobTamperedRoute),
    )),
  ),
  /sealed route directives/,
  "a certificate must recompute the viewer-job fingerprint from sealed route directives",
);
const claimModeTamperedRoute = {
  ...narratedRoute,
  directives: {
    ...narratedRoute.directives,
    claimMode: "certified_quiz_facts" as const,
  },
};
assert.throws(
  () => assertProgressionCertificateBindingForRoute(
    claimModeTamperedRoute,
    receiptForRouteSeed(channelProgramRouteRunSeedFingerprint(
      parseChannelProgramRouteRunSeed(claimModeTamperedRoute),
    )),
  ),
  /sealed route directives/,
  "a certificate must recompute claim mode from sealed route directives",
);
assert.throws(
  () => assertViewerPromiseProgressionReceipt({
    ...progressiveReceipt,
    coverage: { ...progressiveReceipt.coverage, sampledMilestoneCount: 1 },
  }),
  /sampled milestone count|fingerprint does not match/,
  "a changed coverage claim cannot retain a valid sealed receipt",
);
assert.throws(
  () => assertViewerPromiseProgressionCertificateBinding({
    receipt: progressiveReceipt,
    finalMaster,
    visualReview: {
      reviewFingerprint: visualReview.reviewFingerprint,
      reviewReceiptVersion: visualReview.reviewReceiptVersion,
      reviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
      releaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
    },
    programRoute: narratedProgramRouteBinding,
    sealedRoute: narratedRoute,
    contentLane: narratedLane,
    evidenceFrameArtifacts: [],
    finalMasterNarration,
    narrationCueTiming,
  }),
  /absent from the certificate/,
  "a receipt cannot cite a review frame that the certificate does not retain",
);

function forgedWitnessReceipt(
  reviewFramePatch: Partial<NonNullable<(typeof progressiveReceipt.milestones)[number]["reviewFrame"]>>,
) {
  return createViewerPromiseProgressionReceipt({
    ...progressiveReceiptInput,
    milestones: progressiveReceipt.milestones.map((milestone, index) =>
      index === 0 && milestone.reviewFrame
        ? {
            ...milestone,
            reviewFrame: { ...milestone.reviewFrame, ...reviewFramePatch },
          }
        : milestone,
    ),
  });
}
for (const [label, reviewFramePatch] of [
  ["timestamp", { tSec: 3.25 }],
  ["content hash", { contentSha256: "7".repeat(64) }],
  ["byte length", { byteLength: 999 }],
] as const) {
  assert.throws(
    () => assertViewerPromiseProgressionCertificateBinding({
      receipt: forgedWitnessReceipt(reviewFramePatch),
      finalMaster,
      visualReview: {
        reviewFingerprint: visualReview.reviewFingerprint,
        reviewReceiptVersion: visualReview.reviewReceiptVersion,
        reviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
        releaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
      },
      programRoute: narratedProgramRouteBinding,
      sealedRoute: narratedRoute,
      contentLane: narratedLane,
      evidenceFrameArtifacts: durableReviewFrameArtifacts,
      finalMasterNarration,
      narrationCueTiming,
    }),
    /durable visual-review witness/,
    `a same-key forged ${label} must not validate against retained visual-review evidence`,
  );
}

const staleTiming = deriveViewerPromiseProgression({
  ...progressiveInput,
  sentenceTimings: progressiveInput.sentenceTimings.map((sentence, index) =>
    index === 0 ? { ...sentence, end: sentence.end + 0.01 } : sentence,
  ),
});
assert.equal(staleTiming.status, "omitted");
if (staleTiming.status === "omitted") {
  assert.equal(staleTiming.omission.reasonCode, "narration_clock_mismatch");
}

const incompleteStory = deriveViewerPromiseProgression({
  ...progressiveInput,
  storyCoverage: undefined,
});
assert.equal(incompleteStory.status, "omitted");
if (incompleteStory.status === "omitted") {
  assert.equal(incompleteStory.omission.status, "not_measured");
  assert.equal(incompleteStory.omission.reasonCode, "incomplete_story_spine");
}

const invalidGraph = deriveViewerPromiseProgression({
  ...progressiveInput,
  episodeGraph: { version: "episode-graph/v1" },
});
assert.equal(invalidGraph.status, "omitted");
if (invalidGraph.status === "omitted") {
  assert.equal(invalidGraph.omission.status, "rejected");
  assert.equal(invalidGraph.omission.reasonCode, "episode_graph_invalid");
}

const continuousRoute = routeFor({ family: "music_loop", contentLaneKey: "music_loop" });
const continuous = deriveViewerPromiseProgression({
  route: continuousRoute,
  contentLane: {
    version: "content-lane/v1",
    key: "music_loop",
    family: "music_loop",
    primaryRenderer: "loop_clips",
  },
  finalMaster,
  visualReview,
});
assert.equal(continuous.status, "measured", "exempt visual-pacing lanes retain an honest continuous review observation");
if (continuous.status === "measured") {
  assert.equal(continuous.receipt.mode, "continuous");
  assert.equal(continuous.receipt.plan.source, "lane_visual_pacing_policy");
  assert.equal(continuous.receipt.plan.narrationClock, undefined);
  assert.equal(continuous.receipt.milestones.length, 3);
}

const invalidVisualEvidence = deriveViewerPromiseProgression({
  ...progressiveInput,
  visualReview: {
    ...visualReview,
    evidence: {
      ...visualReview.evidence,
      frames: visualReview.evidence.frames.map((frame, index) =>
        index === 0 ? { ...frame, r2Key: undefined } : frame,
      ),
    },
  },
});
assert.equal(invalidVisualEvidence.status, "omitted");
if (invalidVisualEvidence.status === "omitted") {
  assert.equal(invalidVisualEvidence.omission.status, "rejected");
  assert.equal(invalidVisualEvidence.omission.reasonCode, "visual_evidence_invalid");
}

console.log("Viewer Promise Progression tests passed");
