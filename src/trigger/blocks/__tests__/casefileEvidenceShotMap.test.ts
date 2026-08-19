import assert from "node:assert/strict";

import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  assertCasefileEvidenceShotMap,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  evaluateCasefileEvidenceShotMap,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import { casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { casefileEvidenceShotMapBlocks } from "../casefileEvidenceShotMapBlocks";

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
    sourceLedger: [
      {
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
      },
      {
        id: "source-city-paper",
        kind: "archival_news",
        title: "Public response to the closure",
        publisher: "City Paper Archive",
        locator: "https://news.example.org/archive/vault-closure",
        excerpt: "The archive reports the documented public response after the closure.",
        rights: {
          provenance: "unknown",
          visualUse: "citation_only",
        },
      },
    ],
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
        sourceIds: ["source-court-archive", "source-city-paper"],
        operationalRisk: "contextual",
      },
    ],
    sensitivity: {
      activeAllegations: false,
      involvesMinors: false,
      includesGraphicDetail: false,
      actionableWrongdoing: false,
    },
    reconstruction: { mode: "none" },
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
  sourceUsage: [
    {
      sourceId: "source-court-archive",
      usage: "visual_media",
      assetId: "asset-court-closure-finding",
      rightsEvidenceLocator: "https://court.example.org/rights/vault-closure-license",
    },
    { sourceId: "source-city-paper", usage: "citation_only" },
  ],
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
  durationSec: 30,
  scenes: [
    {
      id: "scene-closure-order",
      beatId: "beat-closure-order",
      t0: 0,
      t1: 15,
      kind: "claim" as const,
      label: "The court finding ordered the vault's closure.",
      characterIds: [],
      camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "Document abstract appears beside a date marker.", props: ["file", "date"] },
      text: "The court finding ordered the vault's closure.",
      causalInputBeatIds: [],
      sourceRefs: ["source-court-archive"],
      transition: "cut" as const,
    },
    {
      id: "scene-public-response",
      beatId: "beat-public-response",
      t0: 15,
      t1: 30,
      kind: "result" as const,
      label: "The documented closure prompted public response.",
      characterIds: [],
      camera: { framing: "wide" as const, move: "pan" as const },
      visualState: { action: "A neutral timeline connects response dates.", props: ["timeline"] },
      text: "The documented closure prompted public response.",
      causalInputBeatIds: ["beat-closure-order"],
      sourceRefs: ["source-court-archive", "source-city-paper"],
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
    t1: 15,
    coveragePurpose: "Show the court finding as a cited document abstraction.",
    literalContent: "A neutral court-record document abstraction with a visible citation.",
    entities: [],
    era: "historical",
    wardrobe: [],
    props: ["court document"],
    continuityState: "case-file-neutral",
    cameraMove: "static" as const,
    shotScale: "close" as const,
    lens: "50mm",
    lighting: "soft neutral archive light",
    motion: "subtle document parallax",
    negative: "no gore, no people, no reenactment",
    generationProfile: "production" as const,
    candidateCount: 1,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Neutral court-record document abstraction with cited provenance.",
    seconds: 15,
    storyFunction: "evidence",
    section: "closure",
    seed: 1,
  },
  {
    id: "shot-public-response",
    beatId: "beat-public-response",
    sourceSentenceIds: ["sentence-public-response"],
    t0: 15,
    t1: 30,
    coveragePurpose: "Show a cited public-response timeline.",
    literalContent: "A neutral timeline connecting the documented response dates.",
    entities: [],
    era: "historical",
    wardrobe: [],
    props: ["timeline"],
    continuityState: "case-file-neutral",
    cameraMove: "truck_right" as const,
    shotScale: "wide" as const,
    lens: "35mm",
    lighting: "neutral archive light",
    motion: "slow timeline reveal",
    negative: "no gore, no people, no reenactment",
    generationProfile: "production" as const,
    candidateCount: 1,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Neutral cited timeline of documented public response.",
    seconds: 15,
    storyFunction: "context",
    section: "response",
    seed: 2,
  },
];

const admittedSourcePacket = assertCasefileSourcePacket(sourcePacket, { now: NOW });

