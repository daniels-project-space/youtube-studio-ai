import assert from "node:assert/strict";

import {
  buildQualityEvidence,
  type SelfContainedStoryPlanEvidence,
} from "@/engine/qualityEvidence";
import {
  createSelfContainedStoryReceipt,
  type SelfContainedStoryReceipt,
} from "@/engine/selfContainedStoryReceipt";
import {
  selfContainedStoryNarrationText,
  selfContainedStoryPlanEvidenceFromReceipt,
  selfContainedStoryVisualReviewLocksFromReceipt,
} from "@/engine/selfContainedStoryQualityEvidence";
import { sha256Hex } from "@/lib/sha256";
import { planVisualReviewEvidence } from "@/lib/visualReview";
import {
  assertFinalMasterQualityEvidenceBinding,
  createFinalMasterQualityEvidenceBinding,
  finalMasterQualityEvidenceBindingFingerprint,
  type FinalMasterQualityEvidenceBinding,
} from "@/lib/finalMasterQualityEvidenceBinding";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const MASTER = { sha256: "c".repeat(64), durationSec: 120 };
const VISUAL_REVIEW = {
  reviewFingerprint: "self-contained-plan-review",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "d".repeat(64),
  releaseReceiptFingerprint: "e".repeat(64),
};

interface TestRoute {
  readonly routeFingerprint: string;
  readonly family: "whiteboard" | "comic" | "loreshort";
  readonly contentLaneKey: string;
  readonly programBriefFingerprint: string;
  readonly [key: string]: unknown;
}

function testRoute(input: {
  family: "whiteboard" | "comic" | "loreshort";
  contentLaneKey: string;
  rendererBlockId: string;
}): TestRoute {
  // This is deliberately a valid run-seed shape without registering a new
  // route. It lets the generic bridge test every receipt family while route
  // activation remains independently controlled by the program catalog.
  return {
    version: "channel-program-route-seed/v1",
    routeKey: "illustrated-explainer/foundation/v1",
    routeFingerprint: HASH_A,
    family: input.family,
    contentLaneKey: input.contentLaneKey,
    programBriefFingerprint: HASH_B,
    directives: {
      viewerJob: "Understand the visual story.",
      claimMode: "editorial_lane_policy",
      topicRules: ["Use the planned topic."],
      scriptRules: ["Preserve the approved plan."],
      criticFocus: ["Check continuity."],
    },
    requiredBlocks: [input.rendererBlockId],
    context: { locale: "en", nicheKey: "test-quality-bridge" },
  };
}

function completeQualityEvidence(input: {
  lane: { key: string; renderer: string };
  topic: string;
  plan: SelfContainedStoryPlanEvidence;
}) {
  return buildQualityEvidence({
    episode: {
      lane: input.lane,
      topic: input.topic,
      story: { plan: input.plan },
    },
    technical: { passed: true, evaluator: "render-validator", evidence: ["master streams validated"] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["durable visual evidence passed"] },
    temporal: { passed: true, evaluator: "timing-review", evidence: ["pacing policy passed"] },
    narrative: { passed: true, evaluator: "critic-review", evidence: ["critic assertions passed"] },
    audio: {
      score: 8,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["final-master audio review passed"],
    },
    brand: { passed: true, evaluator: "identity-review", evidence: ["channel grammar passed"] },
  });
}

