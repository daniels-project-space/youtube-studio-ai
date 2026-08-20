import assert from "node:assert/strict";

import { RECONSTRUCTION_DISCLOSURE, casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import {
  CASEFILE_EPISODE_WORKFLOW_VERSION,
  admitCasefileEpisodeEvidenceMap,
  admitCasefileEpisodeSource,
  attachCasefileEpisodeNarrativeEvidenceLedger,
  attachCasefileEpisodePlanning,
  attachCasefileEpisodeReferenceMechanics,
  attachCasefileEpisodeSourceBoundStorySpine,
  draftCasefileEpisodeCinematicSequence,
  finalizeCasefileEpisodeCinematicSequence,
} from "@/engine/casefileEpisodeWorkflow";
import {
  CINEMATIC_CASE_DIRECTION_VERSION,
} from "@/engine/cinematicCaseSequenceDraft";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { planStorySpine } from "@/engine/storySpine";

const NOW = new Date("2026-08-15T12:00:00.000Z");

const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-ledger-closure",
  casePacket: {
    version: "casefile/v1",
    id: "case-ledger-closure",
    title: "The Ledger Closure",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-court-ledger",
      kind: "court_record",
      title: "Closure finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/ledger-closure",
      excerpt: "The finding records the documented closure decision.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://court.example.org/rights/ledger-closure",
      },
    }],
    claims: [{
      id: "claim-ledger-order",
      order: 10,
      text: "The court finding ordered the ledger room closed.",
      state: "established",
      sourceIds: ["source-court-ledger"],
      operationalRisk: "none",
    }],
    sensitivity: {
      activeAllegations: false,
      involvesMinors: false,
      includesGraphicDetail: false,
      actionableWrongdoing: false,
    },
    reconstruction: { mode: "illustrated_reconstruction", disclosureText: RECONSTRUCTION_DISCLOSURE },
  },
  claimPrimarySources: [{
    claimId: "claim-ledger-order",
    sourceId: "source-court-ledger",
    primarySourceUrl: "https://court.example.org/records/ledger-closure",
    provenance: "court_record",
  }],
  sourceUsage: [{
    sourceId: "source-court-ledger",
    usage: "visual_media",
    assetId: "asset-court-ledger",
    rightsEvidenceLocator: "https://court.example.org/rights/ledger-closure",
  }],
  editorialReview: {
    id: "editorial-review-ledger-closure",
    decision: "approved",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    reviewedPacketFingerprint: "0".repeat(64),
    reviewedSourcePacketFingerprint: "0".repeat(64),
  },
};
sourcePacket.editorialReview.reviewedPacketFingerprint = casefileFingerprint(sourcePacket.casePacket);
sourcePacket.editorialReview.reviewedSourcePacketFingerprint = casefileSourcePacketContentFingerprint(sourcePacket);

const sceneManifest = {
  version: "scene-manifest/v1" as const,
  durationSec: 24,
  scenes: [{
    id: "scene-ledger-order",
    beatId: "beat-ledger-order",
    t0: 0,
    t1: 12,
    kind: "claim" as const,
    label: "The court finding ordered the ledger room closed.",
    characterIds: [],
    camera: { framing: "close" as const, move: "static" as const },
    visualState: { action: "A court document is read beside a locked ledger room.", props: ["court file", "ledger"] },
    text: "The court finding ordered the ledger room closed.",
    causalInputBeatIds: [],
    sourceRefs: ["source-court-ledger"],
    transition: "cut" as const,
  }, {
    id: "scene-ledger-seal",
    beatId: "beat-ledger-seal",
    t0: 12,
    t1: 24,
    kind: "claim" as const,
    label: "The documented court order closes the ledger room.",
    characterIds: [],
    camera: { framing: "wide" as const, move: "pan" as const },
    visualState: { action: "The sealed ledger room is shown as the court file is catalogued.", props: ["sealed ledger", "court file"] },
    text: "The documented court order closes the ledger room.",
    causalInputBeatIds: ["beat-ledger-order"],
    sourceRefs: ["source-court-ledger"],
    transition: "dissolve" as const,
  }],
  fingerprint: "a".repeat(64),
  topic: "The Ledger Closure",
  audience: "general" as const,
  seriesId: "series-ledger-files",
  episodeId: "episode-ledger-closure",
  renderer: "deterministic-scene/v1" as const,
  externalProviderCalls: 0 as const,
};

