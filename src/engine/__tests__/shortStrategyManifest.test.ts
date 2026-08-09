import assert from "node:assert/strict";
import {
  REQUIRED_SHORT_QA_CHECKS,
  SHORT_STRATEGY_MANIFEST_VERSION,
  createDirectShortStrategyManifest,
  createDocumentarySpinoffStrategyManifest,
  createShortCandidateSelection,
  isDocumentarySpinoff,
  rankShortCandidates,
  renderOrderedShortBeats,
  scoreShortCandidate,
  selectedShortCandidate,
  shortRenderDurationSec,
  validateShortStrategyManifest,
} from "@/engine/shortStrategyManifest";

function candidateScore(seed: number) {
  return {
    hookStrength: seed,
    selfContainment: seed,
    factualClarity: seed,
    visualPotential: seed,
    novelty: seed,
    completionPotential: seed,
  };
}

function makeInput() {
  const beatIds = ["beat_1", "beat_2", "beat_3", "beat_4", "beat_5"];
  return {
    strategy: {
      shortId: "short_001",
      channelId: "channel_docs",
      headline: "The decision that changed the project",
      premise: "One decision turned a quiet design problem into a durable public record.",
      targetDurationSec: 25,
      aspectRatio: "9:16" as const,
      treatmentPreset: "archival_investigative",
    },
    sources: [
      {
        id: "source_archive",
        type: "archive" as const,
        title: "Project archive",
        citation: "Project archive, 1974 decision memorandum.",
        url: "https://example.com/archive",
      },
    ],
    claims: beatIds.map((_, index) => ({
      id: `claim_${index + 1}`,
      kind: "fact" as const,
      text: `Source-backed claim ${index + 1}.`,
      sourceIds: ["source_archive"],
      evidence: [{
        sourceId: "source_archive",
        excerpt: `Archive excerpt supporting claim ${index + 1}.`,
        locator: `folio ${index + 1}`,
      }],
    })),
    assets: [
      {
        id: "asset_photo",
        kind: "image" as const,
        description: "Licensed archival photograph.",
        provenance: {
          license: "licensed" as const,
          sourceId: "source_archive",
          licenseUrl: "https://example.com/license",
        },
        claimIds: ["claim_1", "claim_2", "claim_3", "claim_4", "claim_5"],
      },
      {
        id: "asset_music",
        kind: "audio" as const,
        description: "Owned tension music bed.",
        provenance: {
          license: "owned" as const,
          attribution: "Channel-owned composition.",
        },
      },
    ],
    beats: beatIds.map((id, index) => ({
      id,
      order: index + 1,
      role: ["hook", "context", "conflict", "reversal", "payoff"][index] as "hook" | "context" | "conflict" | "reversal" | "payoff",
      timing: { startSec: index * 5, endSec: (index + 1) * 5 },
      claimIds: [`claim_${index + 1}`],
      scene: {
        id: `scene_${index + 1}`,
        durationSec: 5,
        primaryVisualEvent: `Evidence beat ${index + 1} changes on screen.`,
        layers: [
          { id: `layer_primary_${index + 1}`, role: "primary" as const, assetId: "asset_photo" },
          { id: `layer_type_${index + 1}`, role: "type" as const, content: `Fact ${index + 1}` },
        ],
        motion: {
          primary: {
            family: index === 0 ? "punch_in" as const : "parallax" as const,
            subjectLayerId: `layer_primary_${index + 1}`,
          },
        },
        caption: { text: `Caption ${index + 1}`, placement: "lower_third" as const },
      },
      audio: {
        narration: { text: `Narration for beat ${index + 1}.`, delivery: "measured" as const },
        musicCue: index === 0 ? "intro" as const : "build" as const,
        sfx: [],
      },
    })),
    audioMix: {
      narratorProfile: "documentary_narrator_v1",
      musicAssetId: "asset_music",
      targetLufs: -16,
      musicDuckUnderNarrationDb: -14,
      truePeakDb: -1,
    },
    qa: {
      plan: {
        hardGates: [...REQUIRED_SHORT_QA_CHECKS],
        sceneChecks: beatIds.map((beatId) => ({
          beatId,
          checks: ["caption_safe_zone" as const, "motion_alignment" as const, "visual_legibility" as const],
        })),
      },
    },
  };
}

function validatesAndOrdersADirectShort(): void {
  const manifest = createDirectShortStrategyManifest(makeInput());

  assert.equal(manifest.version, SHORT_STRATEGY_MANIFEST_VERSION);
  assert.equal(isDocumentarySpinoff(manifest), false);
  assert.equal(shortRenderDurationSec(manifest), 25);
  assert.deepEqual(renderOrderedShortBeats(manifest).map((beat) => beat.id), [
    "beat_1",
    "beat_2",
    "beat_3",
    "beat_4",
    "beat_5",
  ]);
}