function assertBridge(input: {
  receipt: SelfContainedStoryReceipt;
  route: TestRoute;
  topic: string;
  lane: { key: string; renderer: string };
  expectedCounts: SelfContainedStoryPlanEvidence["counts"];
}): FinalMasterQualityEvidenceBinding {
  const plan = selfContainedStoryPlanEvidenceFromReceipt({
    receipt: input.receipt,
    route: input.route,
    topic: input.topic,
    contentLaneKey: input.lane.key,
  });
  assert.deepEqual(plan.counts, input.expectedCounts, "exact family plan counts survive generic projection");
  assert.equal(plan.receiptFingerprint, input.receipt.fingerprint);
  assert.equal(plan.storyFingerprint, input.receipt.storyFingerprint);
  assert.equal(plan.routeFingerprint, input.receipt.routeFingerprint);
  assert.equal(plan.programBriefFingerprint, input.receipt.programBriefFingerprint);
  assert.equal(plan.topicFingerprint, input.receipt.topicFingerprint);
  assert.equal(plan.topic, input.topic);
  assert.equal(plan.contentLaneKey, input.lane.key);
  const expectedNarrationText = selfContainedStoryNarrationText(input.receipt);
  assert.equal(
    plan.narrationTextSha256,
    expectedNarrationText === undefined ? undefined : sha256Hex(expectedNarrationText),
    "narrated self-contained plans retain the exact approved TTS input as a sealed digest",
  );

  const evidence = completeQualityEvidence({ lane: input.lane, topic: input.topic, plan });
  assert.equal(evidence.episode.story.measurementScope, "plan");
  assert.equal(evidence.episode.story.coverageRatio, undefined, "a plan cannot claim final-master coverage");
  assert.equal(evidence.episode.story.beatCount, input.expectedCounts.beatCount);
  assert.equal(evidence.episode.story.shotCount, input.expectedCounts.shotCount);
  assert.equal(evidence.episode.story.plan?.receiptFingerprint, input.receipt.fingerprint);

  const binding = createFinalMasterQualityEvidenceBinding({
    finalMaster: MASTER,
    visualReview: VISUAL_REVIEW,
    contentLane: input.lane,
    programRoute: {
      routeFingerprint: input.route.routeFingerprint,
      family: input.route.family,
      contentLaneKey: input.route.contentLaneKey,
      programBriefFingerprint: input.route.programBriefFingerprint,
    },
    qualityEvidence: evidence,
  });
  assert.equal(binding.evidenceCoverage, "complete", "all final-QA axes remain independently complete");
  assert.equal(
    binding.storyMeasurementCoverage,
    "plan_only",
    "complete axis coverage does not upgrade a pre-render plan to final-master story coverage",
  );
  return binding;
}

function resignWithoutStoryMeasurementCoverage(
  binding: FinalMasterQualityEvidenceBinding,
): FinalMasterQualityEvidenceBinding {
  const { bindingFingerprint: _fingerprint, storyMeasurementCoverage: _coverage, ...unsigned } = binding;
  void _fingerprint;
  void _coverage;
  return {
    ...unsigned,
    bindingFingerprint: finalMasterQualityEvidenceBindingFingerprint(unsigned),
  };
}