const plannedStorySpine = planStorySpine({
  topic: sourcePacket.casePacket.title,
  narrationDurationSec: 24,
  sentenceTimings: [
    { text: "The court finding ordered the ledger room closed.", start: 0, end: 12 },
    { text: "The documented court order closes the ledger room.", start: 12, end: 24 },
  ],
  targetShotSec: 12,
});
const storySpine = {
  ...plannedStorySpine,
  // Keep this fixture's causal copy compact enough to exercise the Casefile
  // workflow rather than the unrelated cinematic prompt-length boundary.
  shotList: [plannedStorySpine.shotList[0]!, plannedStorySpine.shotList[4]!].map((shot, index) => ({
    ...shot,
    t0: index === 0 ? 0 : 12,
    t1: index === 0 ? 12 : 24,
    seconds: 12,
    coveragePurpose: index === 0 ? "Cited court finding." : "Cited closure order.",
    literalContent: index === 0
      ? "The cited court finding orders the room closed."
      : "The cited order closes the ledger room.",
  })),
};
const shotList = storySpine.shotList;

async function main(): Promise<void> {
  const source = admitCasefileEpisodeSource(sourcePacket, { now: NOW });
  assert.equal(source.version, CASEFILE_EPISODE_WORKFLOW_VERSION);
  assert.equal(source.status, "source_admitted");
  assert.throws(
    () => admitCasefileEpisodeEvidenceMap({ episode: source, evidenceShotMapInput: {}, now: NOW }),
    /expected awaiting_evidence_review/i,
  );

  const planning = attachCasefileEpisodePlanning({ episode: source, sceneManifest, shotList });
  assert.equal(planning.status, "awaiting_evidence_review");
  const evidenceInput: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: source.caseId,
    sourcePacketFingerprint: source.sourceAdmission.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
    claimMappings: [{
      claimId: "claim-ledger-order",
      bindings: [{
        sceneIds: ["scene-ledger-order", "scene-ledger-seal"],
        shotIds: shotList.map((shot) => shot.id),
        treatment: "neutral_reenactment",
        sourceIds: ["source-court-ledger"],
        onScreenCitation: true,
        reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE,
      }, {
        sceneIds: ["scene-ledger-order", "scene-ledger-seal"],
        shotIds: shotList.map((shot) => shot.id),
        treatment: "document_abstraction",
        sourceIds: ["source-court-ledger"],
        onScreenCitation: true,
      }],
    }],
    editorialReview: {
      id: "evidence-shot-review-ledger-closure",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 30_000).toISOString(),
      reviewedSourcePacketFingerprint: source.sourceAdmission.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  evidenceInput.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(evidenceInput);
  const evidence = admitCasefileEpisodeEvidenceMap({ episode: planning, evidenceShotMapInput: evidenceInput, now: NOW });
  assert.equal(evidence.status, "awaiting_cinematic_direction");
  const direction = {
    version: CINEMATIC_CASE_DIRECTION_VERSION,
    sequenceId: "cinematic-sequence-ledger-closure",
    caseId: source.caseId,
    causalQuestion: "Why did one court order close the ledger room?",
    visualWorld: "restrained archival noir, charcoal cloth, practical amber light, rain-softened stone",
    cast: [{
      id: "mannequin-investigator",
      role: "investigator" as const,
      silhouette: "tall square-shouldered faceless silhouette",
      wardrobeSignature: "charcoal wool coat, ash scarf, worn leather folio",
      palette: ["charcoal", "ash"],
      keyProp: "sealed court folio",
      movementProfile: "deliberate measured gait and restrained hand movement",
      faceless: true as const,
      noLikeness: true as const,
    }],
  };
  const referenceMechanics = {
    openingPromisePayoff: {
      guidance: "Open on one source-bound question and earn its answer with the later cited consequence.",
      sourceIds: ["fern"],
    },
    beatVisualRhythm: {
      guidance: "Change the visual only when the evidence relationship or causal state changes.",
      sourceIds: ["fern"],
    },
    narrationPaceClarity: {
      guidance: "Make the cited causal claim intelligible before adding restrained dramatic emphasis.",
      sourceIds: ["fern"],
    },
    cutSceneFunction: {
      guidance: "Every cut must reveal a fact, relationship, physical consequence, or earned breath.",
      sourceIds: ["fern"],
    },
    audioRelationship: {
      guidance: "Keep narration ahead of restrained ambience and preserve deliberate pauses for evidence.",
      sourceIds: ["fern"],
    },
    recurringIdentity: {
      guidance: "Use this channel's own faceless cast, wardrobe, and source-proof presentation grammar.",
      sourceIds: ["fern"],
    },
    exclusions: {
      guidance: "Never copy cases, scripts, footage, voices, channel identity, or unsupported reconstructions.",
      sourceIds: ["fern"],
    },
  };
  const referenceMechanicsReview = {
    id: "reference-mechanics-review-ledger-closure",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: NOW.toISOString(),
  };
  const reconstructionOnlyInput: CasefileEvidenceShotMapInput = {
    ...evidenceInput,
    claimMappings: [{ ...evidenceInput.claimMappings[0]!, bindings: [evidenceInput.claimMappings[0]!.bindings[0]!] }],
    editorialReview: { ...evidenceInput.editorialReview, reviewedShotMapFingerprint: "0".repeat(64) },
  };
  reconstructionOnlyInput.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(reconstructionOnlyInput);
  const reconstructionOnly = admitCasefileEpisodeEvidenceMap({ episode: planning, evidenceShotMapInput: reconstructionOnlyInput, now: NOW });
  assert.throws(
    () => draftCasefileEpisodeCinematicSequence({ episode: reconstructionOnly, direction }),
    /no admitted document\/map\/timeline source-proof binding/i,
    "a mannequin action cannot crowd out the independently admitted proof cut",
  );

  assert.throws(
    () => attachCasefileEpisodeReferenceMechanics({
      episode: evidence,
      mechanics: { ...referenceMechanics, sources: [] },
      review: referenceMechanicsReview,
      now: NOW,
    }),
    /unrecognized key/i,
    "the desk accepts annotations only; an operator cannot inject sources or copied-media metadata",
  );
  const evidenceWithReferenceMechanics = attachCasefileEpisodeReferenceMechanics({
    episode: evidence,
    mechanics: referenceMechanics,
    review: referenceMechanicsReview,
    now: NOW,
  });
  assert.equal(evidenceWithReferenceMechanics.status, "awaiting_cinematic_direction");
  assert.equal(
    evidenceWithReferenceMechanics.referenceMechanicsPacket?.sources.map((source) => source.id).join(","),
    "fern,fascinating-horror",
    "the intake derives its attributed source set from the fixed documentary contract",
  );
  assert.throws(
    () => attachCasefileEpisodeReferenceMechanics({
      episode: evidenceWithReferenceMechanics,
      mechanics: referenceMechanics,
      review: referenceMechanicsReview,
      now: NOW,
    }),
    /already frozen/i,
    "a reviewed mechanics packet cannot be silently replaced before cinematic review",
  );

  assert.throws(
    () => attachCasefileEpisodeNarrativeEvidenceLedger({
      episode: evidenceWithReferenceMechanics,
      claims: [],
      review: {},
      now: NOW,
    }),
    /requires a frozen source-bound Story Spine/i,
    "a semantic ledger cannot be attached to a different or unbound narration timeline",
  );
  const evidenceWithBoundStorySpine = attachCasefileEpisodeSourceBoundStorySpine({
    episode: evidenceWithReferenceMechanics,
    storySpine,
    now: NOW,
  });
  assert.equal(
    evidenceWithBoundStorySpine.sourceBoundStorySpine?.storySpineShotPlanFingerprint,
    casefileShotPlanFingerprint(shotList),
    "the desk freezes the exact Story Spine shot plan reviewed by the evidence map",
  );
  const narrativeEvidenceClaims = [{
      id: "narrative-claim-ledger-order",
      approvedText: "The court finding ordered the ledger room closed.",
      assertionState: "established",
      confidence: "high",
      uncertainty: { level: "none", summary: "The reviewed court record directly supports this closed historical decision." },
      causalRole: "decision",
      supports: [{
        sourceIds: ["source-court-ledger"],
        upstreamClaimIds: ["claim-ledger-order"],
      }],
      allowedVisualTreatments: [
        { kind: "source_proof", onScreenCitation: true, exactSourceAssetRequired: true },
        { kind: "ambient_context", doesNotDepictClaimAsObserved: true },
        {
          kind: "neutral_reenactment",
          visiblyLabeled: true,
          disclosureText: RECONSTRUCTION_DISCLOSURE,
          anonymousDepictionOnly: true,
          doesNotClaimDirectObservation: true,
        },
      ],
    }];
  const narrativeEvidenceReview = {
    reviewerId: "reviewer-documentary-desk",
    reviewId: "narrative-ledger-review-ledger-closure",
    reviewedAt: NOW.toISOString(),
  };
  assert.throws(
    () => attachCasefileEpisodeNarrativeEvidenceLedger({
      episode: evidenceWithBoundStorySpine,
      claims: [{ ...narrativeEvidenceClaims[0]!, sources: ["source-injected"] }],
      review: narrativeEvidenceReview,
      now: NOW,
    }),
    /unrecognized key/i,
    "the desk derives the sole Casefile rail and rejects injected source metadata",
  );
  const evidenceWithNarrativeLedger = attachCasefileEpisodeNarrativeEvidenceLedger({
    episode: evidenceWithBoundStorySpine,
    claims: narrativeEvidenceClaims,
    review: narrativeEvidenceReview,
    now: NOW,
  });
  const narrativeEvidenceLedger = evidenceWithNarrativeLedger.narrativeEvidenceLedger!;
  assert.equal(
    evidenceWithNarrativeLedger.narrativeEvidenceLedger?.contentFingerprint,
    narrativeEvidenceLedger.contentFingerprint,
    "the private ledger is immutable and bound before cinematic direction is signed",
  );
  assert.throws(
    () => attachCasefileEpisodeNarrativeEvidenceLedger({
      episode: evidenceWithNarrativeLedger,
      claims: narrativeEvidenceClaims,
      review: narrativeEvidenceReview,
      now: NOW,
    }),
    /already frozen/i,
    "a reviewed semantic ledger cannot be silently replaced on an episode revision",
  );

  const draft = draftCasefileEpisodeCinematicSequence({
    episode: evidenceWithNarrativeLedger,
    direction,
    now: NOW,
  });
  assert.equal(draft.status, "awaiting_cinematic_review");
  assert.equal(draft.cinematicDraft?.content.beats[0]?.shots.length, 4);
  assert.match(draft.cinematicDraft?.content.beats[0]?.shots[1]?.still ?? "", /charcoal wool coat/i);
  assert.equal(
    draft.cinematicDraft?.content.referenceMechanicsPacket?.contentFingerprint,
    evidenceWithReferenceMechanics.referenceMechanicsPacket?.contentFingerprint,
    "the reviewed mechanics packet is part of the editor-signed cinematic sequence content",
  );
  assert.equal(
    draft.cinematicDraft?.content.narrativeEvidenceLedgerFingerprint,
    narrativeEvidenceLedger.contentFingerprint,
    "the desk derives the frozen semantic ledger identity into the editor-signed cinematic direction",
  );

  const final = finalizeCasefileEpisodeCinematicSequence({
    episode: draft,
    editorialReview: {
      id: "cinematic-sequence-review-ledger-closure",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: NOW.toISOString(),
      reviewedSourcePacketFingerprint: source.sourceAdmission.sourcePacketFingerprint,
      reviewedEvidenceShotMapFingerprint: evidence.evidenceShotMap!.contentFingerprint,
      reviewedSequenceFingerprint: draft.cinematicDraft!.sequenceContentFingerprint,
    },
    now: NOW,
  });
  assert.equal(final.status, "render_admitted");
  assert.equal(final.cinematicAdmission?.generatedSceneCount, 8);
  assert.equal(final.cinematicAdmission?.release, "private_human_editorial_review_only");
  assert.equal(
    final.cinematicInput?.referenceMechanicsPacket?.contentFingerprint,
    evidenceWithReferenceMechanics.referenceMechanicsPacket?.contentFingerprint,
  );
  assert.equal(
    final.cinematicAdmission?.narrativeEvidenceLedgerFingerprint,
    narrativeEvidenceLedger.contentFingerprint,
    "final cinematic admission cannot drop the reviewed semantic evidence ledger",
  );
  assert.throws(
    () => finalizeCasefileEpisodeCinematicSequence({ episode: final, editorialReview: {}, now: NOW }),
    /expected awaiting_cinematic_review/i,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
