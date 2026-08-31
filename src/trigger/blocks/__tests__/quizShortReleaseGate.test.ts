import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  assertChannelProgramRoutePipelineCompatibility,
  channelProgramRouteRunSeedFingerprint,
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
  resolveSupervisedChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { contentLaneForFamily } from "@/engine/contentLane";
import {
  designPipeline,
  enforceLengthContract,
  QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE,
} from "@/engine/designer";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { compilePipeline, PipelinePolicyError, type PipelinePolicy } from "@/engine/pipelineCompiler";
import type { PipelineEntry } from "@/engine/types";
import type { ResolvedPipeline } from "@/engine/validate";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  createShortsOpeningEvidence,
  planShortsOpeningOnScreenTextEvidence,
} from "@/engine/shortsOpeningEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import {
  ON_SCREEN_TEXT_PROOF_VERSION,
  TESSERACT_LANGUAGE,
  TESSERACT_PAGE_SEGMENTATION_MODE,
  type OnScreenTextProof,
} from "@/lib/onScreenTextProof";
import { quizCitationLabel } from "@/lib/quizCitation";
import { VISUAL_REVIEW_VERSION, type VisualReviewResult } from "@/lib/visualReview";
import { quizTopicPlanFingerprint } from "@/trigger/blocks/quizPlanningBlocks";
import {
  assertQuizShortReleaseReceiptForUpload,
  createQuizShortReleaseReceipt,
} from "@/trigger/blocks/quizShortReleaseBlocks";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const masterSha256 = "a".repeat(64);
const videoKey = "owner/alice/runs/quiz-short/quiz-short.mp4";
const durationSec = 40;

const brief = createChannelProgramBrief({
  family: "quizyear",
  nicheKey: "educational",
  locale: "en",
  concept: "Private portrait trivia drafts with sourced factual answers.",
  programIntent: { kind: "quiz_short", profile: "world_geography" },
});

assert.throws(
  () => resolveChannelProgramRoute(brief),
  /supervised private-draft route/,
  "QuizShort must never enter the automatic channel-program resolver",
);
const route = resolveSupervisedChannelProgramRoute(brief);
const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
assert.equal(route.routeKey, "quizyear/portrait-supervised/v1");
assert.equal(route.admission, "supervised_private");
assert.ok(route.requiredBlocks.includes("quiz_short_release"));
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  programBrief: brief,
  programRoute: route,
});
assert.equal(design.productionReady, false, "a supervised route must not advertise autonomous production readiness");
assert.deepEqual(
  design.pipeline.find((entry) => entry.block === "length_check")?.params,
  { minSeconds: 35, maxSeconds: 60 },
  "the supervised portrait envelope must not inherit QuizYear's long-form length check",
);
const repinnedPortraitDesign = enforceLengthContract(
  design.pipeline.map((entry) => entry.block === "length_check"
    ? { ...entry, params: { minSeconds: 80, maxSeconds: 80 } }
    : entry),
  design.episodeLengthSeconds,
  "quizyear",
  { lengthEnvelope: QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE },
);
assert.deepEqual(
  repinnedPortraitDesign.pipeline.find((entry) => entry.block === "length_check")?.params,
  { minSeconds: 35, maxSeconds: 60 },
  "a later architecture/inception length pass must retain the sealed portrait envelope",
);
assert.equal(design.pipeline.find((entry) => entry.block === "quiz_year")?.params?.presentation, "portrait_supervised");
assert.equal(design.pipeline.find((entry) => entry.block === "qa_visual")?.params?.audioQa, true);
assert.equal(design.pipeline.find((entry) => entry.block === "qa_visual")?.params?.qaProfile, "production");
assert.equal(design.pipeline.find((entry) => entry.block === "upload_draft")?.params?.publishMode, "draft");
assert.ok(
  design.pipeline.findIndex((entry) => entry.block === "qa_visual") <
    design.pipeline.findIndex((entry) => entry.block === "quiz_short_release") &&
    design.pipeline.findIndex((entry) => entry.block === "quiz_short_release") <
    design.pipeline.findIndex((entry) => entry.block === "upload_draft"),
  "the private-release receipt must follow shared final QA and precede the upload boundary",
);
assertChannelProgramRoutePipelineCompatibility({
  route,
  programBrief: brief,
  pipeline: design.pipeline,
});
assert.ok(
  design.compilation?.capabilities.includes("publish.private_only"),
  "the supervised route must carry the compiler-level private-only capability",
);

