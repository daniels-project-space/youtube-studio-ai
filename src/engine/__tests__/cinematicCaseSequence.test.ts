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
  cinematicContinuitySeed,
  cinematicCaseSequenceContentFingerprint,
  evaluateCinematicCaseSequence,
  type CinematicCaseSequenceContent,
  type CinematicCaseSequenceInput,
} from "@/engine/cinematicCaseSequence";
import {
  CINEMATIC_CASE_DIRECTION_VERSION,
  finalizeCinematicCaseSequenceDraft,
  planCinematicCaseSequenceDraft,
} from "@/engine/cinematicCaseSequenceDraft";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { createSourceBoundStorySpineHandoff } from "@/engine/sourceBoundStorySpine";
import {
  createReferenceMechanicsPacket,
  referenceMechanicsPacketContentFingerprint,
} from "@/engine/referenceMechanicsPacket";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { admitCinematicFinalMasterQa } from "@/engine/cinematicFinalMasterQaAdmission";
import { createNarrativeEvidenceLedger } from "@/engine/narrativeEvidenceLedger";
import {
  SOURCE_PROOF_MEDIA_VERSION,
  sourceProofMediaProvenanceFingerprint,
  type SourceProofMediaObligation,
} from "@/engine/sourceProofMedia";
import { cinematicCaseSequenceBlocks } from "@/trigger/blocks/cinematicCaseSequenceBlocks";

const NOW = new Date("2026-08-14T12:00:00.000Z");

const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-vault-closure",
  casePacket: {
    version: "casefile/v1",
    id: "case-vault-closure",
    title: "The Vault Closure",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-court-archive",
      kind: "court_record",
      title: "Closure finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/vault-closure",
      excerpt: "The finding records the closure decision and the verified repair programme.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://court.example.org/rights/vault-closure-license",
      },
    }],
    claims: [
      {
        id: "claim-closure-order",
        order: 10,
        text: "The court finding ordered the vault's closure.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "none",
      },
      {
        id: "claim-public-response",
        order: 20,
        text: "The documented closure prompted public response.",
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
    {
      claimId: "claim-closure-order",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
    {
      claimId: "claim-public-response",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
  ],
  sourceUsage: [{
    sourceId: "source-court-archive",
    usage: "visual_media",
    assetId: "asset-court-closure-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/vault-closure-license",
  }],
  editorialReview: {
    id: "editorial-review-vault-closure-001",
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
      id: "scene-closure-order",
      beatId: "beat-closure-order",
      t0: 0,
      t1: 12,
      kind: "claim" as const,
      label: "The court finding ordered the vault's closure.",
      characterIds: [],
      camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "A cited court document establishes the closure order.", props: ["file", "date"] },
      text: "The court finding ordered the vault's closure.",
      causalInputBeatIds: [],
      sourceRefs: ["source-court-archive"],
      transition: "cut" as const,
    },
    {
      id: "scene-public-response",
      beatId: "beat-public-response",
      t0: 12,
      t1: 24,
      kind: "result" as const,
      label: "The documented closure prompted public response.",
      characterIds: [],
      camera: { framing: "wide" as const, move: "pan" as const },
      visualState: { action: "A neutral timeline connects response dates.", props: ["timeline"] },
      text: "The documented closure prompted public response.",
      causalInputBeatIds: ["beat-closure-order"],
      sourceRefs: ["source-court-archive"],
      transition: "dissolve" as const,
    },
  ],
  fingerprint: "a".repeat(64),
  topic: "The Vault Closure",
  audience: "general" as const,
  seriesId: "series-vault-files",
  episodeId: "episode-vault-closure",
  renderer: "deterministic-scene/v1" as const,
  externalProviderCalls: 0 as const,
};

const shotList = [
  {
    id: "shot-closure-order",
    beatId: "beat-closure-order",
    sourceSentenceIds: ["sentence-closure-order"],
    t0: 0,
    t1: 12,
    coveragePurpose: "Show the court finding as a cited document abstraction.",
    literalContent: "A neutral court-record document abstraction with a visible citation.",
    entities: [], era: "historical", wardrobe: [], props: ["court document"], continuityState: "case-file-neutral",
    cameraMove: "static" as const, shotScale: "close" as const, lens: "50mm", lighting: "soft neutral archive light",
    motion: "subtle document parallax", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral court-record document abstraction with cited provenance.", seconds: 12, storyFunction: "evidence", section: "closure", seed: 1,
  },
  {
    id: "shot-public-response",
    beatId: "beat-public-response",
    sourceSentenceIds: ["sentence-public-response"],
    t0: 12,
    t1: 24,
    coveragePurpose: "Show a cited public-response timeline.",
    literalContent: "A neutral timeline connecting the documented response dates.",
    entities: [], era: "historical", wardrobe: [], props: ["timeline"], continuityState: "case-file-neutral",
    cameraMove: "truck_right" as const, shotScale: "wide" as const, lens: "35mm", lighting: "neutral archive light",
    motion: "slow timeline reveal", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral cited timeline of documented public response.", seconds: 12, storyFunction: "context", section: "response", seed: 2,
  },
];

const admittedSource = assertCasefileSourcePacket(sourcePacket, { now: NOW });

