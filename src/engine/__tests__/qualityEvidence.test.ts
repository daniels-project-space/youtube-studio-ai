import assert from "node:assert/strict";
import { CONTENT_LANE_POLICIES } from "@/engine/contentLane";
import {
  EpisodeSpecSchema,
  FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
  QualityEvidenceSchema,
  VALIDATED_STORY_SPINE_SOURCE,
  assessProductionEditorialAcceptance,
  buildEpisodeSpec,
  buildQualityEvidence,
  hasProductionEditorialPolicy,
} from "@/engine/qualityEvidence";

function assertCondition(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
  console.log(`  ✓ ${message}`);
}

function recordsMeasuredEvidenceWithoutOverclaiming(): void {
  const receipt = buildQualityEvidence({
    episode: {
      lane: { key: "whiteboard_explainer", renderer: "whiteboard_scribe" },
      topic: "How compound interest works",
      title: "Compound Interest, Visualized",
      durationSec: 182,
      story: {
        source: "story_spine",
        beatCount: 8,
        shotCount: 24,
        coverageRatio: 1,
      },
      candidateSelection: {
        generated: 8,
        selected: 2,
        rejected: 6,
        evidence: ["Asset grader selected the two highest-scoring candidates."],
      },
      repairs: {
        attempted: 2,
        succeeded: 2,
        failed: 0,
        evidence: ["Two visual defects were repaired and rechecked."],
      },
    },
    technical: { passed: true, evaluator: "render-validator", evidence: ["No black frames or dead air."] },
    visual: { score: 8.1, minimumScore: 6.5, evaluator: "visual-grader", evidence: ["Frames are clear and on-brief."] },
    temporal: { passed: true, evaluator: "shot-qa", evidence: ["All qualified shots met continuity threshold."] },
    narrative: { passed: true, evaluator: "story-validator", evidence: ["Every beat maps to the script." ] },
    audio: { score: 8.3, minimumScore: 7, evaluator: "audio-aesthetics", evidence: ["Music timing and mix met rubric."] },
    brand: { passed: true, evaluator: "style-grader", evidence: ["Whiteboard style lock remained intact."] },
    requiredAudio: { required: true, minimumScore: 7, label: "audio aesthetics" },
  });

  assert.doesNotThrow(() => QualityEvidenceSchema.parse(receipt));
  assert.equal(receipt.release.hardGateReady, true);
  assert.equal(receipt.release.calibrationComplete, true);
  assert.equal(receipt.axes.visual.status, "pass");
  assert.equal(receipt.axes.audio.status, "pass");
  assert.equal(receipt.episode.candidateSelection?.selected, 2);
  assert.equal(receipt.episode.repairs?.succeeded, 2);
  assertCondition(
    receipt.episode.lane.renderer === "whiteboard_scribe",
    "a measured receipt preserves the channel's renderer lane",
  );
  assertCondition(
    receipt.release.calibrationComplete,
    "a complete evaluator set is explicitly distinguishable from a merely passing hard gate",
  );
  assert.equal(assessProductionEditorialAcceptance(receipt).ready, true);
}

function requiresConcreteFinalMasterStoryMeasurement(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "narrated_documentary" }, topic: "A measured archive" },
  });
  const missingSource = {
    ...receipt,
    episode: {
      ...receipt.episode,
      story: { status: "measured" as const, measurementScope: "final_master" as const },
    },
  };
  assert.throws(
    () => QualityEvidenceSchema.parse(missingSource),
    /final-master story measurement requires a source/,
  );
  const missingCoverage = {
    ...receipt,
    episode: {
      ...receipt.episode,
      story: {
        status: "measured" as const,
        measurementScope: "final_master" as const,
        source: "final-master-story-audit/v1",
      },
    },
  };
  assert.throws(
    () => QualityEvidenceSchema.parse(missingCoverage),
    /final-master story measurement requires a coverage ratio/,
  );
  assert.doesNotThrow(() => QualityEvidenceSchema.parse({
    ...receipt,
    episode: {
      ...receipt.episode,
      story: {
        status: "measured",
        measurementScope: "final_master",
        source: "final-master-story-audit/v1",
        coverageRatio: 0.75,
      },
    },
  }));
  assertCondition(
    true,
    "a final-master story scope requires concrete source and coverage evidence",
  );
}

