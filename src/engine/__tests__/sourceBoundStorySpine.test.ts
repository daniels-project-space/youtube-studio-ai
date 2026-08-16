import assert from "node:assert/strict";

import { RECONSTRUCTION_DISCLOSURE, casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  assertCasefileEvidenceShotMap,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { _resetBlocks, registerAllBlocks } from "@/engine/blocks";
import { get } from "@/engine/registry";
import {
  createSourceBoundStorySpineHandoff,
  validateSourceBoundStorySpineHandoff,
} from "@/engine/sourceBoundStorySpine";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { planStorySpine } from "@/engine/storySpine";
import { sourceBoundStorySpineBlocks } from "@/trigger/blocks/sourceBoundStorySpineBlocks";

const NOW = new Date("2026-08-16T12:00:00.000Z");

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

const storySpine = planStorySpine({
  topic: sourcePacket.casePacket.title,
  narrationDurationSec: 12,
  sentenceTimings: [{
    text: "The court finding ordered the ledger room closed.",
    start: 0,
    end: 12,
  }],
  targetShotSec: 6,
});

const sceneManifest = {
  version: "scene-manifest/v1" as const,
  durationSec: 12,
  scenes: [{
    id: "scene-ledger-order",
    beatId: "beat-ledger-order",
    t0: 0,
    t1: 6,
    kind: "claim" as const,
    label: "The cited court finding is introduced.",
    characterIds: [],
    camera: { framing: "close" as const, move: "static" as const },
    visualState: { action: "A court document is read beside a sealed ledger room.", props: ["court file", "ledger"] },
    text: "The cited court finding is introduced.",
    causalInputBeatIds: [],
    sourceRefs: ["source-court-ledger"],
    transition: "cut" as const,
  }, {
    id: "scene-ledger-seal",
    beatId: "beat-ledger-seal",
    t0: 6,
    t1: 12,
    kind: "claim" as const,
    label: "The cited court order closes the ledger room.",
    characterIds: [],
    camera: { framing: "wide" as const, move: "pan" as const },
    visualState: { action: "The sealed ledger room is shown as the court file is catalogued.", props: ["sealed ledger", "court file"] },
    text: "The cited court order closes the ledger room.",
    causalInputBeatIds: ["beat-ledger-order"],
    sourceRefs: ["source-court-ledger"],
    transition: "dissolve" as const,
  }],
  fingerprint: "a".repeat(64),
  topic: sourcePacket.casePacket.title,
  audience: "general" as const,
  seriesId: "series-ledger-files",
  episodeId: "episode-ledger-closure",
  renderer: "deterministic-scene/v1" as const,
  externalProviderCalls: 0 as const,
};

const admittedSource = assertCasefileSourcePacket(sourcePacket, { now: NOW });

function evidenceInput(shotIds = storySpine.shotList.map((shot) => shot.id)): CasefileEvidenceShotMapInput {
  const input: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(storySpine.shotList),
    visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
    claimMappings: [{
      claimId: "claim-ledger-order",
      bindings: [{
        sceneIds: ["scene-ledger-order", "scene-ledger-seal"],
        shotIds,
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
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  return input;
}

function admitMap(input = evidenceInput()) {
  return assertCasefileEvidenceShotMap({
    input,
    sourcePacket,
    sourceAdmission: admittedSource.receipt,
    sceneManifest,
    shotList: storySpine.shotList,
  }, { now: NOW });
}

async function main(): Promise<void> {
  const evidence = admitMap();
  const handoff = createSourceBoundStorySpineHandoff({
    sourcePacket,
    sourceAdmission: admittedSource.receipt,
    evidenceShotMap: evidence.map,
    evidenceShotMapAdmission: evidence.receipt,
    storySpine,
    now: NOW,
  });
  assert.equal(handoff.release, "private_human_editorial_review_only");
  assert.equal(handoff.requiresHumanEditorialReview, true);
  assert.deepEqual(handoff.claimBindings[0]?.storySpineShotIds, storySpine.shotList.map((shot) => shot.id));
  assert.deepEqual(handoff.claimBindings[0]?.storySpineSentenceIds, ["sentence-0001"]);
  assert.equal(validateSourceBoundStorySpineHandoff(handoff).storySpineFingerprint, handoff.storySpineFingerprint);
  const artifact = artifactContract("sourceBoundStorySpine");
  assert.equal(artifact.opaque, false, "the handoff must cross the store through a typed contract");
  assert.equal((validateArtifact(artifact, handoff) as { caseId: string }).caseId, sourcePacket.caseId);

  const logs: string[] = [];
  const patch = await sourceBoundStorySpineBlocks[0]!.run({
    ownerId: "owner-test",
    runId: "run-source-bound-story-spine",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      casefileSourcePacket: sourcePacket,
      casefileSourceAdmission: admittedSource.receipt,
      casefileEvidenceShotMap: evidence.map,
      casefileEvidenceShotMapAdmission: evidence.receipt,
      timedScript: storySpine.timedScript,
      narrativeBeats: storySpine.narrativeBeats,
      continuityLedger: storySpine.continuityLedger,
      shotList: storySpine.shotList,
      dpVisualSpecs: storySpine.dpVisualSpecs,
      editorEdl: storySpine.editorEdl,
      storyCoverage: storySpine.coverage,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal((patch.sourceBoundStorySpine as { caseId: string }).caseId, sourcePacket.caseId);
  assert.match(logs.join("\n"), /provider calls: 0/);

  const partialEvidence = admitMap(evidenceInput([storySpine.shotList[0]!.id]));
  assert.throws(
    () => createSourceBoundStorySpineHandoff({
      sourcePacket,
      sourceAdmission: admittedSource.receipt,
      evidenceShotMap: partialEvidence.map,
      evidenceShotMapAdmission: partialEvidence.receipt,
      storySpine,
      now: NOW,
    }),
    /every timed Story Spine shot to carry a reviewed claim binding/,
    "a reviewed map that leaves a timed narration shot unbound must fail closed",
  );

  _resetBlocks();
  registerAllBlocks();
  assert.equal(get("source_bound_story_spine")?.id, "source_bound_story_spine");
  console.log("source-bound Story Spine tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