const whiteboardTopic = "How a water clock changed a city";
const whiteboardRoute = testRoute({
  family: "whiteboard",
  contentLaneKey: "whiteboard_explainer",
  rendererBlockId: "whiteboard_scribe",
});
const whiteboard = createSelfContainedStoryReceipt({
  family: "whiteboard",
  routeFingerprint: HASH_A,
  programBriefFingerprint: HASH_B,
  topic: whiteboardTopic,
  planner: { id: "quality-bridge-fixture/v1", provenance: "provider-free test" },
  critique: { accepted: true, score: 0.94, iterations: 1, issues: [] },
  storyKind: "whiteboard-storyboard/v1",
  story: {
    title: whiteboardTopic,
    fullText: "A clock measured water. The city measured time.",
    panels: [
      {
        idx: 0,
        narration: "A clock measured water.",
        layers: [
          { kind: "art", draw: "a brass water clock", color: "black", cue: "clock", box: [0.1, 0.2, 0.3, 0.3] },
          { kind: "art", draw: "water flows", color: "red", cue: "water", box: [0.4, 0.2, 0.2, 0.2] },
        ],
      },
      {
        idx: 1,
        narration: "The city measured time.",
        layers: [
          { kind: "label", text: "Time", color: "black", cue: "time", box: [0.2, 0.5, 0.2, 0.1] },
        ],
      },
    ],
  },
});
const whiteboardBinding = assertBridge({
  receipt: whiteboard,
  route: whiteboardRoute,
  topic: whiteboardTopic,
  lane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
  expectedCounts: { beatCount: 2, shotCount: 2, panelCount: 2, artLayerCount: 3, spokenLineCount: 2 },
});
const whiteboardVisualLocks = selfContainedStoryVisualReviewLocksFromReceipt({
  receipt: whiteboard,
  route: whiteboardRoute,
  topic: whiteboardTopic,
  contentLaneKey: "whiteboard_explainer",
  narrationStartSec: 2.6,
  sentenceTimings: [
    { text: "A", start: 0, end: 0.1 },
    { text: "clock", start: 0.1, end: 0.3 },
    { text: "measured", start: 0.3, end: 0.55 },
    { text: "water", start: 0.55, end: 0.8 },
    { text: "The", start: 0.9, end: 1.0 },
    { text: "city", start: 1.0, end: 1.2 },
    { text: "measured", start: 1.2, end: 1.45 },
    { text: "time", start: 1.45, end: 1.7 },
  ],
});
assert.deepEqual(
  whiteboardVisualLocks.map((lock) => [lock.shotId, lock.startSec, lock.endSec]),
  [
    ["self-contained-whiteboard-panel-0", 2.6, 3.4],
    ["self-contained-whiteboard-panel-1", 3.5, 4.3],
  ],
  "every sealed whiteboard panel maps to an exact final-master visual-review window",
);

const comicTopic = "The observatory that heard a signal";
const comicRoute = testRoute({
  family: "comic",
  contentLaneKey: "motion_comic",
  rendererBlockId: "motion_comic",
});
const comic = createSelfContainedStoryReceipt({
  family: "comic",
  routeFingerprint: HASH_A,
  programBriefFingerprint: HASH_B,
  topic: comicTopic,
  planner: { id: "quality-bridge-fixture/v1", provenance: "provider-free test" },
  critique: { accepted: true, score: 0.95, iterations: 1, issues: [] },
  storyKind: "motion-comic-storyboard/v1",
  story: {
    title: comicTopic,
    logline: "A watcher finds a signal in an abandoned observatory.",
    narratorVoiceId: "narrator",
    characters: [],
    panels: [
      {
        visual: {
          environment: "ancient_ruins",
          era: "ancient",
          subjects: [],
          objects: ["artifact"],
          action: "watchful_pause",
          relations: [],
          mood: "mysterious",
          lighting: "moonlight",
        },
        characters: [],
        shot: "wide",
        lines: [
          { speaker: "narrator", text: "The telescope listened through the night." },
          { speaker: "narrator", text: "Then a signal answered." },
        ],
      },
      {
        visual: {
          environment: "ancient_ruins",
          era: "ancient",
          subjects: [],
          objects: ["artifact"],
          action: "discovering",
          relations: [],
          mood: "urgent",
          lighting: "interior_light",
        },
        characters: [],
        shot: "close",
        lines: [{ speaker: "narrator", text: "A hidden pattern emerged." }],
      },
    ],
  },
});
assertBridge({
  receipt: comic,
  route: comicRoute,
  topic: comicTopic,
  lane: { key: "motion_comic", renderer: "motion_comic" },
  expectedCounts: { beatCount: 2, shotCount: 2, panelCount: 2, spokenLineCount: 3, characterCount: 0 },
});
const comicVisualLocks = selfContainedStoryVisualReviewLocksFromReceipt({
  receipt: comic,
  route: comicRoute,
  topic: comicTopic,
  contentLaneKey: "motion_comic",
  narrationStartSec: 2.5,
  sentenceTimings: [
    { text: "The telescope listened through the night.", start: 0, end: 1.1 },
    { text: "Then a signal answered.", start: 1.1, end: 1.8 },
    { text: "A hidden pattern emerged.", start: 2.2, end: 3.0 },
  ],
});
assert.deepEqual(
  comicVisualLocks.map((lock) => [lock.shotId, lock.startSec, lock.endSec]),
  [
    ["self-contained-comic-panel-0", 2.5, 4.3],
    ["self-contained-comic-panel-1", 4.7, 5.5],
  ],
  "every sealed comic panel maps to an exact final-master visual-review window",
);
assert.match(
  comicVisualLocks[0]!.expected,
  /wide shot in ancient_ruins; watchful_pause/i,
  "the final-review prompt receives the sealed comic visual expectation rather than generic prose",
);
const comicReviewFrames = planVisualReviewEvidence({
  durationSec: 8,
  creativeLocks: comicVisualLocks,
  maxFrames: 16,
});
for (const lock of comicVisualLocks) {
  assert.ok(
    comicReviewFrames.some(
      (frame) => frame.tSec >= lock.startSec &&
        frame.tSec <= lock.endSec &&
        frame.selectionReasons.includes("scene"),
    ),
    `visual review must retain a plan-bound sample inside ${lock.shotId}`,
  );
}
assert.throws(
  () => selfContainedStoryVisualReviewLocksFromReceipt({
    receipt: comic,
    route: comicRoute,
    topic: comicTopic,
    contentLaneKey: "motion_comic",
    narrationStartSec: 2.5,
    sentenceTimings: [
      { text: "A replacement line.", start: 0, end: 1.1 },
      { text: "Then a signal answered.", start: 1.1, end: 1.8 },
      { text: "A hidden pattern emerged.", start: 2.2, end: 3.0 },
    ],
  }),
  /diverges from the sealed storyboard timing/i,
  "a renderer-provided timing map cannot silently substitute a sealed comic panel before visual review",
);