function blocksOnlyExplicitHardGateFailures(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "music_loop" }, topic: "Late-night lofi loop" },
    technical: { passed: false, evaluator: "render-validator", evidence: ["Detected black frames."] },
    visual: { score: 5.4, minimumScore: 6, evaluator: "visual-grader", evidence: ["Visual clarity below rubric."] },
    audio: { evaluator: "audio-aesthetics", evidence: ["Audio evaluator was unavailable before scoring."] },
    requiredAudio: { required: true, minimumScore: 7 },
  });

  assert.equal(receipt.release.hardGateReady, false);
  assert.deepEqual(receipt.release.blockers, [
    "technical evaluator explicitly failed",
    "visual score 5.40 is below required threshold 6.00",
    "audio score is missing for a lane that requires audio quality",
  ]);
  assert.equal(receipt.axes.temporal.status, "not_measured");
  assertCondition(
    receipt.calibrationGaps.some((gap) => gap.startsWith("temporal: no evaluator evidence")),
    "missing temporal evidence remains a calibration gap instead of a hidden pass",
  );
}

function productionVisualScoreFloorBlocksAnOtherwisePassingReview(): void {
  const base = {
    episode: { lane: { key: "short_form" }, topic: "A focused visual hook" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Structural validation passed."] },
    visual: {
      passed: true,
      evaluator: "scene/cue-aware evidence-backed visual review",
      evidence: ["The final review returned no categorical defects."],
    },
  };
  const belowFloor = buildQualityEvidence({
    ...base,
    visual: { ...base.visual, score: 6.9, minimumScore: 7 },
  });
  assert.equal(
    belowFloor.release.hardGateReady,
    false,
    "an otherwise-passing final review cannot release below its lane visual floor",
  );
  assert(
    belowFloor.release.blockers.some((blocker) => blocker.includes("visual score 6.90 is below required threshold 7.00")),
    "the failed broad visual score must be an explicit release blocker",
  );

  const meetingFloor = buildQualityEvidence({
    ...base,
    visual: { ...base.visual, score: 7, minimumScore: 7 },
  });
  assert.equal(
    meetingFloor.release.hardGateReady,
    true,
    "an otherwise-passing final review at the lane floor remains eligible for release",
  );
}

function keepsScoresWithoutRubricsAdvisory(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "narrated_documentary" }, topic: "The history of canal locks" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Structural validation passed."] },
    visual: { score: 9.2, evaluator: "visual-grader", evidence: ["Strong composition observed."] },
  });

  assert.equal(receipt.axes.visual.status, "advisory");
  assert.equal(receipt.release.hardGateReady, true);
  assert.equal(receipt.release.calibrationComplete, false);
  assertCondition(
    receipt.calibrationGaps.includes("visual: score is present but no acceptance threshold was supplied."),
    "a score without a rubric cannot be represented as a release-grade visual pass",
  );
}

function rejectsPartialReceiptAtProductionEditorialBoundary(): void {
  const receipt = buildQualityEvidence({
    episode: {
      lane: { key: "narrated_documentary", renderer: "stock_footage" },
      topic: "Why locks made canal trade reliable",
    },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["Chronological review passed."] },
    temporal: { passed: true, evaluator: "timing-review", evidence: ["No pacing defect detected."] },
    audio: { passed: true, evaluator: "loudness-meter", evidence: ["Integrated loudness is measurable."] },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["Identity lock is visible."] },
  });

  // Keep the raw receipt contract stable: absent editorial evidence is not
  // silently converted into an unrelated hard-gate failure.
  assert.equal(receipt.release.hardGateReady, true);
  const editorial = assessProductionEditorialAcceptance(receipt);
  assert.equal(editorial.ready, false);
  assertCondition(
    editorial.blockers.some((blocker) => blocker.includes("narrative evidence")),
    "production requires a passing narrative evaluator",
  );
  assertCondition(
    editorial.blockers.some((blocker) => blocker.includes("story evidence was not measured")),
    "story-spine lanes require durable story provenance",
  );
  assertCondition(
    editorial.blockers.some((blocker) => blocker.includes("audio-aesthetics")),
    "narrated lanes require a scored final-master audio review, not loudness alone",
  );
}

