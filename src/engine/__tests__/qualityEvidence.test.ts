import assert from "node:assert/strict";
import {
  EpisodeSpecSchema,
  QualityEvidenceSchema,
  buildEpisodeSpec,
  buildQualityEvidence,
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
  blocksOnlyExplicitHardGateFailures();
  keepsScoresWithoutRubricsAdvisory();
  sanitizesUnsafeCountsAndRetainsTheDiagnostic();
  console.log("\nQUALITY EVIDENCE TEST PASSED");
}

main();