registerAllBlocks();
const minimalPrivateOnlyPolicy: PipelinePolicy = {
  id: "quiz-short-private-only-test",
  version: "1",
  minimumCertification: "contract",
  requiredCapabilities: [],
  requireCrewBindings: false,
  requireStoryAlignmentForGeneratedVisuals: false,
  allowOpaqueMigrationArtifacts: true,
};
const resolvedFrom = (entries: PipelineEntry[]): ResolvedPipeline => {
  const manifests = entries.map((entry) => {
    const manifest = getManifest(entry.block);
    if (!manifest) throw new Error(`missing registered block ${entry.block}`);
    return manifest;
  });
  return { blocks: manifests.map((manifest) => manifest.block), manifests, entries, producedKeys: [] };
};
assert.throws(
  () => compilePipeline(resolvedFrom([
    { block: "quiz_short_release" },
    { block: "upload_draft", params: { publishMode: "public", approvedForPublish: true } },
  ]), minimalPrivateOnlyPolicy),
  (error: unknown) => error instanceof PipelinePolicyError && error.message.includes("publish.private_only"),
  "the compiler must reject a public upload even if a caller bypasses the designer",
);
assert.doesNotThrow(() => compilePipeline(resolvedFrom([
  { block: "quiz_short_release" },
  { block: "upload_draft", params: { publishMode: "draft" } },
]), minimalPrivateOnlyPolicy));

const lane = contentLaneForFamily("quizyear");
assert(lane, "QuizYear must retain its locked content lane");

const plan = {
  version: "quiz-curated-wikidata-planner/v1" as const,
  profileKey: "world_geography" as const,
  topicKey: "landmark_architecture" as const,
  topic: "World Geography Trivia Challenge #1",
  episodeOrdinal: 1,
  memoryKey: "quiz-topic/v1/run-quiz-short/landmark_architecture/1",
  provenance: {
    registry: "quiz-year-topics/v1" as const,
    sourceLicense: "Wikidata CC0-1.0" as const,
    selection: "operator-pinned curated topic" as const,
    previousEpisodesForTopic: 0,
  },
};
const safety = {
  version: "quiz-topic-safety/v1" as const,
  planFingerprint: quizTopicPlanFingerprint(plan),
  topicKey: plan.topicKey,
  topic: plan.topic,
  sensitiveTopic: false as const,
  disclosureRequired: false as const,
};

const rounds = [
  ["Which city is the capital of France?", "Paris", "https://www.wikidata.org/wiki/Q90"],
  ["Which city is the capital of Japan?", "Tokyo", "https://www.wikidata.org/wiki/Q1490"],
  ["Which city is the capital of Canada?", "Ottawa", "https://www.wikidata.org/wiki/Q1930"],
].map(([questionText, answer, sourceUrl]) => ({
  questionText,
  subject: answer,
  sourceUrl,
  countdownSeconds: 6,
  revealSeconds: 4,
  options: [
    { label: answer, isCorrect: true },
    { label: "Rome", isCorrect: false },
    { label: "Madrid", isCorrect: false },
    { label: "Lisbon", isCorrect: false },
  ],
}));

const openingHook = {
  version: "quiz-short-opening-hook/v1" as const,
  cueId: "quiz-short-opening-hook" as const,
  startSec: 2.5,
  endSec: 7.8,
  sampleSec: 4,
  expectedText: rounds[0].questionText,
};
const onScreenTextCues = [
  {
    id: openingHook.cueId,
    sampleSec: openingHook.sampleSec,
    expectedText: openingHook.expectedText,
    minTokenCoverage: 0.8,
  },
  ...rounds.map((round, index) => ({
    id: `quiz-round-${String(index + 1).padStart(2, "0")}-reveal-source`,
    sampleSec: 9 + index * 10,
    expectedText: `source ${quizCitationLabel(round.sourceUrl)}`,
    minTokenCoverage: 0.8,
  })),
];

