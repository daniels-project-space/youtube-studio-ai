import assert from "node:assert/strict";

import { casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  assertCasefileEvidenceShotMap,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  evaluateCasefileEvidenceShotMap,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import { draftCasefileEvidenceShotMap } from "@/engine/casefileEvidenceShotMapAutoDrafter";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { casefileEvidenceShotMapBlocks } from "@/trigger/blocks/casefileEvidenceShotMapBlocks";

const NOW = new Date("2026-08-17T12:00:00.000Z");

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
      {
        id: "source-city-records",
        kind: "official_record",
        title: "Public response registry",
        publisher: "City Records Office",
        locator: "https://records.example.org/archive/vault-closure-response",
        excerpt: "The registry records the documented public response after the closure.",
        rights: {
          provenance: "unknown",
          visualUse: "citation_only",
        },
      },
    ],
    // Deliberately disjoint claim/source domains (no shared source id
    // between the two claims) so a test can break plan support for one
    // claim without accidentally also giving the other claim's scene an
    // unrelated, coincidental match on a shared source id.
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
        sourceIds: ["source-city-records", "source-city-paper"],
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
      sourceId: "source-city-records",
      primarySourceUrl: "https://records.example.org/archive/vault-closure-response",
      provenance: "official_record",
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
    { sourceId: "source-city-records", usage: "citation_only" },
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

function makeSceneManifest() {
  return {
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
        sourceRefs: ["source-city-records", "source-city-paper"],
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
}

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
const sourceAdmission = admittedSourcePacket.receipt;

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1) Real integration proof: the auto-drafted map passes the exact same
  //    assertCasefileEvidenceShotMap gate a human draft would.
  // ---------------------------------------------------------------------
  const sceneManifest = makeSceneManifest();
  const drafted = await draftCasefileEvidenceShotMap({
    sourcePacket,
    sourceAdmission,
    sceneManifest,
    shotList,
    now: NOW,
  });
  assert.equal(drafted.claimMappings.length, 2, "every supported claim must be bound");
  for (const mapping of drafted.claimMappings) {
    assert.ok(mapping.bindings.length >= 1);
    for (const binding of mapping.bindings) {
      assert.equal(binding.onScreenCitation, true);
      assert.ok(binding.sourceIds.length >= 1);
      // Never a fabricated id: every scene/shot id must be a real plan id.
      for (const sceneId of binding.sceneIds) {
        assert.ok(sceneManifest.scenes.some((scene) => scene.id === sceneId));
      }
      for (const shotId of binding.shotIds) {
        assert.ok(shotList.some((shot) => shot.id === shotId));
      }
    }
  }

  const report = evaluateCasefileEvidenceShotMap(
    { input: drafted, sourcePacket, sourceAdmission, sceneManifest, shotList },
    { now: NOW },
  );
  assert.equal(report.safe, true, JSON.stringify(report.issues));

  const admitted = assertCasefileEvidenceShotMap(
    { input: drafted, sourcePacket, sourceAdmission, sceneManifest, shotList },
    { now: NOW },
  );
  assert.equal(admitted.receipt.factualClaimCount, 2);
  assert.equal(admitted.receipt.bindingCount, 2);
  assert.equal(admitted.receipt.release, "private_human_editorial_review_only");
  assert.equal(admitted.receipt.requiresHumanEditorialReview, true);
  assert.equal(admitted.map.contentFingerprint, casefileEvidenceShotMapContentFingerprint(drafted));

  // ---------------------------------------------------------------------
  // 2) Fails closed when the plan can partially support the claims: the
  //    unsupported claim must never get a fabricated binding, and the
  //    drafter must throw rather than emit an invalid/partial map.
  // ---------------------------------------------------------------------
  const partiallyUnsupportedManifest = makeSceneManifest();
  partiallyUnsupportedManifest.scenes[1]!.sourceRefs = ["source-unrelated-topic"];
  await assert.rejects(
    () =>
      draftCasefileEvidenceShotMap({
        sourcePacket,
        sourceAdmission,
        sceneManifest: partiallyUnsupportedManifest,
        shotList,
        now: NOW,
      }),
    /failed to converge/,
  );
  await assert.rejects(
    () =>
      draftCasefileEvidenceShotMap({
        sourcePacket,
        sourceAdmission,
        sceneManifest: partiallyUnsupportedManifest,
        shotList,
        now: NOW,
      }),
    /claim_mapping_missing/,
  );

  // ---------------------------------------------------------------------
  // 3) Fails closed when NO claim can be supported at all — must throw
  //    before ever constructing a schema-shaped candidate.
  // ---------------------------------------------------------------------
  const fullyUnsupportedManifest = makeSceneManifest();
  fullyUnsupportedManifest.scenes[0]!.sourceRefs = ["source-unrelated-topic"];
  fullyUnsupportedManifest.scenes[1]!.sourceRefs = ["source-unrelated-topic"];
  await assert.rejects(
    () =>
      draftCasefileEvidenceShotMap({
        sourcePacket,
        sourceAdmission,
        sceneManifest: fullyUnsupportedManifest,
        shotList,
        now: NOW,
      }),
    /none of the admitted Case Packet claims/,
  );

  // ---------------------------------------------------------------------
  // 4) Regression: a human-pasted draft must remain completely unaffected.
  //    Use the fully-unsupported scene manifest (which would make the
  //    auto-drafter throw if the block mistakenly invoked it) together
  //    with a manually authored input — the block must still succeed,
  //    proving the auto-draft branch was never taken.
  // ---------------------------------------------------------------------
  const humanInput: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: fullyUnsupportedManifest.fingerprint,
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
            sourceIds: ["source-city-records"],
            onScreenCitation: true,
          },
        ],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-vault-closure-human-001",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  humanInput.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(humanInput);

  const logs: string[] = [];
  const patch = await casefileEvidenceShotMapBlocks[0]!.run({
    ownerId: "owner-test",
    runId: "run-casefile-evidence-shot-map-auto-drafter",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      casefileSourcePacket: sourcePacket,
      casefileSourceAdmission: admittedSourcePacket.receipt,
      casefileEvidenceShotMapInput: humanInput,
      sceneManifest: fullyUnsupportedManifest,
      shotList,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal(
    (patch.casefileEvidenceShotMapAdmission as { release: string }).release,
    "private_human_editorial_review_only",
  );
  assert.match(logs.join("\n"), /human-drafted/);
  assert.doesNotMatch(logs.join("\n"), /auto-drafted/);

  // ---------------------------------------------------------------------
  // 5) The auto-draft branch actually engages when no human draft is
  //    supplied, and produces a block result identical in shape.
  // ---------------------------------------------------------------------
  const autoLogs: string[] = [];
  const autoPatch = await casefileEvidenceShotMapBlocks[0]!.run({
    ownerId: "owner-test",
    runId: "run-casefile-evidence-shot-map-auto-drafter-2",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      casefileSourcePacket: sourcePacket,
      casefileSourceAdmission: admittedSourcePacket.receipt,
      sceneManifest: makeSceneManifest(),
      shotList,
    },
    budgetUsd: 0,
    log: (message) => autoLogs.push(message),
  });
  assert.equal(
    (autoPatch.casefileEvidenceShotMapAdmission as { bindingCount: number }).bindingCount,
    2,
  );
  assert.match(autoLogs.join("\n"), /auto-drafted/);
  assert.match(autoLogs.join("\n"), /provider calls: 0/);

  console.log("casefile evidence shot map auto-drafter tests passed");
}

void main();