const loreTopic = "The archive hidden beneath the forest";
const loreRoute = testRoute({
  family: "loreshort",
  contentLaneKey: "lore_micro_doc",
  rendererBlockId: "lore_short",
});
const lore = createSelfContainedStoryReceipt({
  family: "loreshort",
  routeFingerprint: HASH_A,
  programBriefFingerprint: HASH_B,
  topic: loreTopic,
  planner: { id: "quality-bridge-fixture/v1", provenance: "provider-free test" },
  critique: { accepted: true, score: 0.93, iterations: 1, issues: [] },
  storyKind: "lore-plan/v1",
  story: {
    scenes: [
      {
        line: "Roots held the oldest records.",
        shot: "wide",
        visual: "Moonlight crosses roots and an archive door.",
        camera: "Track slowly through the roots.",
      },
      {
        line: "The door opened at dawn.",
        shot: "close",
        visual: "Dust rises from an old lock.",
        camera: "Push toward the keyhole.",
      },
    ],
  },
});
assertBridge({
  receipt: lore,
  route: loreRoute,
  topic: loreTopic,
  lane: { key: "lore_micro_doc", renderer: "lore_short" },
  expectedCounts: { beatCount: 2, shotCount: 2, sceneCount: 2, spokenLineCount: 2 },
});
assert.deepEqual(
  selfContainedStoryVisualReviewLocksFromReceipt({
    receipt: lore,
    route: loreRoute,
    topic: loreTopic,
    contentLaneKey: "lore_micro_doc",
    narrationStartSec: 0,
    sentenceTimings: undefined,
  }),
  [],
  "a non-narrated lore plan does not inherit whiteboard/comic timing requirements or a fabricated visual lock",
);

assert.throws(
  () => selfContainedStoryPlanEvidenceFromReceipt({
    receipt: whiteboard,
    route: whiteboardRoute,
    topic: "A different topic",
    contentLaneKey: "whiteboard_explainer",
  }),
  /topic fingerprint/i,
  "a sealed plan cannot cross topics at final QA",
);
assert.throws(
  () => selfContainedStoryPlanEvidenceFromReceipt({
    receipt: whiteboard,
    route: whiteboardRoute,
    topic: whiteboardTopic,
    contentLaneKey: "motion_comic",
  }),
  /content lane/i,
  "a sealed plan cannot cross content lanes at final QA",
);