const onScreenText: OnScreenTextProof = {
  version: ON_SCREEN_TEXT_PROOF_VERSION,
  engine: {
    name: "tesseract",
    version: "5.4.0",
    language: TESSERACT_LANGUAGE,
    pageSegmentationMode: TESSERACT_PAGE_SEGMENTATION_MODE,
  },
  source: { sha256: masterSha256, byteLength: 1_024 },
  cues: onScreenTextCues.map((cue) => ({
    id: cue.id,
    sampleSec: cue.sampleSec,
    expectedTextSha256: hash(cue.expectedText),
    expectedTokenCount: Math.max(1, cue.expectedText.trim().split(/\s+/u).length),
    recognizedText: cue.expectedText,
    recognizedTokenCount: Math.max(1, cue.expectedText.trim().split(/\s+/u).length),
    tokenCoverage: 1,
    minTokenCoverage: cue.minTokenCoverage,
    passed: true,
  })),
  passed: true,
};

const review: Pick<
  VisualReviewResult,
  "ran" | "verdict" | "referenceCriteriaComplete" | "evidence" |
    "reviewFingerprint" | "reviewReceiptVersion" | "reviewReceiptFingerprint" | "sceneChangeTimes"
> = {
  ran: true,
  verdict: "pass",
  referenceCriteriaComplete: true,
  evidence: {
    version: VISUAL_REVIEW_VERSION,
    source: { sha256: masterSha256, durationSec },
    frames: [
      {
        id: "opening-overlay",
        tSec: 3,
        r2Key: "owner/alice/runs/quiz-short/visual-review/frames/opening-overlay.jpg",
        contentSha256: "b".repeat(64),
        byteLength: 101,
        selectionReasons: ["overlay"],
      },
      {
        id: "first-motion",
        tSec: 5,
        r2Key: "owner/alice/runs/quiz-short/visual-review/frames/first-motion.jpg",
        contentSha256: "c".repeat(64),
        byteLength: 102,
        selectionReasons: ["scene"],
      },
    ],
    coverage: { maxGapSec: 1, maxAllowedGapSec: 1, focusedWindows: [] },
  },
  reviewFingerprint: "quiz-short-review",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "d".repeat(64),
  sceneChangeTimes: [5],
};

const openingEvidence = createShortsOpeningEvidence({
  finalMaster: { sha256: masterSha256, durationSec },
  review,
  visualReviewReleaseReceiptFingerprint: "e".repeat(64),
  openingText: planShortsOpeningOnScreenTextEvidence({
    cueId: openingHook.cueId,
    startSec: openingHook.startSec,
    endSec: openingHook.endSec,
    expectedText: openingHook.expectedText,
    durationSec,
    source: "on_screen_hook",
  }),
  onScreenText,
});

const qualityEvidence = buildQualityEvidence({
  episode: { lane: { key: lane.key, renderer: lane.primaryRenderer }, topic: plan.topic },
  technical: { passed: true, evaluator: "final-master structural QA", evidence: ["1080x1920 MP4 with audio"] },
  visual: { passed: true, evaluator: "final visual review", evidence: ["durable review frame set passed"] },
  temporal: { passed: true, evaluator: "short timing QA", evidence: ["portrait timing passed"] },
  narrative: { passed: true, evaluator: "quiz wording QA", evidence: ["certified question set passed"] },
  audio: { score: 8, minimumScore: 5, evaluator: "audio aesthetics grader", evidence: ["final-master audio passed"] },
  brand: { passed: true, evaluator: "channel grammar QA", evidence: ["brand presentation passed"] },
});
const qualityBinding = createFinalMasterQualityEvidenceBinding({
  finalMaster: { sha256: masterSha256, durationSec },
  visualReview: {
    reviewFingerprint: review.reviewFingerprint,
    reviewReceiptVersion: review.reviewReceiptVersion,
    reviewReceiptFingerprint: review.reviewReceiptFingerprint,
    releaseReceiptFingerprint: "e".repeat(64),
  },
  contentLane: { key: lane.key, renderer: lane.primaryRenderer },
  programRoute: {
    routeFingerprint: seed.routeFingerprint,
    family: seed.family,
    contentLaneKey: seed.contentLaneKey,
    programBriefFingerprint: seed.programBriefFingerprint,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(seed),
  },
  qualityEvidence,
});

