import assert from "node:assert/strict";

import { RECONSTRUCTION_DISCLOSURE, casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  assertCasefileEvidenceShotMap,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import {
  CINEMATIC_CASE_SEQUENCE_VERSION,
  assertCinematicCaseSequence,
  cinematicCaseSequenceContentFingerprint,
  evaluateCinematicCaseSequence,
  type CinematicCaseSequenceInput,
} from "@/engine/cinematicCaseSequence";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import {
  SOURCE_PROOF_MEDIA_VERSION,
  sourceProofMediaProvenanceFingerprint,
  type SourceProofMediaObligation,
} from "@/engine/sourceProofMedia";

/**
 * End-to-end behavioral test for the typed `sourceProofMedia` obligation on
 * `CinematicCoverageShotSchema` — the narrow real-photographic evidence
 * insert exception, distinct from LTX mannequin-generated coverage.
 * Exercises the REAL `evaluateCinematicCaseSequence`/
 * `assertCinematicCaseSequence` admission path with a minimal two-beat
 * fixture (cold_open, reveal), modeled closely on the existing
 * cinematicCaseSequence.test.ts / cinematicIntroductionNameCard.test.ts
 * fixtures.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-verdict-archive",
  casePacket: {
    version: "casefile/v1",
    id: "case-verdict-archive",
    title: "The Verdict Archive",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-court-archive",
      kind: "court_record",
      title: "Case verdict finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/verdict-archive",
      excerpt: "The finding records the team's formation and the documented final verdict.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://court.example.org/rights/verdict-archive-license",
      },
    }],
    claims: [
      {
        id: "claim-team-formed",
        order: 10,
        text: "The court record documents when the investigation team was formed.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "none",
      },
      {
        id: "claim-team-verdict",
        order: 20,
        text: "The documented verdict names the team's final determination.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "contextual",
      },
    ],
    sensitivity: {
      activeAllegations: false,
      involvesMinors: false,
      includesGraphicDetail: false,
      actionableWrongdoing: false,
    },
    reconstruction: { mode: "illustrated_reconstruction", disclosureText: RECONSTRUCTION_DISCLOSURE },
  },
  claimPrimarySources: [
    { claimId: "claim-team-formed", sourceId: "source-court-archive", primarySourceUrl: "https://court.example.org/records/verdict-archive", provenance: "court_record" },
    { claimId: "claim-team-verdict", sourceId: "source-court-archive", primarySourceUrl: "https://court.example.org/records/verdict-archive", provenance: "court_record" },
  ],
  sourceUsage: [{
    sourceId: "source-court-archive",
    usage: "visual_media",
    assetId: "asset-court-archive-verdict-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/verdict-archive-license",
  }],
  editorialReview: {
    id: "editorial-review-verdict-archive-001",
    decision: "approved",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    reviewedPacketFingerprint: "0".repeat(64),
    reviewedSourcePacketFingerprint: "0".repeat(64),
  },
};
sourcePacket.editorialReview.reviewedPacketFingerprint = casefileFingerprint(sourcePacket.casePacket);
sourcePacket.editorialReview.reviewedSourcePacketFingerprint = casefileSourcePacketContentFingerprint(sourcePacket);

const sceneManifest = {
  version: "scene-manifest/v1" as const,
  durationSec: 24,
  scenes: [
    {
      id: "scene-team-formed", beatId: "beat-team-formed", t0: 0, t1: 12, kind: "claim" as const,
      label: "The court record documents when the investigation team was formed.",
      characterIds: [], camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "A cited court document establishes the team's formation.", props: ["file", "date"] },
      text: "The court record documents when the investigation team was formed.",
      causalInputBeatIds: [], sourceRefs: ["source-court-archive"], transition: "cut" as const,
    },
    {
      id: "scene-team-verdict", beatId: "beat-team-verdict", t0: 12, t1: 24, kind: "result" as const,
      label: "The documented verdict names the team's final determination.",
      characterIds: [], camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "A cited verdict document is shown in extreme close-up.", props: ["verdict document"] },
      text: "The documented verdict names the team's final determination.",
      causalInputBeatIds: ["beat-team-formed"], sourceRefs: ["source-court-archive"], transition: "dissolve" as const,
    },
  ],
  fingerprint: "a".repeat(64),
  topic: "The Verdict Archive",
  audience: "general" as const,
  seriesId: "series-archive-files",
  episodeId: "episode-verdict-archive",
  renderer: "deterministic-scene/v1" as const,
  externalProviderCalls: 0 as const,
};

const shotList = [
  {
    id: "shot-team-formed", beatId: "beat-team-formed", sourceSentenceIds: ["sentence-team-formed"], t0: 0, t1: 12,
    coveragePurpose: "Show the court finding as a cited document abstraction.",
    literalContent: "A neutral court-record document abstraction with a visible citation.",
    entities: [], era: "historical", wardrobe: [], props: ["court document"], continuityState: "case-file-neutral",
    cameraMove: "static" as const, shotScale: "close" as const, lens: "50mm", lighting: "soft neutral archive light",
    motion: "subtle document parallax", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral court-record document abstraction with cited provenance.", seconds: 12, storyFunction: "evidence", section: "formed", seed: 1,
  },
  {
    id: "shot-team-verdict", beatId: "beat-team-verdict", sourceSentenceIds: ["sentence-team-verdict"], t0: 12, t1: 24,
    coveragePurpose: "Show a cited verdict document in extreme close-up.",
    literalContent: "A neutral extreme close-up on the cited verdict document.",
    entities: [], era: "historical", wardrobe: [], props: ["verdict document"], continuityState: "case-file-neutral",
    cameraMove: "static" as const, shotScale: "extreme_close" as const, lens: "100mm macro", lighting: "neutral archive light",
    motion: "slow document reveal", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral cited extreme close-up of the documented verdict.", seconds: 12, storyFunction: "context", section: "verdict", seed: 2,
  },
];

const admittedSource = assertCasefileSourcePacket(sourcePacket, { now: NOW });

function admittedMap() {
  const input: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
    claimMappings: [
      {
        claimId: "claim-team-formed",
        bindings: [
          { sceneIds: ["scene-team-formed"], shotIds: ["shot-team-formed"], treatment: "document_abstraction", sourceIds: ["source-court-archive"], onScreenCitation: true },
          { sceneIds: ["scene-team-formed"], shotIds: ["shot-team-formed"], treatment: "neutral_reenactment", sourceIds: ["source-court-archive"], onScreenCitation: true, reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE },
        ],
      },
      {
        claimId: "claim-team-verdict",
        bindings: [{ sceneIds: ["scene-team-verdict"], shotIds: ["shot-team-verdict"], treatment: "timeline", sourceIds: ["source-court-archive"], onScreenCitation: true }],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-verdict-archive-001",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  return assertCasefileEvidenceShotMap({ input, sourcePacket, sourceAdmission: admittedSource.receipt, sceneManifest, shotList }, { now: NOW });
}

function coverageShot(args: {
  id: string; t0: number; t1: number;
  purpose: "spatial_anchor" | "mannequin_action" | "relationship" | "evidence_insert" | "contradiction" | "consequence" | "reaction" | "aftermath";
  mode: "source_proof" | "spatial_reconstruction" | "abstract_reenactment" | "atmosphere";
  scale: "wide" | "medium" | "close" | "extreme_close" | "establishing";
  move: "static" | "dolly_push" | "dolly_pull" | "crane_up" | "crane_down" | "orbit_left" | "orbit_right" | "truck_left" | "truck_right" | "handheld_drift";
  cut: "new_fact" | "new_location" | "new_relationship" | "physical_action" | "contradiction" | "reveal" | "breath";
  tension: "question" | "orientation" | "pressure" | "uncertainty" | "reversal" | "release" | "residue";
  cast?: string[];
  sourceProofMedia?: SourceProofMediaObligation;
}) {
  return {
    id: args.id, t0: args.t0, t1: args.t1, coveragePurpose: args.purpose, visualMode: args.mode, castIds: args.cast ?? [],
    cameraMove: args.move, shotScale: args.scale, lens: args.scale === "close" ? "85mm" : "35mm", cutReason: args.cut, tensionState: args.tension,
    cameraRationale: `A motivated ${args.move} communicates ${args.cut}.`, narrationPurpose: `Make the narrated ${args.purpose.replaceAll("_", " ")} concrete.`,
    still: `A controlled, cinematic, faceless documentary frame for ${args.purpose}; no likeness, no gore, no baked text.`,
    motion: `A restrained ${args.move} with locked wardrobe, silhouette, prop, setting, and lighting.`,
    negative: "identifiable face, real-person likeness, gore, sensational violence, text, logo, watermark, broken anatomy",
    firstFrameConstraint: "Start from the exact cited story state with the same wardrobe and prop.",
    lastFrameConstraint: "End with only motivated action advanced; preserve wardrobe and setting continuity.",
    onScreenCitation: true as const,
    ...(args.mode === "abstract_reenactment" ? { reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE } : {}),
    ...(args.sourceProofMedia ? { sourceProofMedia: args.sourceProofMedia } : {}),
  };
}

function approvedSequence(map: ReturnType<typeof admittedMap>): CinematicCaseSequenceInput {
  const sourceProofMedia: SourceProofMediaObligation = {
    version: SOURCE_PROOF_MEDIA_VERSION,
    sourceId: "source-court-archive",
    assetId: "asset-court-archive-verdict-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/verdict-archive-license",
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    assetUrl: "https://court.example.org/media/verdict-finding.jpg",
    assetSha256: "b".repeat(64),
    approvalReceiptId: "source-proof-receipt-verdict-archive-001",
    citation: {
      sourceId: "source-court-archive",
      label: "Regional Court Archive: Case verdict finding",
      locator: "https://court.example.org/records/verdict-archive",
    },
    provenanceFingerprint: "0".repeat(64),
  };
  sourceProofMedia.provenanceFingerprint = sourceProofMediaProvenanceFingerprint(sourceProofMedia);
  const input: CinematicCaseSequenceInput = {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: "cinematic-sequence-verdict-archive-001",
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    evidenceShotMapFingerprint: map.map.contentFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    cast: [{
      id: "mannequin-investigator", role: "investigator", silhouette: "tall square-shouldered faceless silhouette",
      wardrobeSignature: "charcoal wool coat, ash scarf, worn leather folio", palette: ["charcoal", "ash"], keyProp: "sealed court folio",
      movementProfile: "deliberate measured gait and restrained hand movement", faceless: true, noLikeness: true,
    }],
    beats: [
      {
        id: "cinematic-beat-team-formed", narrativeRole: "cold_open", t0: 0, t1: 12, parentShotIds: ["shot-team-formed"],
        claimIds: ["claim-team-formed"], sourceIds: ["source-court-archive"], causalQuestion: "Why was this investigation team formed?",
        shots: [
          coverageShot({ id: "cinematic-shot-team-formed-proof", t0: 0, t1: 4, purpose: "evidence_insert", mode: "source_proof", scale: "extreme_close", move: "static", cut: "new_fact", tension: "question", sourceProofMedia }),
          coverageShot({ id: "cinematic-shot-team-formed-figure", t0: 4, t1: 8, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "medium", move: "dolly_push", cut: "physical_action", tension: "pressure", cast: ["mannequin-investigator"] }),
          coverageShot({ id: "cinematic-shot-team-formed-space", t0: 8, t1: 12, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "establishing", move: "crane_up", cut: "new_location", tension: "uncertainty" }),
        ],
      },
      {
        id: "cinematic-beat-team-verdict", narrativeRole: "reveal", t0: 12, t1: 24, parentShotIds: ["shot-team-verdict"],
        claimIds: ["claim-team-verdict"], sourceIds: ["source-court-archive"], causalQuestion: "What did the documented verdict determine?",
        storyPayoff: {
          coldOpenBeatId: "cinematic-beat-team-formed",
          answerOrReframe: "The cited verdict reframes the team's work as a formally documented determination rather than an informal inquiry.",
          citedClaimIds: ["claim-team-verdict"],
          citedSourceIds: ["source-court-archive"],
        },
        shots: [
          // An exact approved asset, cited source_proof evidence insert,
          // extreme close-up, and no mannequin cast.
          coverageShot({ id: "cinematic-shot-verdict-proof", t0: 12, t1: 16, purpose: "evidence_insert", mode: "source_proof", scale: "extreme_close", move: "truck_right", cut: "reveal", tension: "reversal", sourceProofMedia }),
          coverageShot({ id: "cinematic-shot-verdict-map", t0: 16, t1: 20, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "wide", move: "orbit_left", cut: "new_relationship", tension: "release" }),
          coverageShot({ id: "cinematic-shot-verdict-aftermath", t0: 20, t1: 24, purpose: "aftermath", mode: "atmosphere", scale: "establishing", move: "dolly_pull", cut: "breath", tension: "residue" }),
        ],
      },
    ],
    editorialReview: {
      id: "cinematic-sequence-review-verdict-archive-001", decision: "approved", reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 20 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedEvidenceShotMapFingerprint: map.map.contentFingerprint,
      reviewedSequenceFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(input);
  return input;
}

function main() {
  const map = admittedMap();
  const input = approvedSequence(map);
  const args = { input, sourcePacket, sourceAdmission: admittedSource.receipt, evidenceShotMap: map.map, evidenceShotMapAdmission: map.receipt, sceneManifest, shotList };

  // ---- POSITIVE: a well-formed source-proof asset is admitted ------------
  const report = evaluateCinematicCaseSequence(args);
  assert.equal(report.safe, true, `well-formed source-proof asset must be admitted: ${JSON.stringify(report.issues.slice(0, 5))}`);

  const admitted = assertCinematicCaseSequence(args, { now: NOW });
  const scenes = admitted.generatedScenePlan.scenes;
  const proofScene = scenes.find((scene) => scene.id === "cinematic-shot-verdict-proof");
  const mapScene = scenes.find((scene) => scene.id === "cinematic-shot-verdict-map");
  assert.ok(proofScene, "the source-proof shot must produce a generated scene");
  assert.ok(mapScene, "the sibling non-source-proof shot must produce a generated scene");

  // The exact source/right/asset obligation passes through; no free-text
  // image query remains available to a renderer.
  assert.equal(proofScene!.sourceProofMedia?.assetId, "asset-court-archive-verdict-finding");
  assert.equal(proofScene!.realImageInsertQuery, undefined, "a source-proof scene must not carry a free-text image query");
  assert.equal(mapScene!.sourceProofMedia, undefined, "an unrelated shot must not carry a source-proof asset obligation");

  // ---- NEGATIVE 1: wrong coveragePurpose ----------------------------------
  const wrongPurpose = structuredClone(input);
  (wrongPurpose.beats[1]!.shots[0] as { coveragePurpose: string }).coveragePurpose = "spatial_anchor";
  const wrongPurposeReport = evaluateCinematicCaseSequence({ ...args, input: wrongPurpose });
  assert.equal(wrongPurposeReport.safe, false, "a source-proof asset with the wrong coveragePurpose must be rejected");
  assert.ok(
    wrongPurposeReport.issues.some((entry) => entry.code === "source_proof_media_invalid" && entry.message.includes("not an evidence_insert shot")),
    `expected the 'not an evidence_insert shot' issue, got: ${JSON.stringify(wrongPurposeReport.issues.map((entry) => entry.code))}`,
  );

  // ---- NEGATIVE 2: wrong visualMode ---------------------------------------
  const wrongMode = structuredClone(input);
  (wrongMode.beats[1]!.shots[0] as { visualMode: string }).visualMode = "spatial_reconstruction";
  const wrongModeReport = evaluateCinematicCaseSequence({ ...args, input: wrongMode });
  assert.equal(wrongModeReport.safe, false, "a source-proof asset with the wrong visualMode must be rejected");
  assert.ok(
    wrongModeReport.issues.some((entry) => entry.code === "source_proof_media_invalid" && entry.message.includes("does not use source_proof")),
    `expected the 'does not use source_proof' issue, got: ${JSON.stringify(wrongModeReport.issues.map((entry) => entry.code))}`,
  );

  // ---- NEGATIVE 3: wrong shotScale ----------------------------------------
  const wrongScale = structuredClone(input);
  (wrongScale.beats[1]!.shots[0] as { shotScale: string }).shotScale = "close";
  const wrongScaleReport = evaluateCinematicCaseSequence({ ...args, input: wrongScale });
  assert.equal(wrongScaleReport.safe, false, "a source-proof asset not framed extreme_close must be rejected");
  assert.ok(
    wrongScaleReport.issues.some((entry) => entry.code === "source_proof_media_invalid" && entry.message.includes("not framed extreme_close")),
    `expected the 'not framed extreme_close' issue, got: ${JSON.stringify(wrongScaleReport.issues.map((entry) => entry.code))}`,
  );

  // ---- NEGATIVE 4: carries a mannequin cast -------------------------------
  const withCast = structuredClone(input);
  (withCast.beats[1]!.shots[0] as { castIds: string[] }).castIds = ["mannequin-investigator"];
  const withCastReport = evaluateCinematicCaseSequence({ ...args, input: withCast });
  assert.equal(withCastReport.safe, false, "a source-proof asset with a mannequin cast must be rejected");
  assert.ok(
    withCastReport.issues.some((entry) => entry.code === "source_proof_media_invalid" && entry.message.includes("carries a mannequin cast")),
    `expected the 'carries a mannequin cast' issue, got: ${JSON.stringify(withCastReport.issues.map((entry) => entry.code))}`,
  );

  // ---- REGRESSION: legacy free-text queries fail closed ------------------
  const legacyQuery = structuredClone(input);
  const legacyProofShot = legacyQuery.beats[1]!.shots[0] as { sourceProofMedia?: SourceProofMediaObligation; realImageInsertQuery?: string };
  delete legacyProofShot.sourceProofMedia;
  legacyProofShot.realImageInsertQuery = "Regional Court Archive verdict document official letterhead";
  // Content changed, so the signed review must be re-fingerprinted — exactly
  // like any other legitimate content edit, unrelated to this field's gate.
  legacyQuery.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(legacyQuery);
  const legacyQueryReport = evaluateCinematicCaseSequence({ ...args, input: legacyQuery });
  assert.equal(legacyQueryReport.safe, false, "a legacy free-text image query must never reach a renderer");
  assert.ok(legacyQueryReport.issues.some((entry) => entry.code === "real_image_insert_invalid"));

  console.log("cinematic source-proof-media obligation behavioral test passed");
}

main();
