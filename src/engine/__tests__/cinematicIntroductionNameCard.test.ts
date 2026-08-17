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
import { createSourceBoundStorySpineHandoff } from "@/engine/sourceBoundStorySpine";

/**
 * End-to-end behavioral test for the new `introduction` narrativeRole and
 * its narrow on-screen name-card exception. This exercises the REAL
 * `evaluateCinematicCaseSequence`/`assertCinematicCaseSequence` admission
 * path (not just schema shape) with a full, self-contained three-beat
 * fixture — cold_open, introduction, reveal — modeled closely on the
 * existing cinematicCaseSequence.test.ts fixture.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-archive-team",
  casePacket: {
    version: "casefile/v1",
    id: "case-archive-team",
    title: "The Archive Team",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-court-archive",
      kind: "court_record",
      title: "Case assignment finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/archive-team",
      excerpt: "The finding records the team's formation, its lead investigator, and its final determination.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://court.example.org/rights/archive-team-license",
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
        id: "claim-lead-named",
        order: 20,
        text: "The court record names the lead investigator assigned to the case.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "none",
      },
      {
        id: "claim-team-verdict",
        order: 30,
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
    { claimId: "claim-team-formed", sourceId: "source-court-archive", primarySourceUrl: "https://court.example.org/records/archive-team", provenance: "court_record" },
    { claimId: "claim-lead-named", sourceId: "source-court-archive", primarySourceUrl: "https://court.example.org/records/archive-team", provenance: "court_record" },
    { claimId: "claim-team-verdict", sourceId: "source-court-archive", primarySourceUrl: "https://court.example.org/records/archive-team", provenance: "court_record" },
  ],
  sourceUsage: [{
    sourceId: "source-court-archive",
    usage: "visual_media",
    assetId: "asset-court-archive-team-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/archive-team-license",
  }],
  editorialReview: {
    id: "editorial-review-archive-team-001",
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
  durationSec: 30,
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
      id: "scene-lead-named", beatId: "beat-lead-named", t0: 12, t1: 18, kind: "claim" as const,
      label: "The court record names the lead investigator assigned to the case.",
      characterIds: [], camera: { framing: "medium" as const, move: "static" as const },
      visualState: { action: "A faceless investigator figure is named on screen before acting.", props: ["folio"] },
      text: "The court record names the lead investigator assigned to the case.",
      causalInputBeatIds: ["beat-team-formed"], sourceRefs: ["source-court-archive"], transition: "cut" as const,
    },
    {
      id: "scene-team-verdict", beatId: "beat-team-verdict", t0: 18, t1: 30, kind: "result" as const,
      label: "The documented verdict names the team's final determination.",
      characterIds: [], camera: { framing: "wide" as const, move: "pan" as const },
      visualState: { action: "A neutral timeline connects the verdict to the case record.", props: ["timeline"] },
      text: "The documented verdict names the team's final determination.",
      causalInputBeatIds: ["beat-lead-named"], sourceRefs: ["source-court-archive"], transition: "dissolve" as const,
    },
  ],
  fingerprint: "a".repeat(64),
  topic: "The Archive Team",
  audience: "general" as const,
  seriesId: "series-archive-files",
  episodeId: "episode-archive-team",
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
    id: "shot-lead-named", beatId: "beat-lead-named", sourceSentenceIds: ["sentence-lead-named"], t0: 12, t1: 18,
    coveragePurpose: "Show the named lead investigator before they act.",
    literalContent: "A neutral faceless investigator figure identified by the record.",
    entities: [], era: "historical", wardrobe: ["charcoal coat"], props: ["folio"], continuityState: "case-file-neutral",
    cameraMove: "static" as const, shotScale: "medium" as const, lens: "50mm", lighting: "soft neutral archive light",
    motion: "subtle held frame", negative: "no gore, no real-person likeness", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral faceless investigator figure identified by the cited record.", seconds: 6, storyFunction: "introduction", section: "lead", seed: 2,
  },
  {
    id: "shot-team-verdict", beatId: "beat-team-verdict", sourceSentenceIds: ["sentence-team-verdict"], t0: 18, t1: 30,
    coveragePurpose: "Show a cited verdict timeline.",
    literalContent: "A neutral timeline connecting the documented verdict dates.",
    entities: [], era: "historical", wardrobe: [], props: ["timeline"], continuityState: "case-file-neutral",
    cameraMove: "truck_right" as const, shotScale: "wide" as const, lens: "35mm", lighting: "neutral archive light",
    motion: "slow timeline reveal", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral cited timeline of the documented verdict.", seconds: 12, storyFunction: "context", section: "verdict", seed: 3,
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
        claimId: "claim-lead-named",
        bindings: [
          { sceneIds: ["scene-lead-named"], shotIds: ["shot-lead-named"], treatment: "neutral_reenactment", sourceIds: ["source-court-archive"], onScreenCitation: true, reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE },
        ],
      },
      {
        claimId: "claim-team-verdict",
        bindings: [{ sceneIds: ["scene-team-verdict"], shotIds: ["shot-team-verdict"], treatment: "timeline", sourceIds: ["source-court-archive"], onScreenCitation: true }],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-archive-team-001",
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

function sourceBoundStorySpineFor(map: ReturnType<typeof admittedMap>) {
  const storySpine = {
    version: "1.0.0" as const,
    timedScript: {
      version: "1.0.0" as const,
      narrationDurationSec: 30,
      sentences: [
        { id: "sentence-team-formed", text: "The court record documents when the investigation team was formed.", t0: 0, t1: 12, sectionId: "section-formed", evidenceRefs: ["source-court-archive"] },
        { id: "sentence-lead-named", text: "The court record names the lead investigator assigned to the case.", t0: 12, t1: 18, sectionId: "section-lead", evidenceRefs: ["source-court-archive"] },
        { id: "sentence-team-verdict", text: "The documented verdict names the team's final determination.", t0: 18, t1: 30, sectionId: "section-verdict", evidenceRefs: ["source-court-archive"] },
      ],
    },
    narrativeBeats: [
      { id: "beat-team-formed", sourceSentenceIds: ["sentence-team-formed"], t0: 0, t1: 12, purpose: "Establish the cited team formation.", evidenceRefs: ["source-court-archive"] },
      { id: "beat-lead-named", sourceSentenceIds: ["sentence-lead-named"], t0: 12, t1: 18, purpose: "Name the cited lead investigator.", evidenceRefs: ["source-court-archive"] },
      { id: "beat-team-verdict", sourceSentenceIds: ["sentence-team-verdict"], t0: 18, t1: 30, purpose: "Show the documented verdict.", evidenceRefs: ["source-court-archive"] },
    ],
    continuityLedger: {
      version: "1.0.0" as const,
      entities: [], locations: [], era: "historical",
      wardrobe: ["charcoal coat"], props: ["court document", "folio", "timeline"], palette: ["charcoal", "ash"],
      cameraGrammar: ["restrained"], negativeConstraints: ["no likeness", "no gore"],
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
      durationSec: 30,
      shots: shotList.map((shot) => ({ shotId: shot.id, sourceSentenceIds: shot.sourceSentenceIds, t0: shot.t0, t1: shot.t1 })),
    },
    coverage: { mappedSec: 30, totalSec: 30, ratio: 1, gaps: [] },
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
  id: string; t0: number; t1: number;
  purpose: "spatial_anchor" | "mannequin_action" | "relationship" | "evidence_insert" | "contradiction" | "consequence" | "reaction" | "aftermath";
  mode: "source_proof" | "spatial_reconstruction" | "abstract_reenactment" | "atmosphere";
  scale: "wide" | "medium" | "close" | "extreme_close" | "establishing";
  move: "static" | "dolly_push" | "dolly_pull" | "crane_up" | "crane_down" | "orbit_left" | "orbit_right" | "truck_left" | "truck_right" | "handheld_drift";
  cut: "new_fact" | "new_location" | "new_relationship" | "physical_action" | "contradiction" | "reveal" | "breath";
  tension: "question" | "orientation" | "pressure" | "uncertainty" | "reversal" | "release" | "residue";
  cast?: string[];
  nameCardText?: string;
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
    ...(args.nameCardText ? { nameCardText: args.nameCardText } : {}),
  };
}

function approvedSequence(map: ReturnType<typeof admittedMap>): CinematicCaseSequenceInput {
  const input: CinematicCaseSequenceInput = {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: "cinematic-sequence-archive-team-001",
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
          coverageShot({ id: "cinematic-shot-team-formed-proof", t0: 0, t1: 4, purpose: "evidence_insert", mode: "source_proof", scale: "close", move: "static", cut: "new_fact", tension: "question" }),
          coverageShot({ id: "cinematic-shot-team-formed-figure", t0: 4, t1: 8, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "medium", move: "dolly_push", cut: "physical_action", tension: "pressure", cast: ["mannequin-investigator"] }),
          coverageShot({ id: "cinematic-shot-team-formed-space", t0: 8, t1: 12, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "establishing", move: "crane_up", cut: "new_location", tension: "uncertainty" }),
        ],
      },
      {
        // The narrow name-card exception: the FIRST shot carries the reveal
        // typography, the SECOND shows the same mannequin acting with no
        // on-screen text at all — a distinct beat, not folded into ordinary
        // narration, matching the reference study's name-reveal-before-action
        // pattern.
        id: "cinematic-beat-lead-named", narrativeRole: "introduction", t0: 12, t1: 18, parentShotIds: ["shot-lead-named"],
        claimIds: ["claim-lead-named"], sourceIds: ["source-court-archive"], causalQuestion: "Who was named to lead the investigation?",
        shots: [
          coverageShot({ id: "cinematic-shot-lead-name", t0: 12, t1: 15, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "medium", move: "static", cut: "new_relationship", tension: "orientation", cast: ["mannequin-investigator"], nameCardText: "LEAD INVESTIGATOR — CASE FILE 118" }),
          coverageShot({ id: "cinematic-shot-lead-action", t0: 15, t1: 18, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "close", move: "dolly_push", cut: "physical_action", tension: "pressure", cast: ["mannequin-investigator"] }),
        ],
      },
      {
        id: "cinematic-beat-team-verdict", narrativeRole: "reveal", t0: 18, t1: 30, parentShotIds: ["shot-team-verdict"],
        claimIds: ["claim-team-verdict"], sourceIds: ["source-court-archive"], causalQuestion: "What did the documented verdict determine?",
        storyPayoff: {
          coldOpenBeatId: "cinematic-beat-team-formed",
          answerOrReframe: "The cited verdict reframes the team's work as a formally documented determination rather than an informal inquiry.",
          citedClaimIds: ["claim-team-verdict"],
          citedSourceIds: ["source-court-archive"],
        },
        shots: [
          coverageShot({ id: "cinematic-shot-verdict-proof", t0: 18, t1: 22, purpose: "evidence_insert", mode: "source_proof", scale: "close", move: "truck_right", cut: "reveal", tension: "reversal" }),
          coverageShot({ id: "cinematic-shot-verdict-map", t0: 22, t1: 26, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "wide", move: "orbit_left", cut: "new_relationship", tension: "release" }),
          coverageShot({ id: "cinematic-shot-verdict-aftermath", t0: 26, t1: 30, purpose: "aftermath", mode: "atmosphere", scale: "establishing", move: "dolly_pull", cut: "breath", tension: "residue" }),
        ],
      },
    ],
    editorialReview: {
      id: "cinematic-sequence-review-archive-team-001", decision: "approved", reviewerId: "reviewer-documentary-desk",
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
  const args = { input, sourceAdmission: admittedSource.receipt, evidenceShotMap: map.map, evidenceShotMapAdmission: map.receipt, sceneManifest, shotList };

  // ---- POSITIVE: the well-formed introduction beat is admitted -----------
  const report = evaluateCinematicCaseSequence(args);
  assert.equal(report.safe, true, `well-formed introduction beat must be admitted: ${JSON.stringify(report.issues.slice(0, 5))}`);

  const admitted = assertCinematicCaseSequence(args, { now: NOW });
  const scenes = admitted.generatedScenePlan.scenes;
  const nameScene = scenes.find((scene) => scene.id === "cinematic-shot-lead-name");
  const actionScene = scenes.find((scene) => scene.id === "cinematic-shot-lead-action");
  const coldOpenScene = scenes.find((scene) => scene.id === "cinematic-shot-team-formed-proof");
  assert.ok(nameScene, "the name-card shot must produce a generated scene");
  assert.ok(actionScene, "the sibling action shot must produce a generated scene");
  assert.ok(coldOpenScene, "the unrelated cold-open shot must produce a generated scene");

  // The reviewed name-card text reaches the actual LTX still/motion prompts
  // verbatim, and the standard "never render on-screen text" phrase is
  // replaced (not merely appended) for that one shot.
  assert.ok(nameScene!.still.includes("LEAD INVESTIGATOR — CASE FILE 118"), "name-card text must reach the still prompt");
  assert.ok(nameScene!.motion.includes("LEAD INVESTIGATOR — CASE FILE 118"), "name-card text must reach the motion prompt");
  assert.ok(nameScene!.still.includes("On-screen typography permitted"), "the still prompt must carry the narrow exception directive");
  assert.ok(!nameScene!.still.includes("never render this as on-screen text"), "the name-card shot must not also carry the blanket no-text directive");

  // The sibling "shown in action" shot in the SAME introduction beat still
  // gets the standard no-on-screen-text directive and no name text — the
  // exception is per-shot, not a blanket pass for the whole beat.
  assert.ok(actionScene!.still.includes("never render this as on-screen text"), "the sibling action shot (no nameCardText) must keep the standard directive");
  assert.ok(!actionScene!.still.includes("LEAD INVESTIGATOR"), "the sibling action shot must not carry the name-card text");

  // An unrelated cold-open shot is completely unaffected by the new
  // exception — the prohibition is not weakened for other roles.
  assert.ok(coldOpenScene!.still.includes("never render this as on-screen text"), "cold-open shots must keep the standard on-screen-text prohibition");

  // ---- NEGATIVE 1: nameCardText outside an introduction beat is rejected -
  const outsideIntro = structuredClone(input);
  (outsideIntro.beats[0]!.shots[0] as { nameCardText?: string }).nameCardText = "SHOULD NOT RENDER";
  const outsideIntroReport = evaluateCinematicCaseSequence({ ...args, input: outsideIntro });
  assert.equal(outsideIntroReport.safe, false, "nameCardText on a cold_open shot must be rejected");
  assert.ok(
    outsideIntroReport.issues.some((entry) => entry.code === "name_card_invalid"),
    `expected a name_card_invalid issue, got: ${JSON.stringify(outsideIntroReport.issues.map((entry) => entry.code))}`,
  );

  // ---- NEGATIVE 2: an introduction beat with no name-card text at all ----
  const noNameCard = structuredClone(input);
  delete (noNameCard.beats[1]!.shots[0] as { nameCardText?: string }).nameCardText;
  const noNameCardReport = evaluateCinematicCaseSequence({ ...args, input: noNameCard });
  assert.equal(noNameCardReport.safe, false, "an introduction beat with no nameCardText anywhere must be rejected");
  assert.ok(
    noNameCardReport.issues.some((entry) => entry.code === "name_card_invalid" && entry.message.includes("declares no on-screen name-card text")),
    `expected the 'declares no on-screen name-card text' issue, got: ${JSON.stringify(noNameCardReport.issues)}`,
  );

  // ---- NEGATIVE 3: a name-card shot with no locked mannequin cast --------
  const noCast = structuredClone(input);
  (noCast.beats[1]!.shots[0] as { castIds: string[] }).castIds = [];
  const noCastReport = evaluateCinematicCaseSequence({ ...args, input: noCast });
  assert.equal(noCastReport.safe, false, "a name-card shot with no cast must be rejected");
  assert.ok(
    noCastReport.issues.some((entry) => entry.code === "name_card_invalid" && entry.message.includes("no locked mannequin cast to introduce")),
    `expected the 'no locked mannequin cast to introduce' issue, got: ${JSON.stringify(noCastReport.issues)}`,
  );

  console.log("cinematic introduction beat / name-card exception behavioral test passed");
}

main();