function validatesADocumentarySpinoffWithCandidateSelection(): void {
  const input = makeInput();
  const sourceDocumentary = {
    documentaryId: "documentary_2026",
    title: "The Full Investigation",
    sourceVideoId: "youtube_video_001",
    sourceWindow: { startSec: 122, endSec: 147 },
    storyBeatIds: ["longform_beat_04", "longform_beat_05"],
  };
  const candidateSet = {
    id: "candidate_set_001",
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    candidates: [
      {
        id: "candidate_low",
        origin: "documentary_spinoff" as const,
        hook: "A small decision had a large consequence.",
        premise: "The first version of the documentary clip.",
        estimatedDurationSec: 25,
        score: candidateScore(0.5),
        sourceDocumentary,
      },
      {
        id: "candidate_high",
        origin: "documentary_spinoff" as const,
        hook: "The document that changed everything was hidden in plain sight.",
        premise: "The strongest self-contained documentary clip.",
        estimatedDurationSec: 25,
        score: candidateScore(0.9),
        sourceDocumentary,
      },
    ],
  };
  const candidateSelection = createShortCandidateSelection(
    candidateSet,
    "candidate_high",
    "It has the strongest hook and remains understandable without the long-form opening.",
  );
  const manifest = createDocumentarySpinoffStrategyManifest({
    ...input,
    strategy: { ...input.strategy, sourceDocumentary },
    candidateSet,
    candidateSelection,
  });

  assert.equal(isDocumentarySpinoff(manifest), true);
  assert.equal(manifest.strategy.sourceDocumentary?.documentaryId, "documentary_2026");
  assert.equal(selectedShortCandidate(candidateSet, candidateSelection).id, "candidate_high");
  assert.deepEqual(rankShortCandidates(candidateSet.candidates).map((candidate) => candidate.id), [
    "candidate_high",
    "candidate_low",
  ]);
  assert.equal(scoreShortCandidate(candidateSet.candidates[1]), 0.9);
}

function rejectsUntraceableOrIncompletePlans(): void {
  const unknownClaim = makeInput();
  unknownClaim.beats[0].claimIds = ["claim_missing"];
  const unknownClaimResult = validateShortStrategyManifest({
    ...unknownClaim,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...unknownClaim.strategy, origin: "direct_short" },
  });
  assert.equal(unknownClaimResult.success, false);

  const incompleteQa = makeInput();
  incompleteQa.qa.plan.hardGates = incompleteQa.qa.plan.hardGates.filter((check) => check !== "asset_provenance");
  const incompleteQaResult = validateShortStrategyManifest({
    ...incompleteQa,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...incompleteQa.strategy, origin: "direct_short" },
  });
  assert.equal(incompleteQaResult.success, false);

  const badTiming = makeInput();
  badTiming.beats[2].timing.startSec = 10.5;
  const badTimingResult = validateShortStrategyManifest({
    ...badTiming,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...badTiming.strategy, origin: "direct_short" },
  });
  assert.equal(badTimingResult.success, false);

  const falseSpinoff = makeInput();
  const falseSpinoffResult = validateShortStrategyManifest({
    ...falseSpinoff,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: {
      ...falseSpinoff.strategy,
      origin: "documentary_spinoff",
    },
  });
  assert.equal(falseSpinoffResult.success, false);

  const mismatchedEvidence = makeInput();
  mismatchedEvidence.claims[0].sourceIds = ["source_archive"];
  mismatchedEvidence.claims[0].evidence = [{
    sourceId: "source_missing",
    excerpt: "This should never pass provenance validation.",
    locator: "folio missing",
  }];
  const mismatchedEvidenceResult = validateShortStrategyManifest({
    ...mismatchedEvidence,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...mismatchedEvidence.strategy, origin: "direct_short" },
  });
  assert.equal(mismatchedEvidenceResult.success, false);
}

function rejectsCandidateSelectionThatDoesNotCoverTheSet(): void {
  const sourceDocumentary = {
    documentaryId: "documentary_2026",
    title: "The Full Investigation",
    sourceWindow: { startSec: 122, endSec: 147 },
    storyBeatIds: ["longform_beat_04"],
  };
  const candidateSet = {
    id: "candidate_set_002",
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    candidates: [
      {
        id: "candidate_a",
        origin: "documentary_spinoff" as const,
        hook: "Hook A",
        premise: "Premise A",
        estimatedDurationSec: 25,
        score: candidateScore(0.8),
        sourceDocumentary,
      },
      {
        id: "candidate_b",
        origin: "documentary_spinoff" as const,
        hook: "Hook B",
        premise: "Premise B",
        estimatedDurationSec: 25,
        score: candidateScore(0.7),
        sourceDocumentary,
      },
    ],
  };
  assert.throws(
    () => selectedShortCandidate(candidateSet, {
      candidateSetId: "candidate_set_002",
      selectedCandidateId: "candidate_a",
      rankedCandidateIds: ["candidate_a"],
      rationale: "Incomplete ranking.",
    }),
    /include every candidate exactly once/,
  );
}

function main(): void {
  validatesAndOrdersADirectShort();
  validatesADocumentarySpinoffWithCandidateSelection();
  rejectsUntraceableOrIncompletePlans();
  rejectsCandidateSelectionThatDoesNotCoverTheSet();
  console.log("SHORT STRATEGY MANIFEST TESTS PASS");
}

main();