const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: { r2Key: videoKey, sha256: masterSha256, byteLength: 4_096, durationSec },
  visualReview: {
    evidenceManifestKey: "owner/alice/runs/quiz-short/visual-review/manifest.json",
    evidenceFrameKeys: review.evidence.frames.map((frame) => frame.r2Key!),
    evidenceFrameArtifacts: review.evidence.frames.map((frame) => ({
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key!,
      contentSha256: frame.contentSha256!,
      byteLength: frame.byteLength!,
    })),
    receiptKey: "owner/alice/runs/quiz-short/visual-review/receipts/review.json",
    reviewFingerprint: review.reviewFingerprint,
    reviewReceiptVersion: review.reviewReceiptVersion,
    reviewReceiptFingerprint: review.reviewReceiptFingerprint,
    releaseReceiptFingerprint: "e".repeat(64),
  },
  qualityEvidence: qualityBinding,
  onScreenText,
  shortsOpeningEvidence: openingEvidence,
});

const qaReport = {
  structural: { ok: true, durationSec, width: 1080, height: 1920 },
  watch: { ran: true, verdict: "pass" },
};

const releaseReceipt = createQuizShortReleaseReceipt({
  route: seed,
  contentLane: lane,
  plan,
  safety,
  rounds,
  onScreenTextCues,
  openingHook,
  qaReport,
  videoKey,
  videoDurationSec: durationSec,
  certificate,
});
assert.equal(releaseReceipt.allowedPublishMode, "draft");
assert.equal(releaseReceipt.factSourceCount, 3);
assert.equal(releaseReceipt.openingEvidenceFingerprint, openingEvidence.receiptFingerprint);

assert.doesNotThrow(() => assertQuizShortReleaseReceiptForUpload({
  receipt: releaseReceipt,
  route: seed,
  certificate,
  videoKey,
  publishMode: "draft",
}));
assert.throws(
  () => assertQuizShortReleaseReceiptForUpload({
    receipt: releaseReceipt,
    route: seed,
    certificate,
    videoKey,
    publishMode: "public",
  }),
  /only create a private draft/,
  "a checked private receipt cannot become a public release by changing upload params",
);
assert.throws(
  () => createQuizShortReleaseReceipt({
    route: seed,
    contentLane: lane,
    plan,
    safety,
    rounds,
    onScreenTextCues: onScreenTextCues.filter((cue) => cue.id !== "quiz-round-02-reveal-source"),
    openingHook,
    qaReport,
    videoKey,
    videoDurationSec: durationSec,
    certificate,
  }),
  /timed text cue/,
  "every certified source must retain its final-master citation cue",
);
assert.throws(
  () => createQuizShortReleaseReceipt({
    route: seed,
    contentLane: lane,
    plan,
    safety,
    rounds,
    onScreenTextCues,
    openingHook: { ...openingHook, expectedText: "Forged opening" },
    qaReport,
    videoKey,
    videoDurationSec: durationSec,
    certificate,
  }),
  /opening hook.*first certified question/,
  "the opening OCR authority must be the actual first question, not a generic claim",
);
assert.throws(
  () => createQuizShortReleaseReceipt({
    route: seed,
    contentLane: lane,
    plan,
    safety,
    rounds,
    onScreenTextCues,
    openingHook,
    qaReport: { ...qaReport, structural: { ...qaReport.structural, width: 1920, height: 1080 } },
    videoKey,
    videoDurationSec: durationSec,
    certificate,
  }),
  /1080x1920 portrait master/,
  "landscape QA cannot impersonate the portrait QuizShort renderer",
);
assert.throws(
  () => createQuizShortReleaseReceipt({
    route: { ...seed, admission: "automatic" },
    contentLane: lane,
    plan,
    safety,
    rounds,
    onScreenTextCues,
    openingHook,
    qaReport,
    videoKey,
    videoDurationSec: durationSec,
    certificate,
  }),
  /supervised QuizShort route/,
  "a forged automatic admission must not inherit the private release gate",
);

console.log("QuizShort supervised release gate tests passed");