function sourceProofMediaObligation(): SourceProofMediaObligation {
  const obligation = {
    version: SOURCE_PROOF_MEDIA_VERSION,
    sourceId: "source-court-archive",
    assetId: "asset-court-closure-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/vault-closure-license",
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    assetUrl: "https://court.example.org/assets/vault-closure-finding.jpg",
    assetSha256: "1".repeat(64),
    approvalReceiptId: "source-proof-receipt-vault-closure-001",
    provenanceFingerprint: "0".repeat(64),
  } satisfies Omit<SourceProofMediaObligation, "provenanceFingerprint"> & { provenanceFingerprint: string };
  obligation.provenanceFingerprint = sourceProofMediaProvenanceFingerprint(obligation);
  return obligation;
}

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
        claimId: "claim-closure-order",
        bindings: [
          { sceneIds: ["scene-closure-order"], shotIds: ["shot-closure-order"], treatment: "document_abstraction", sourceIds: ["source-court-archive"], onScreenCitation: true },
          { sceneIds: ["scene-closure-order"], shotIds: ["shot-closure-order"], treatment: "neutral_reenactment", sourceIds: ["source-court-archive"], onScreenCitation: true, reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE },
        ],
      },
      {
        claimId: "claim-public-response",
        bindings: [{ sceneIds: ["scene-public-response"], shotIds: ["shot-public-response"], treatment: "timeline", sourceIds: ["source-court-archive"], onScreenCitation: true }],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-vault-closure-001",
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

/** Builds the exact provider-free source-bound bridge that the cinematic block
 * must now consume. The normal cinematic fixtures deliberately use authored
 * ShotPlan identifiers, so the Story Spine here mirrors those reviewed timing
 * boundaries rather than creating a second planner's interpretation. */
function sourceBoundStorySpineFor(map: ReturnType<typeof admittedMap>) {
  const storySpine = {
    version: "1.0.0" as const,
    timedScript: {
      version: "1.0.0" as const,
      narrationDurationSec: 24,
      sentences: [
        {
          id: "sentence-closure-order",
          text: "The court finding ordered the vault's closure.",
          t0: 0,
          t1: 12,
          sectionId: "section-closure",
          evidenceRefs: ["source-court-archive"],
        },
        {
          id: "sentence-public-response",
          text: "The documented closure prompted public response.",
          t0: 12,
          t1: 24,
          sectionId: "section-response",
          evidenceRefs: ["source-court-archive"],
        },
      ],
    },
    narrativeBeats: [
      {
        id: "beat-closure-order",
        sourceSentenceIds: ["sentence-closure-order"],
        t0: 0,
        t1: 12,
        purpose: "Establish the cited closure order.",
        evidenceRefs: ["source-court-archive"],
      },
      {
        id: "beat-public-response",
        sourceSentenceIds: ["sentence-public-response"],
        t0: 12,
        t1: 24,
        purpose: "Show the documented public response.",
        evidenceRefs: ["source-court-archive"],
      },
    ],
    continuityLedger: {
      version: "1.0.0" as const,
      entities: [],
      locations: [],
      era: "historical",
      wardrobe: [],
      props: ["court document", "timeline"],
      palette: ["charcoal", "ash"],
      cameraGrammar: ["restrained"],
      negativeConstraints: ["no likeness", "no gore"],
    },
    shotList,
    dpVisualSpecs: shotList.map((shot) => ({
      shotId: shot.id,
      keyframePrompt: shot.prompt,
      motionPrompt: shot.motion,
      negativePrompt: shot.negative,
      styleLock: "case-file-neutral",
      firstFrameConstraint: `Start at ${shot.t0}s.`,
      lastFrameConstraint: `End at ${shot.t1}s.`,
      continuityState: shot.continuityState,
    })),
    editorEdl: {
      version: "1.0.0" as const,
      durationSec: 24,
      shots: shotList.map((shot) => ({
        shotId: shot.id,
        sourceSentenceIds: shot.sourceSentenceIds,
        t0: shot.t0,
        t1: shot.t1,
      })),
    },
    coverage: { mappedSec: 24, totalSec: 24, ratio: 1, gaps: [] },
  };
  return createSourceBoundStorySpineHandoff({
    sourcePacket,
    sourceAdmission: admittedSource.receipt,
    evidenceShotMap: map.map,
    evidenceShotMapAdmission: map.receipt,
    storySpine,
    now: NOW,
  });
}

function coverageShot(args: {
  id: string; t0: number; t1: number; purpose: "spatial_anchor" | "mannequin_action" | "relationship" | "evidence_insert" | "contradiction" | "consequence" | "reaction" | "aftermath";
  mode: "source_proof" | "spatial_reconstruction" | "abstract_reenactment" | "atmosphere";
  scale: "wide" | "medium" | "close" | "extreme_close" | "establishing"; move: "static" | "dolly_push" | "dolly_pull" | "crane_up" | "crane_down" | "orbit_left" | "orbit_right" | "truck_left" | "truck_right" | "handheld_drift";
  cut: "new_fact" | "new_location" | "new_relationship" | "physical_action" | "contradiction" | "reveal" | "breath";
  tension: "question" | "orientation" | "pressure" | "uncertainty" | "reversal" | "release" | "residue"; cast?: string[]; sourceProofMedia?: SourceProofMediaObligation;
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
    ...(args.sourceProofMedia ? { sourceProofMedia: args.sourceProofMedia } : {}),
    ...(args.mode === "abstract_reenactment" ? { reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE } : {}),
  };
}

function approvedSequence(map: ReturnType<typeof admittedMap>): CinematicCaseSequenceInput {
  const input: CinematicCaseSequenceInput = {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: "cinematic-sequence-vault-closure-001",
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
        id: "cinematic-beat-closure-order", narrativeRole: "cold_open", t0: 0, t1: 12, parentShotIds: ["shot-closure-order"],
        claimIds: ["claim-closure-order"], sourceIds: ["source-court-archive"], causalQuestion: "Why did a single court order close the vault?",
        shots: [
          coverageShot({ id: "cinematic-shot-closure-proof", t0: 0, t1: 4, purpose: "evidence_insert", mode: "source_proof", scale: "extreme_close", move: "static", cut: "new_fact", tension: "question", sourceProofMedia: sourceProofMediaObligation() }),
          coverageShot({ id: "cinematic-shot-closure-figure", t0: 4, t1: 8, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "medium", move: "dolly_push", cut: "physical_action", tension: "pressure", cast: ["mannequin-investigator"] }),
          coverageShot({ id: "cinematic-shot-closure-space", t0: 8, t1: 12, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "establishing", move: "crane_up", cut: "new_location", tension: "uncertainty" }),
        ],
      },
      {
        id: "cinematic-beat-public-response", narrativeRole: "reveal", t0: 12, t1: 24, parentShotIds: ["shot-public-response"],
        claimIds: ["claim-public-response"], sourceIds: ["source-court-archive"], causalQuestion: "What did the documented response reveal about the closure?",
        storyPayoff: {
          coldOpenBeatId: "cinematic-beat-closure-order",
          answerOrReframe: "The cited public response reframes the closure as a documented consequence rather than an unexplained disappearance.",
          citedClaimIds: ["claim-public-response"],
          citedSourceIds: ["source-court-archive"],
        },
        shots: [
          coverageShot({ id: "cinematic-shot-response-proof", t0: 12, t1: 16, purpose: "evidence_insert", mode: "source_proof", scale: "extreme_close", move: "truck_right", cut: "reveal", tension: "reversal", sourceProofMedia: sourceProofMediaObligation() }),
          coverageShot({ id: "cinematic-shot-response-map", t0: 16, t1: 20, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "wide", move: "orbit_left", cut: "new_relationship", tension: "release" }),
          coverageShot({ id: "cinematic-shot-response-aftermath", t0: 20, t1: 24, purpose: "aftermath", mode: "atmosphere", scale: "establishing", move: "dolly_pull", cut: "breath", tension: "residue" }),
        ],
      },
    ],
    editorialReview: {
      id: "cinematic-sequence-review-vault-closure-001", decision: "approved", reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 20 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedEvidenceShotMapFingerprint: map.map.contentFingerprint,
      reviewedSequenceFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(input);
  return input;
}

async function main() {
  const map = admittedMap();
  const sourceBoundStorySpine = sourceBoundStorySpineFor(map);
  const input = approvedSequence(map);
  const args = { input, sourcePacket, sourceAdmission: admittedSource.receipt, evidenceShotMap: map.map, evidenceShotMapAdmission: map.receipt, sceneManifest, shotList };

  // The route is now reachable without hand-authoring every LTX shot. The
  // deterministic planner may draft coverage, but cannot manufacture the
  // legally required human crime-editor signature.
  const draft = planCinematicCaseSequenceDraft({
    direction: {
      version: CINEMATIC_CASE_DIRECTION_VERSION,
      sequenceId: "cinematic-sequence-vault-closure-draft",
      caseId: sourcePacket.caseId,
      causalQuestion: "Why did a single court order close the vault?",
      visualWorld: "restrained nocturnal archival documentary, rain-softened stone, muted charcoal and amber practical light",
      cast: input.cast,
    },
    evidenceShotMap: map.map,
    sceneManifest,
    shotList,
  });
  assert.equal(draft.release, "private_human_editorial_review_required");
  assert.equal(draft.content.beats.length, shotList.length);
  assert.equal(draft.content.beats[0]?.narrativeRole, "cold_open");
  assert.equal(draft.content.beats.at(-1)?.narrativeRole, "reveal", "a two-window source spine must earn its cold open with a cited reveal");
  const draftedPayoff = draft.content.beats.find((beat) => beat.storyPayoff)?.storyPayoff;
  assert.ok(draftedPayoff, "the deterministic cinematic draft must bind its later reveal to the cold-open question");
  assert.equal(draftedPayoff.coldOpenBeatId, draft.content.beats[0]?.id);
  assert(
    draft.content.beats.flatMap((beat) => beat.shots).every((shot) => shot.t1 - shot.t0 >= 3),
    "every generated Casefile coverage shot must retain LTX's minimum renderable duration rather than relying on post-render trimming",
  );
  assert.equal(draft.content.beats[0]?.shots.length, 4, "a 12s causal beat earns four purposeful renderable coverage shots");
  assert.equal(draft.content.beats[0]?.shots[1]?.coveragePurpose, "mannequin_action");
  assert.equal(draft.content.beats[0]?.shots[1]?.visualMode, "abstract_reenactment");
  assert.match(draft.content.beats[0]?.shots[1]?.still ?? "", /charcoal wool coat/i);
  assert.match(draft.content.beats[0]?.shots[1]?.motion ?? "", /without revealing a face/i);
  assert.equal(draft.content.beats[0]?.shots[2]?.coveragePurpose, "evidence_insert");
  assert.equal(draft.content.beats[0]?.shots[3]?.coveragePurpose, "reaction");
  assert.equal(
    draft.content.beats[1]?.shots[1]?.coveragePurpose,
    "relationship",
    "a documentary/timeline beat must use a purpose-specific relationship shot instead of mislabeling generic atmosphere as mannequin action",
  );
  assert.equal(
    draft.content.beats[1]?.shots[1]?.castIds.length,
    0,
    "non-reenactment relationship coverage must not invent a mannequin cast",
  );
  assert.match(
    draft.content.beats[1]?.shots[1]?.motion ?? "",
    /admitted relationship/i,
    "the non-reenactment second angle must describe the cited relationship rather than generic atmosphere movement",
  );
  // The deterministic draft intentionally cannot choose a source asset. A
  // human editor attaches the exact approved source-proof obligation before
  // signing it; without that attachment, final admission must fail before
  // LTX can invent a document approximation.
  const reviewedDraft = structuredClone(draft);
  for (const beat of reviewedDraft.content.beats) {
    for (const shot of beat.shots) {
      if (shot.visualMode === "source_proof") shot.sourceProofMedia = sourceProofMediaObligation();
    }
  }
  reviewedDraft.sequenceContentFingerprint = cinematicCaseSequenceContentFingerprint(reviewedDraft.content);
  const draftReview = {
    id: "cinematic-sequence-review-vault-closure-draft",
    decision: "approved" as const,
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: new Date(NOW.getTime() - 10 * 60 * 1_000).toISOString(),
    reviewedSourcePacketFingerprint: reviewedDraft.content.sourcePacketFingerprint,
    reviewedEvidenceShotMapFingerprint: reviewedDraft.content.evidenceShotMapFingerprint,
    reviewedSequenceFingerprint: reviewedDraft.sequenceContentFingerprint,
  };
  const finalizedDraft = finalizeCinematicCaseSequenceDraft({ draft: reviewedDraft, editorialReview: draftReview });
  const draftedReport = evaluateCinematicCaseSequence({ ...args, input: finalizedDraft }, { now: NOW });
  assert.equal(draftedReport.safe, true, JSON.stringify(draftedReport.issues));
  assert.throws(
    () => finalizeCinematicCaseSequenceDraft({ draft: reviewedDraft, editorialReview: { ...draftReview, reviewedSequenceFingerprint: "0".repeat(64) } }),
    /not bound to this exact source packet/i,
  );
  const tooShortSourceWindows = shotList.map((shot, index) => ({
    ...shot,
    t0: index * 4,
    t1: (index + 1) * 4,
    seconds: 4,
  }));
  assert.throws(
    () => planCinematicCaseSequenceDraft({
      direction: {
        version: CINEMATIC_CASE_DIRECTION_VERSION,
        sequenceId: "cinematic-sequence-vault-closure-short-window",
        caseId: sourcePacket.caseId,
        causalQuestion: "Why did a single court order close the vault?",
        visualWorld: "restrained nocturnal archival documentary, rain-softened stone, muted charcoal and amber practical light",
        cast: input.cast,
      },
      evidenceShotMap: map.map,
      sceneManifest,
      shotList: tooShortSourceWindows,
    }),
    /at least 9s of contiguous narration/i,
    "a Casefile plan may not create three sub-three-second LTX clips from a short narrated window",
  );

  const report = evaluateCinematicCaseSequence(args, { now: NOW });
  assert.equal(report.safe, true, JSON.stringify(report.issues));
  const admitted = assertCinematicCaseSequence(args, { now: NOW });
  assert.equal(admitted.generatedScenePlan.scenes.length, 6);
  assert.equal(admitted.editDecisionList.edits.length, 6);
  assert.equal(admitted.creativeLocks.locks.length, 6);
  assert.equal(admitted.receipt.release, "private_human_editorial_review_only");

  // A ledger is optional for legacy reviewed Casefiles, but when selected it
  // becomes a signed source/claim/Story-Spine/treatment rail all the way to
  // final-master QA. It may not quietly become a prompt hint.
  const narrativeLedger = createNarrativeEvidenceLedger({
    subject: "Vault closure",
    evidenceRails: [{
      id: "rail-vault-casefile",
      kind: "casefile_source_packet",
      packetFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      sourceIds: ["source-court-archive"],
      upstreamClaimIds: ["claim-closure-order", "claim-public-response"],
    }],
    claims: [
      {
        id: "narrative-closure-order",
        approvedText: "The court finding ordered the vault's closure.",
        assertionState: "established",
        confidence: "high",
        uncertainty: { level: "none", summary: "The cited court finding records the order." },
        causalRole: "decision",
        supports: [{ railId: "rail-vault-casefile", sourceIds: ["source-court-archive"], upstreamClaimIds: ["claim-closure-order"] }],
        allowedVisualTreatments: [
          { kind: "source_proof", onScreenCitation: true, exactSourceAssetRequired: true },
          { kind: "neutral_reenactment", visiblyLabeled: true, disclosureText: RECONSTRUCTION_DISCLOSURE, anonymousDepictionOnly: true, doesNotClaimDirectObservation: true },
          { kind: "ambient_context", doesNotDepictClaimAsObserved: true },
        ],
      },
      {
        id: "narrative-public-response",
        approvedText: "The documented closure prompted public response.",
        assertionState: "established",
        confidence: "high",
        uncertainty: { level: "none", summary: "The cited record establishes the documented response." },
        causalRole: "consequence",
        supports: [{ railId: "rail-vault-casefile", sourceIds: ["source-court-archive"], upstreamClaimIds: ["claim-public-response"] }],
        allowedVisualTreatments: [
          { kind: "source_proof", onScreenCitation: true, exactSourceAssetRequired: true },
          { kind: "ambient_context", doesNotDepictClaimAsObserved: true },
        ],
      },
    ],
    editorialReview: { reviewerId: "reviewer-documentary-desk", reviewId: "narrative-ledger-vault-001", reviewedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() },
    now: NOW.getTime(),
  });
  const ledgerInput = { ...input, narrativeEvidenceLedgerFingerprint: narrativeLedger.contentFingerprint };
  ledgerInput.editorialReview = {
    ...ledgerInput.editorialReview,
    reviewedSequenceFingerprint: cinematicCaseSequenceContentFingerprint(ledgerInput),
  };
  const ledgerAdmitted = assertCinematicCaseSequence({
    ...args,
    input: ledgerInput,
    sourcePacket,
    narrativeEvidenceLedger: narrativeLedger,
    sourceBoundStorySpine,
  }, { now: NOW });
  assert.equal(ledgerAdmitted.receipt.narrativeEvidenceLedgerFingerprint, narrativeLedger.contentFingerprint);
  assert.equal(ledgerAdmitted.generatedScenePlan.narrativeEvidenceLedgerFingerprint, narrativeLedger.contentFingerprint);
  assert.equal(
    admitCinematicFinalMasterQa({ creativeLocks: ledgerAdmitted.creativeLocks, editDecisionList: ledgerAdmitted.editDecisionList }).narrativeEvidenceLedgerFingerprint,
    narrativeLedger.contentFingerprint,
  );
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: ledgerInput, sourcePacket, narrativeEvidenceLedger: narrativeLedger }, { now: NOW }),
    /narrative_evidence_ledger_invalid/i,
    "a ledger-bearing cinematic sequence must retain the current source-bound Story Spine at admission",
  );

  // An optional mechanics packet is useful only when it is tied to an
  // attributed, reviewed source contract and the exact current ShotPlan. It
  // must alter the cinematic handoff while never making the normal path wait
  // for an unrelated reference study.
  const referenceQuality = referenceQualityContractFor("documentary_collage_short");
  const mechanics = (guidance: string) => ({
    guidance,
    sourceIds: [referenceQuality.sources[0]!.id],
  });
  const referenceMechanicsPacket = createReferenceMechanicsPacket({
    referenceQuality,
    shotList,
    mechanics: {
      openingPromisePayoff: mechanics("Open on the sourced question, then earn a cited consequence that reframes it."),
      beatVisualRhythm: mechanics("Change visual information only when a beat earns new geography, evidence, or consequence."),
      narrationPaceClarity: mechanics("Leave clean causal space around the key factual turn; do not overstuff the narration."),
      cutSceneFunction: mechanics("Every cut should reveal a new fact, relationship, location, action, or controlled breath."),
      audioRelationship: mechanics("Keep physical location tone subordinate to the narrator and motivate it from visible action only."),
      recurringIdentity: mechanics("Retain original faceless wardrobe, silhouette, prop, and palette locks across related shots."),
      exclusions: mechanics("No copied phrasing, branded composition, signature sound, recognizable likeness, borrowed footage, or direct source comparison."),
    },
    review: {
      id: "reference-mechanics-review-vault-closure-001",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 10 * 60 * 1_000).toISOString(),
    },
    now: NOW,
  });
  const withMechanics = assertCinematicCaseSequence({
    ...args,
    referenceMechanicsPacket,
    referenceQuality,
  }, { now: NOW });
  assert.equal(
    withMechanics.generatedScenePlan.referenceMechanicsPacketFingerprint,
    referenceMechanicsPacket.contentFingerprint,
    "the cinematic render handoff must retain the exact reviewed mechanics provenance",
  );
  assert.equal(
    withMechanics.creativeLocks.referenceMechanicsPacketFingerprint,
    referenceMechanicsPacket.contentFingerprint,
    "final-master QA receives the same mechanics provenance without a competitor comparison",
  );
  assert.equal(
    admitCinematicFinalMasterQa({
      creativeLocks: withMechanics.creativeLocks,
      editDecisionList: withMechanics.editDecisionList,
    }).referenceMechanicsPacketFingerprint,
    referenceMechanicsPacket.contentFingerprint,
    "final-master QA admission must carry the exact reviewed mechanics packet rather than losing it after render planning",
  );
  assert.throws(
    () => admitCinematicFinalMasterQa({
      creativeLocks: withMechanics.creativeLocks,
      editDecisionList: {
        ...withMechanics.editDecisionList,
        referenceMechanicsPacketFingerprint: "0".repeat(64),
      },
    }),
    /mechanics provenance from different review packets/i,
    "final-master QA must reject a mechanics fingerprint swapped after cinematic admission",
  );
  assert.match(
    withMechanics.generatedScenePlan.scenes[0]!.still,
    /Mechanics-only original expression/i,
    "reviewed original-expression mechanics must reach the actual still/I2V prompt rather than a dead reviewer note",
  );
  assert.match(
    withMechanics.generatedScenePlan.scenes[0]!.diegeticSoundscape,
    /original audio relationship/i,
    "the approved audio relationship must reach the individual take's sound plan",
  );
  assert.match(
    withMechanics.creativeLocks.locks[0]!.acceptanceCriteria.join(" "),
    /approved original editorial mechanics/i,
    "final-master visual QA must receive the approved mechanics as reviewer-facing criteria, not only an opaque fingerprint",
  );
  const staleMechanics = structuredClone(referenceMechanicsPacket);
  staleMechanics.openingPromisePayoff.guidance = "A changed opening must force fresh editorial review.";
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, referenceMechanicsPacket: staleMechanics, referenceQuality }, { now: NOW }),
    /reference_mechanics_invalid:.*content fingerprint/i,
    "a mechanics change must invalidate the editor's signed packet before it can influence a cinematic render",
  );
  assert.notEqual(
    referenceMechanicsPacketContentFingerprint({
      ...referenceMechanicsPacket,
      openingPromisePayoff: mechanics("A different source-bound opening promise."),
    }),
    referenceMechanicsPacket.contentFingerprint,
    "the mechanics fingerprint must cover every transferable instruction",
  );

  const missingStoryPayoff = structuredClone(input);
  delete missingStoryPayoff.beats[1]!.storyPayoff;
  missingStoryPayoff.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(missingStoryPayoff);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: missingStoryPayoff }, { now: NOW }),
    /story_payoff_invalid:.*explicitly answers or reframes.*Remediation:/,
    "a generic reveal cannot stand in for a source-bound payoff to the opening question",
  );
  const mannequinScene = admitted.generatedScenePlan.scenes[1]!;
  assert.equal(mannequinScene.id, "cinematic-shot-closure-figure");
  assert.match(mannequinScene.still, /tall square-shouldered faceless silhouette/i);
  assert.match(mannequinScene.still, /charcoal wool coat/i);
  assert.match(mannequinScene.still, /sealed court folio/i);
  assert.match(mannequinScene.still, /case-file-neutral/i);
  assert.match(mannequinScene.still, /Why did a single court order close the vault\?/i);
  assert.match(mannequinScene.still, /Make the narrated mannequin action concrete/i);
  assert.match(mannequinScene.motion, /deliberate measured gait/i);
  assert.match(
    mannequinScene.motion,
    /Approved camera treatment: dolly_push/i,
    "the exact structured camera move must reach the LTX motion prompt rather than relying on an unstructured motion description",
  );
  assert.match(mannequinScene.motion, /Narrative role cold_open/i);
  assert.match(mannequinScene.motion, /First frame: Start from the exact cited story state/i);
  assert.match(mannequinScene.motion, /Last frame: End with only motivated action advanced/i);
  assert.match(
    admitted.creativeLocks.locks[1]!.acceptanceCriteria.join(" "),
    /causal question/i,
    "final master QA must receive the explicit story question that the shot was generated to answer",
  );
  assert.match(
    admitted.creativeLocks.locks[1]!.acceptanceCriteria.join(" "),
    /medium framing and dolly_push camera treatment/i,
    "final master QA must explicitly attest the planned cinematic framing and motivated movement, not treat camera direction as prompt-only metadata",
  );
  assert.equal(
    mannequinScene.continuitySeed,
    cinematicContinuitySeed(admitted.plan.contentFingerprint, mannequinScene.castIds, mannequinScene.id),
    "the mannequin's approved sequence/cast identity must deterministically control its still-generation seed",
  );
  assert.equal(
    cinematicContinuitySeed(admitted.plan.contentFingerprint, ["mannequin-investigator"], "new-shot-angle"),
    mannequinScene.continuitySeed,
    "new angles of the same mannequin cast must retain the same image prior",
  );
  assert.notEqual(
    cinematicContinuitySeed(admitted.plan.contentFingerprint, [], "cinematic-shot-closure-proof"),
    cinematicContinuitySeed(admitted.plan.contentFingerprint, [], "cinematic-shot-closure-space"),
    "independent evidence and atmosphere shots must not inherit a mannequin identity seed",
  );

  const semanticTailToken = "SOURCE-CAUSE-TAIL-LOCK";
  const semanticTailInput = structuredClone(input);
  const semanticTailPrefix = "Make the cited causal consequence clear without changing any approved fact. ";
  semanticTailInput.beats[0]!.shots[1]!.narrationPurpose =
    `${semanticTailPrefix}${"x".repeat(360 - semanticTailPrefix.length - semanticTailToken.length - 1)} ${semanticTailToken}`;
  assert.equal(semanticTailInput.beats[0]!.shots[1]!.narrationPurpose.length, 360);
  semanticTailInput.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(semanticTailInput);
  const semanticTailAdmitted = assertCinematicCaseSequence({ ...args, input: semanticTailInput }, { now: NOW });
  const semanticTailScene = semanticTailAdmitted.generatedScenePlan.scenes.find(
    (scene) => scene.id === "cinematic-shot-closure-figure",
  )!;
  assert.match(semanticTailScene.still, new RegExp(semanticTailToken));
  assert.match(semanticTailScene.motion, new RegExp(semanticTailToken));
  assert.match(semanticTailScene.terminalStill ?? "", new RegExp(semanticTailToken));
  for (const prompt of [semanticTailScene.still, semanticTailScene.terminalStill ?? ""]) {
    assert.match(
      prompt,
      /People lock: only declared faceless mannequin cast \([^)]*\)/,
      "the no-extra-people instruction must survive alongside a maximum-length signed narration purpose",
    );
  }
  assert.match(
    semanticTailScene.negative,
    /no extra people, mannequins, bystanders, crowds, human silhouettes, portraits, or reflections/,
    "the LTX motion phase must retain the same no-extra-people instruction in its dedicated negative prompt",
  );
  assert.equal(
    semanticTailAdmitted.creativeLocks.locks.find((lock) => lock.id === semanticTailScene.id)!.acceptanceCriteria[0],
    semanticTailInput.beats[0]!.shots[1]!.narrationPurpose,
    "the final-master reviewer must receive every signed narration-purpose character, including the tail source/cause qualifier",
  );

  const staleReview = structuredClone(input);
  staleReview.editorialReview.reviewedAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1_000).toISOString();
  assert.throws(() => assertCinematicCaseSequence({ ...args, input: staleReview }, { now: NOW }), /editorial_review_stale:.*Remediation:/);

  const wardrobeChange = structuredClone(input);
  wardrobeChange.cast[0].wardrobeSignature = "blue rain jacket, white trainers, canvas satchel";
  assert.throws(() => assertCinematicCaseSequence({ ...args, input: wardrobeChange }, { now: NOW }), /editorial_review_mismatch:.*Remediation:/);

  const subThreeSecondTake = structuredClone(input);
  subThreeSecondTake.beats[0].shots[0].t1 = 2.5;
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: subThreeSecondTake }, { now: NOW }),
    /sequence_input_invalid:.*Remediation:/,
    "even a reviewer-signed manual Casefile sequence may not send an unrenderable sub-three-second take to LTX",
  );

  const inventedSourceProof = structuredClone(input);
  delete inventedSourceProof.beats[1]!.shots[0]!.sourceProofMedia;
  inventedSourceProof.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(inventedSourceProof);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: inventedSourceProof }, { now: NOW }),
    /story_payoff_invalid:.*exact approved source-proof asset|source_proof_media_invalid:.*without an exact approved source asset/i,
    "a factual payoff may not send a source-proof document through LTX when no exact approved source asset is attached",
  );

  const mislabeledAtmosphereAction = structuredClone(input);
  mislabeledAtmosphereAction.beats[1]!.shots[1]!.coveragePurpose = "mannequin_action";
  mislabeledAtmosphereAction.beats[1]!.shots[1]!.visualMode = "atmosphere";
  mislabeledAtmosphereAction.beats[1]!.shots[1]!.castIds = [];
  mislabeledAtmosphereAction.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(mislabeledAtmosphereAction);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: mislabeledAtmosphereAction }, { now: NOW }),
    /coverage_grammar_invalid:.*mannequin_action exactly/i,
    "a generic atmosphere plate may not masquerade as a mannequin action merely to satisfy multi-shot coverage grammar",
  );

  const flatCoverage = structuredClone(input);
  flatCoverage.beats[1].shots.forEach((shot) => { shot.shotScale = "wide"; });
  flatCoverage.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(flatCoverage);
  assert.throws(() => assertCinematicCaseSequence({ ...args, input: flatCoverage }, { now: NOW }), /coverage_grammar_invalid:.*Remediation:/);

  const unsupportedColdOpen = structuredClone(input);
  unsupportedColdOpen.beats[0].shots[0].coveragePurpose = "spatial_anchor";
  unsupportedColdOpen.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(unsupportedColdOpen);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: unsupportedColdOpen }, { now: NOW }),
    /coverage_grammar_invalid:.*exact approved source-proof evidence insert.*Remediation:/,
    "a cinematic Casefile hook cannot spend its opening beat on unsupported reconstruction or atmosphere before showing a source object",
  );

  const flatTension = structuredClone(input);
  flatTension.beats.forEach((beat) => beat.shots.forEach((shot) => { shot.tensionState = "pressure"; }));
  flatTension.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(flatTension);
  assert.throws(() => assertCinematicCaseSequence({ ...args, input: flatTension }, { now: NOW }), /tension_grammar_invalid:.*Remediation:/);

  const restartedColdOpen = structuredClone(input);
  restartedColdOpen.beats[1].narrativeRole = "cold_open";
  restartedColdOpen.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(restartedColdOpen);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: restartedColdOpen }, { now: NOW }),
    /tension_grammar_invalid:.*single opening question.*Remediation:/,
    "a sequence cannot reset its hook instead of progressing the source-bound story",
  );

  const unresolvedEnding = structuredClone(input);
  unresolvedEnding.beats.at(-1)!.shots.at(-1)!.tensionState = "pressure";
  unresolvedEnding.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(unresolvedEnding);
  assert.throws(
    () => assertCinematicCaseSequence({ ...args, input: unresolvedEnding }, { now: NOW }),
    /tension_grammar_invalid:.*release or residue beat.*Remediation:/,
    "the final narrated beat must earn a controlled payoff or residue",
  );

  const logs: string[] = [];
  const draftBlock = cinematicCaseSequenceBlocks.find((block) => block.id === "cinematic_case_sequence_draft");
  const finalizeBlock = cinematicCaseSequenceBlocks.find((block) => block.id === "cinematic_case_sequence_finalize");
  const admissionBlock = cinematicCaseSequenceBlocks.find((block) => block.id === "cinematic_case_sequence");
  assert.ok(draftBlock && finalizeBlock && admissionBlock, "cinematic route must expose draft, human-signature, and admission stages");
  const cinematicDirection = {
    version: CINEMATIC_CASE_DIRECTION_VERSION,
    sequenceId: "cinematic-sequence-vault-closure-draft-block",
    caseId: sourcePacket.caseId,
    causalQuestion: "Why did a single court order close the vault?",
    visualWorld: "restrained nocturnal archival documentary, rain-softened stone, muted charcoal and amber practical light",
    cast: input.cast,
  };
  const draftBlockContext = (handoff: unknown) => ({
    ownerId: "owner-test",
    runId: "run-cinematic-case-sequence-draft",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      cinematicCaseDirection: cinematicDirection,
      casefileEvidenceShotMap: map.map,
      ...(handoff === undefined ? {} : { sourceBoundStorySpine: handoff }),
      sceneManifest,
      shotList,
    },
    budgetUsd: 0,
    log: (message: string) => logs.push(message),
  });
  await assert.rejects(
    () => draftBlock.run(draftBlockContext(undefined)),
    /source-bound Story Spine handoff is missing or invalid/i,
    "the cinematic direction stage must not create a draft without the private source-bound Story Spine",
  );
  await assert.rejects(
    () => draftBlock.run(draftBlockContext({
      ...sourceBoundStorySpine,
      evidenceShotMapFingerprint: "0".repeat(64),
    })),
    /source-bound Story Spine handoff is stale or mismatched/i,
    "a handoff from an older evidence-map revision must fail before cinematic sequence creation",
  );
  await assert.rejects(
    () => draftBlock.run(draftBlockContext({
      ...sourceBoundStorySpine,
      caseId: "case-unrelated-record",
    })),
    /source-bound Story Spine handoff is stale or mismatched/i,
    "a valid-looking handoff for a different Casefile must fail before cinematic sequence creation",
  );
  const draftPatch = await draftBlock.run({
    ownerId: "owner-test",
    runId: "run-cinematic-case-sequence-draft",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      cinematicCaseDirection: cinematicDirection,
      casefileEvidenceShotMap: map.map,
      sourceBoundStorySpine,
      sceneManifest,
      shotList,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  const blockDraft = draftPatch.cinematicCaseSequenceDraft;
  assert.ok(blockDraft);
  const reviewedBlockDraft = structuredClone(blockDraft) as {
    content: CinematicCaseSequenceContent;
    sequenceContentFingerprint: string;
  };
  for (const beat of reviewedBlockDraft.content.beats) {
    for (const shot of beat.shots) {
      if (shot.visualMode === "source_proof") shot.sourceProofMedia = sourceProofMediaObligation();
    }
  }
  reviewedBlockDraft.sequenceContentFingerprint = cinematicCaseSequenceContentFingerprint(reviewedBlockDraft.content);
  const finalizePatch = await finalizeBlock.run({
    ownerId: "owner-test",
    runId: "run-cinematic-case-sequence-finalize",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      cinematicCaseSequenceDraft: reviewedBlockDraft,
      cinematicSequenceEditorialReview: {
        ...draftReview,
        reviewedSequenceFingerprint: reviewedBlockDraft.sequenceContentFingerprint,
      },
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  const patch = await admissionBlock.run({
    ownerId: "owner-test",
    runId: "run-cinematic-case-sequence",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      casefileSourcePacket: sourcePacket,
      casefileSourceAdmission: admittedSource.receipt,
      casefileEvidenceShotMap: map.map,
      casefileEvidenceShotMapAdmission: map.receipt,
      sourceBoundStorySpine,
      cinematicCaseSequenceInput: (() => {
        const reviewedInput = structuredClone(
          finalizePatch.cinematicCaseSequenceInput,
        ) as CinematicCaseSequenceInput;
        // This models a human attaching the independently reviewed mechanics
        // packet before signing the final cinematic sequence. The packet now
        // has a real typed path into prompt construction and QA rather than
        // existing only as an external engine-test argument.
        reviewedInput.referenceMechanicsPacket = referenceMechanicsPacket;
        reviewedInput.editorialReview.reviewedSequenceFingerprint =
          cinematicCaseSequenceContentFingerprint(reviewedInput);
        return reviewedInput;
      })(),
      sceneManifest,
      shotList,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal(
    (patch.cinematicCaseSequenceAdmission as { release: string }).release,
    "private_human_editorial_review_only",
  );
  assert.equal((patch.cinematicGeneratedScenePlan as { scenes: unknown[] }).scenes.length, 8);
  assert.equal(
    (patch.cinematicGeneratedScenePlan as { referenceMechanicsPacketFingerprint?: string })
      .referenceMechanicsPacketFingerprint,
    referenceMechanicsPacket.contentFingerprint,
    "the live cinematic block must retain signed mechanics provenance into its LTX scene handoff",
  );
  assert.match(
    (patch.cinematicGeneratedScenePlan as { scenes: { diegeticSoundscape?: string }[] }).scenes[0]!.diegeticSoundscape ?? "",
    /Diegetic only:/,
    "each generated cinematic take must carry its own physical sound direction into LTX",
  );
  assert.match(
    (patch.cinematicGeneratedScenePlan as { scenes: { still?: string }[] }).scenes[0]!.still ?? "",
    /Mechanics-only original expression/i,
    "the optional signed mechanics packet must reach live still/I2V prompts through the cinematic block",
  );
  assert.match(logs.join("\n"), /awaiting human editorial signature/);
  assert.match(logs.join("\n"), /reviewer signature bound to exact draft/);
  assert.match(logs.join("\n"), /provider calls: 0/);

  console.log("cinematic case sequence tests passed");
}

main().catch((error) => {
  throw error;
});