function requiresAestheticAudioForAudioFirstLanes(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "music_loop", renderer: "loop_clips" }, topic: "Rainy-night study loop" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["Chronological review passed."] },
    temporal: { passed: true, evaluator: "loop-review", evidence: ["Loop seam is clean."] },
    audio: {
      score: 8.1,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["Narration, effects, and music passed the final-master quality score."],
    },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["Identity lock is visible."] },
  });

  const editorial = assessProductionEditorialAcceptance(receipt);
  assert.equal(
    editorial.ready,
    true,
    "a scored aesthetics review must satisfy the audio-first lane rather than be mistaken for a loudness-only proxy",
  );
}

function requiresDurableNarratedStoryCoverageForStorySpinePlans(): void {
  const base = {
    episode: { lane: { key: "narrated_documentary" }, topic: "A measured archive" },
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
  };
  const planOnly = buildQualityEvidence({
    ...base,
    episode: {
      ...base.episode,
      story: {
        source: VALIDATED_STORY_SPINE_SOURCE,
        beatCount: 2,
        shotCount: 2,
        coverageRatio: 1,
      },
    },
  });
  const blocked = assessProductionEditorialAcceptance(planOnly);
  assert.equal(blocked.ready, false);
  assertCondition(
    blocked.blockers.some((blocker) => blocker.includes("measured against the final master")),
    "an otherwise passing Story-Spine plan receipt cannot certify production release before final-master narration coverage",
  );

  const measured = buildQualityEvidence({
    ...base,
    episode: {
      ...base.episode,
      story: {
        source: FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
        beatCount: 2,
        shotCount: 2,
        coverageRatio: 1,
        measurementScope: "final_master",
        measurementKind: "narration_semantic",
        finalMasterNarratedStoryReceiptFingerprint: "a".repeat(64),
      },
    },
  });
  assert.equal(
    assessProductionEditorialAcceptance(measured).ready,
    true,
    "a sealed final-master narration-semantic Story-Spine receipt satisfies the editorial policy",
  );
}

function acceptsWordlessAmbientWithoutNarrativeOrStoryReceipt(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "ambient_guided", renderer: "stock_footage" }, topic: "Wordless ocean sleep soundscape" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["Chronological review passed."] },
    temporal: { passed: true, evaluator: "pace-review", evidence: ["Slow visual cadence remains stable."] },
    audio: {
      score: 8.2,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["Production-quality score passed across sampled windows."],
    },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["Calm channel grammar remains intact."] },
    requiredAudio: { required: true, minimumScore: 7, label: "ambient audio aesthetics" },
  });

  assert.equal(
    assessProductionEditorialAcceptance(receipt).ready,
    true,
    "wordless ambient lanes use their own audio/visual editorial grammar",
  );
}

function selfContainedLaneDoesNotRequireSharedStoryReceipt(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "motion_comic", renderer: "motion_comic" }, topic: "A comic retelling of the canal age" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["Panel review passed."] },
    temporal: { passed: true, evaluator: "panel-timing-review", evidence: ["Panel reveals match the voice beat." ] },
    narrative: { passed: true, evaluator: "critic validation specification", evidence: ["All story assertions passed."] },
    audio: {
      score: 8.1,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["Final-master production-quality score passed."],
    },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["Panel style lock is intact."] },
  });

  assert.equal(
    assessProductionEditorialAcceptance(receipt).ready,
    true,
    "self-contained engines rely on their real critic evidence instead of a nonexistent shared story receipt",
  );
}