function approvedMap(): CasefileEvidenceShotMapInput {
  const input: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
    claimMappings: [
      {
        claimId: "claim-closure-order",
        bindings: [
          {
            sceneIds: ["scene-closure-order"],
            shotIds: ["shot-closure-order"],
            treatment: "document_abstraction",
            sourceIds: ["source-court-archive"],
            onScreenCitation: true,
          },
        ],
      },
      {
        claimId: "claim-public-response",
        bindings: [
          {
            sceneIds: ["scene-public-response"],
            shotIds: ["shot-public-response"],
            treatment: "timeline",
            sourceIds: ["source-court-archive"],
            onScreenCitation: true,
          },
        ],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-vault-closure-001",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  return input;
}

function assertBlocked(input: CasefileEvidenceShotMapInput, pattern: RegExp): void {
  assert.throws(
    () =>
      assertCasefileEvidenceShotMap({
        input,
        sourcePacket,
        sourceAdmission: admittedSourcePacket.receipt,
        sceneManifest,
        shotList,
      }, { now: NOW }),
    pattern,
  );
}

async function main(): Promise<void> {
  const input = approvedMap();
  const report = evaluateCasefileEvidenceShotMap({
    input,
    sourcePacket,
    sourceAdmission: admittedSourcePacket.receipt,
    sceneManifest,
    shotList,
  }, { now: NOW });
  assert.equal(report.safe, true, JSON.stringify(report.issues));

  const admitted = assertCasefileEvidenceShotMap({
    input,
    sourcePacket,
    sourceAdmission: admittedSourcePacket.receipt,
    sceneManifest,
    shotList,
  }, { now: NOW });
  assert.equal(admitted.map.contentFingerprint, casefileEvidenceShotMapContentFingerprint(input));
  assert.equal(admitted.receipt.sourcePacketFingerprint, admittedSourcePacket.receipt.sourcePacketFingerprint);
  assert.equal(admitted.receipt.release, "private_human_editorial_review_only");
  assert.equal(admitted.receipt.requiresHumanEditorialReview, true);
  assert.deepEqual(admitted.receipt.visualSafetyPolicy, { noGore: true, noUnsupportedRecreation: true });

  const logs: string[] = [];
  const patch = await casefileEvidenceShotMapBlocks[0].run({
    ownerId: "owner-test",
    runId: "run-casefile-evidence-shot-map",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      casefileSourcePacket: sourcePacket,
      casefileSourceAdmission: admittedSourcePacket.receipt,
      casefileEvidenceShotMapInput: input,
      sceneManifest,
      shotList,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal(
    (patch.casefileEvidenceShotMapAdmission as { release: string }).release,
    "private_human_editorial_review_only",
  );
  assert.match(logs.join("\n"), /provider calls: 0/);

  const missingClaim = approvedMap();
  missingClaim.claimMappings.pop();
  missingClaim.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(missingClaim);
  assertBlocked(missingClaim, /claim_mapping_missing:.*Remediation:/);

  const unknownTarget = approvedMap();
  unknownTarget.claimMappings[0].bindings[0].sceneIds = ["scene-not-in-plan"];
  unknownTarget.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(unknownTarget);
  assertBlocked(unknownTarget, /planned_target_unknown:.*Remediation:/);

  const unsupportedEvidence = approvedMap();
  unsupportedEvidence.claimMappings[0].bindings[0].sourceIds = ["source-city-paper"];
  unsupportedEvidence.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(unsupportedEvidence);
  assertBlocked(unsupportedEvidence, /primary_source_binding_missing:.*Remediation:/);

  const policyDisabled = approvedMap();
  policyDisabled.visualSafetyPolicy.noGore = false;
  policyDisabled.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(policyDisabled);
  assertBlocked(policyDisabled, /visual_policy_invalid:.*Remediation:/);

  const neutralReenactment = approvedMap();
  neutralReenactment.claimMappings[0].bindings[0].treatment = "neutral_reenactment";
  neutralReenactment.claimMappings[0].bindings[0].reconstructionDisclosure =
    "Dramatized reconstruction based on cited sources.";
  neutralReenactment.editorialReview.reviewedShotMapFingerprint =
    casefileEvidenceShotMapContentFingerprint(neutralReenactment);
  assertBlocked(neutralReenactment, /neutral_reenactment_blocked:.*Remediation:/);

  const staleMapApproval = approvedMap();
  staleMapApproval.editorialReview.reviewedAt = new Date(
    NOW.getTime() - 31 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  assertBlocked(staleMapApproval, /editorial_review_stale:.*Remediation:/);

  const sourceReviewMismatch = approvedMap();
  sourceReviewMismatch.editorialReview.reviewedSourcePacketFingerprint = "f".repeat(64);
  assertBlocked(sourceReviewMismatch, /editorial_review_source_packet_mismatch:.*Remediation:/);

  const mapReviewMismatch = approvedMap();
  mapReviewMismatch.claimMappings[0].bindings[0].treatment = "map";
  assertBlocked(mapReviewMismatch, /editorial_review_shot_map_mismatch:.*Remediation:/);

  const changedShotPlan = structuredClone(shotList);
  changedShotPlan[0].prompt = "A changed reviewed visual plan.";
  assert.throws(
    () =>
      assertCasefileEvidenceShotMap({
        input: approvedMap(),
        sourcePacket,
        sourceAdmission: admittedSourcePacket.receipt,
        sceneManifest,
        shotList: changedShotPlan,
      }, { now: NOW }),
    /plan_fingerprint_mismatch:.*Remediation:/,
  );

  console.log("casefile evidence shot map admission tests passed");
}

void main();
