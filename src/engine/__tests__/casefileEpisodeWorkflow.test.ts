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
  attachCasefileEpisodePlanning,
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

const shotList = [{
  id: "shot-ledger-order",
  beatId: "beat-ledger-order",
  sourceSentenceIds: ["sentence-ledger-order"],
  t0: 0,
  t1: 12,
  coveragePurpose: "Show the cited court finding and the consequence of its closure order.",
  literalContent: "A neutral court-record document beside the sealed ledger room.",
  entities: [], era: "historical", wardrobe: [], props: ["court file", "sealed ledger"],
  continuityState: "ledger-room-neutral", cameraMove: "static" as const, shotScale: "close" as const,
  lens: "50mm", lighting: "soft archive light", motion: "restrained document parallax",
  negative: "no gore, no likeness, no text", generationProfile: "production" as const,
  candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
  prompt: "A neutral cited court finding beside a sealed ledger room.", seconds: 12,
  storyFunction: "evidence", section: "closure", seed: 1,
}, {
  id: "shot-ledger-seal",
  beatId: "beat-ledger-seal",
  sourceSentenceIds: ["sentence-ledger-seal"],
  t0: 12,
  t1: 24,
  coveragePurpose: "Show the documented closure as a cited room-and-file abstraction.",
  literalContent: "A sealed ledger room and cited court file, without an invented event.",
  entities: [], era: "historical", wardrobe: [], props: ["court file", "sealed ledger"],
  continuityState: "ledger-room-neutral", cameraMove: "truck_right" as const, shotScale: "wide" as const,
  lens: "35mm", lighting: "soft archive light", motion: "restrained lateral room reveal",
  negative: "no gore, no likeness, no text", generationProfile: "production" as const,
  candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
  prompt: "A neutral cited closure abstraction inside a sealed ledger room.", seconds: 12,
  storyFunction: "consequence", section: "closure", seed: 2,
}];

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
        shotIds: ["shot-ledger-order", "shot-ledger-seal"],
        treatment: "neutral_reenactment",
        sourceIds: ["source-court-ledger"],
        onScreenCitation: true,
        reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE,
      }, {
        sceneIds: ["scene-ledger-order", "scene-ledger-seal"],
        shotIds: ["shot-ledger-order", "shot-ledger-seal"],
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

  const draft = draftCasefileEpisodeCinematicSequence({
    episode: evidence,
    direction,
  });
  assert.equal(draft.status, "awaiting_cinematic_review");
  assert.equal(draft.cinematicDraft?.content.beats[0]?.shots.length, 4);
  assert.match(draft.cinematicDraft?.content.beats[0]?.shots[1]?.still ?? "", /charcoal wool coat/i);

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
  assert.throws(
    () => finalizeCasefileEpisodeCinematicSequence({ episode: final, editorialReview: {}, now: NOW }),
    /expected awaiting_cinematic_review/i,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