function rejectsLegacyReceiptAtProductionEditorialBoundary(): void {
  const receipt = buildQualityEvidence({
    episode: { lane: { key: "legacy_unclassified" }, topic: "Legacy run" },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Container and streams are valid."] },
    visual: { passed: true, evaluator: "visual-review", evidence: ["Chronological review passed."] },
    temporal: { passed: true, evaluator: "timing-review", evidence: ["No pacing defect detected."] },
    narrative: { passed: true, evaluator: "story-review", evidence: ["Story review passed."] },
    audio: { passed: true, evaluator: "loudness-meter", evidence: ["Integrated loudness is measurable."] },
    brand: { passed: true, evaluator: "identity-grader", evidence: ["Identity lock is visible."] },
  });

  const editorial = assessProductionEditorialAcceptance(receipt);
  assert.equal(editorial.ready, false);
  assertCondition(
    editorial.blockers.some((blocker) => blocker.includes("no production editorial acceptance policy")),
    "legacy receipts fail closed at upload until migrated",
  );
}

function keepsEditorialPolicyCoverageInLockstepWithProductionLanes(): void {
  for (const lane of Object.values(CONTENT_LANE_POLICIES)) {
    const isPrivateSupervisedChildLane = lane.key === "children_learning_supervised";
    const shouldHaveReleasePolicy = lane.key !== "legacy_unclassified" && !isPrivateSupervisedChildLane;
    assert.equal(
      hasProductionEditorialPolicy(lane.key),
      shouldHaveReleasePolicy,
      `${lane.key} must ${shouldHaveReleasePolicy ? "have" : "not claim"} a normal production editorial release policy`,
    );
  }
}

function sanitizesUnsafeCountsAndRetainsTheDiagnostic(): void {
  const episode = buildEpisodeSpec({
    lane: { key: "motion_comic" },
    topic: "A failed candidate receipt",
    candidateSelection: { generated: 2, selected: 3, rejected: 2 },
    repairs: { attempted: 1, succeeded: 2, failed: 1 },
  });
  assert.doesNotThrow(() => EpisodeSpecSchema.parse(episode));
  assert.equal(episode.candidateSelection?.generated, 2);
  assert.equal(episode.candidateSelection?.selected, undefined);
  assert.equal(episode.repairs?.succeeded, undefined);

  const receipt = buildQualityEvidence({
    episode: {
      lane: { key: "motion_comic" },
      topic: "A failed candidate receipt",
      candidateSelection: { generated: 2, selected: 3, rejected: 2 },
      repairs: { attempted: 1, succeeded: 2, failed: 1 },
    },
  });
  assertCondition(
    receipt.calibrationGaps.some((gap) => gap.startsWith("candidate selection: selected count exceeds")),
    "contradictory candidate counts are omitted and recorded as calibration gaps",
  );
  assertCondition(
    receipt.calibrationGaps.some((gap) => gap.startsWith("repairs: successful count exceeds")),
    "contradictory repair counts are omitted and recorded as calibration gaps",
  );
}

function main(): void {
  recordsMeasuredEvidenceWithoutOverclaiming();
  requiresConcreteFinalMasterStoryMeasurement();
  blocksOnlyExplicitHardGateFailures();
  productionVisualScoreFloorBlocksAnOtherwisePassingReview();
  keepsScoresWithoutRubricsAdvisory();
  rejectsPartialReceiptAtProductionEditorialBoundary();
  requiresAestheticAudioForAudioFirstLanes();
  requiresDurableNarratedStoryCoverageForStorySpinePlans();
  acceptsWordlessAmbientWithoutNarrativeOrStoryReceipt();
  selfContainedLaneDoesNotRequireSharedStoryReceipt();
  rejectsLegacyReceiptAtProductionEditorialBoundary();
  keepsEditorialPolicyCoverageInLockstepWithProductionLanes();
  sanitizesUnsafeCountsAndRetainsTheDiagnostic();
  console.log("\nQUALITY EVIDENCE TEST PASSED");
}

main();