assert.throws(
  () => buildQualityEvidence({
    episode: {
      lane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
      topic: whiteboardTopic,
      story: {
        plan: whiteboardBinding.qualityEvidence.episode.story.plan!,
        coverageRatio: 1,
      },
    },
  }),
  /pre-render self-contained plan evidence cannot claim final-master coverage/i,
  "callers cannot attach a coverage ratio to plan-only evidence",
);

assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding: resignWithoutStoryMeasurementCoverage(whiteboardBinding),
    finalMasterSha256: MASTER.sha256,
    finalMasterDurationSec: MASTER.durationSec,
    visualReviewFingerprint: VISUAL_REVIEW.reviewFingerprint,
    visualReviewReceiptVersion: VISUAL_REVIEW.reviewReceiptVersion,
    visualReviewReceiptFingerprint: VISUAL_REVIEW.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: VISUAL_REVIEW.releaseReceiptFingerprint,
  }),
  /cannot omit sealed plan measurement scope/i,
  "a re-signed plan binding cannot drop its plan-only marker",
);

const { bindingFingerprint: _whiteboardFingerprint, ...whiteboardUnsigned } = whiteboardBinding;
void _whiteboardFingerprint;
const routeMismatchedPlanBinding = {
  ...whiteboardUnsigned,
  programRoute: {
    ...whiteboardUnsigned.programRoute!,
    routeFingerprint: "f".repeat(64),
  },
};
assert.throws(
  () => assertFinalMasterQualityEvidenceBinding({
    binding: {
      ...routeMismatchedPlanBinding,
      bindingFingerprint: finalMasterQualityEvidenceBindingFingerprint(routeMismatchedPlanBinding),
    },
    finalMasterSha256: MASTER.sha256,
    finalMasterDurationSec: MASTER.durationSec,
    visualReviewFingerprint: VISUAL_REVIEW.reviewFingerprint,
    visualReviewReceiptVersion: VISUAL_REVIEW.reviewReceiptVersion,
    visualReviewReceiptFingerprint: VISUAL_REVIEW.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: VISUAL_REVIEW.releaseReceiptFingerprint,
  }),
  /route does not match its sealed plan evidence/i,
  "a re-signed plan binding cannot cross frozen routes",
);

const legacyEvidence = buildQualityEvidence({
  episode: { lane: { key: "motion_comic", renderer: "motion_comic" }, topic: "A legacy run" },
});
assert.equal(legacyEvidence.episode.story.plan, undefined, "no-receipt behavior remains unchanged");
assert.equal(legacyEvidence.episode.story.measurementScope, undefined, "legacy receipts retain no invented scope");
const legacyBinding = createFinalMasterQualityEvidenceBinding({
  finalMaster: MASTER,
  visualReview: VISUAL_REVIEW,
  contentLane: { key: "motion_comic", renderer: "motion_comic" },
  qualityEvidence: legacyEvidence,
});
assert.equal(legacyBinding.storyMeasurementCoverage, "unmeasured");
assert.doesNotThrow(
  () => assertFinalMasterQualityEvidenceBinding({
    binding: resignWithoutStoryMeasurementCoverage(legacyBinding),
    finalMasterSha256: MASTER.sha256,
    finalMasterDurationSec: MASTER.durationSec,
    visualReviewFingerprint: VISUAL_REVIEW.reviewFingerprint,
    visualReviewReceiptVersion: VISUAL_REVIEW.reviewReceiptVersion,
    visualReviewReceiptFingerprint: VISUAL_REVIEW.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: VISUAL_REVIEW.releaseReceiptFingerprint,
  }),
  "historical no-plan bindings without the new optional marker remain readable",
);

console.log("self-contained story quality-evidence bridge tests passed");
