import assert from "node:assert/strict";

import {
  CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS,
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  evaluateCasefileSourcePacket,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { casefileFingerprint } from "@/engine/casefile";
import { casefileSourcePacketBlocks } from "../casefileSourcePacketBlocks";

const NOW = new Date();

const casePacket = {
  version: "casefile/v1" as const,
  id: "case-vault-closure",
  title: "The Vault Closure",
  kind: "historical_heist" as const,
  status: "historical_closed" as const,
  sourceLedger: [
    {
      id: "source-court-archive",
      kind: "court_record" as const,
      title: "Closure finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/vault-closure",
      excerpt: "The finding records the closure decision and the verified repair programme.",
      rights: {
        provenance: "licensed" as const,
        visualUse: "visual_clearance_confirmed" as const,
        evidenceLocator: "https://court.example.org/rights/vault-closure-license",
      },
    },
    {
      id: "source-city-paper",
      kind: "archival_news" as const,
      title: "Public response to the closure",
      publisher: "City Paper Archive",
      locator: "https://news.example.org/archive/vault-closure",
      excerpt: "The archive reports the documented public response after the closure.",
      rights: {
        provenance: "unknown" as const,
        visualUse: "citation_only" as const,
      },
    },
    {
      id: "source-academic-study",
      kind: "academic_research" as const,
      title: "Repair programme impact study",
      publisher: "Regional History Institute",
      locator: "https://research.example.org/vault-repair-programme",
      excerpt: "The study independently documents the repair programme after closure.",
      rights: {
        provenance: "unknown" as const,
        visualUse: "citation_only" as const,
      },
    },
  ],
  claims: [
    {
      id: "claim-closure-order",
      order: 10,
      text: "The court finding ordered the vault's closure.",
      state: "established" as const,
      sourceIds: ["source-court-archive"],
      operationalRisk: "none" as const,
    },
    {
      id: "claim-public-response",
      order: 20,
      text: "The documented closure prompted public response and a repair programme.",
      state: "established" as const,
      sourceIds: ["source-court-archive", "source-city-paper", "source-academic-study"],
      operationalRisk: "contextual" as const,
    },
  ],
  sensitivity: {
    activeAllegations: false,
    involvesMinors: false,
    includesGraphicDetail: false,
    actionableWrongdoing: false,
  },
  reconstruction: { mode: "none" as const },
};

const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: casePacket.id,
  casePacket,
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
    {
      sourceId: "source-city-paper",
      usage: "citation_only",
    },
    {
      sourceId: "source-academic-study",
      usage: "citation_only",
    },
  ],
  editorialReview: {
    id: "editorial-review-vault-closure-001",
    decision: "approved",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    reviewedPacketFingerprint: casefileFingerprint(casePacket),
    reviewedSourcePacketFingerprint: "0".repeat(64),
  },
};

sourcePacket.editorialReview.reviewedSourcePacketFingerprint =
  casefileSourcePacketContentFingerprint(sourcePacket);

async function main(): Promise<void> {
  const report = evaluateCasefileSourcePacket(sourcePacket, { now: NOW });
  assert.equal(report.safe, true, JSON.stringify(report.issues));

  const admitted = assertCasefileSourcePacket(sourcePacket, { now: NOW });
  assert.equal(admitted.receipt.caseId, casePacket.id);
  assert.equal(admitted.receipt.casePacketFingerprint, casefileFingerprint(casePacket));
  assert.equal(admitted.receipt.sourcePacketFingerprint, casefileSourcePacketContentFingerprint(sourcePacket));
  assert.equal(admitted.receipt.editorialReview.reviewedPacketFingerprint, casefileFingerprint(casePacket));
  assert.equal(
    admitted.receipt.editorialReview.reviewedSourcePacketFingerprint,
    casefileSourcePacketContentFingerprint(sourcePacket),
  );
  assert.equal(admitted.receipt.release, "private_human_editorial_review_only");
  assert.equal(admitted.evidenceGrammar.scenes.length, 2);

  const logs: string[] = [];
  const patch = await casefileSourcePacketBlocks[0].run({
    ownerId: "owner-test",
    runId: "run-casefile-source-packet",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: { casefileSourcePacketInput: sourcePacket },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal((patch.casefileSourceAdmission as { release: string }).release, "private_human_editorial_review_only");
  assert.equal((patch.casefileEvidenceGrammar as { scenes: unknown[] }).scenes.length, 2);
  assert.match(logs.join("\n"), /provider calls: 0/);

  const missingCaseId = structuredClone(sourcePacket) as Record<string, unknown>;
  missingCaseId.caseId = "";
  assert.throws(
    () => assertCasefileSourcePacket(missingCaseId, { now: NOW }),
    /case_identifier_missing:.*Remediation:/,
  );

  const missingPrimary = structuredClone(sourcePacket);
  missingPrimary.claimPrimarySources = [];
  assert.throws(
    () => assertCasefileSourcePacket(missingPrimary, { now: NOW }),
    /claim_primary_source_missing:.*Remediation:/,
  );

  const missingRightsEvidence = structuredClone(sourcePacket);
  delete missingRightsEvidence.sourceUsage[0].rightsEvidenceLocator;
  assert.throws(
    () => assertCasefileSourcePacket(missingRightsEvidence, { now: NOW }),
    /asset_rights_evidence_missing:.*Remediation:/,
  );

  const mismatchedApproval = structuredClone(sourcePacket);
  mismatchedApproval.editorialReview.reviewedPacketFingerprint = "f".repeat(64);
  assert.throws(
    () => assertCasefileSourcePacket(mismatchedApproval, { now: NOW }),
    /editorial_review_packet_mismatch:.*Remediation:/,
  );

  // The Case Packet itself is unchanged in both cases below. The approval must
  // still fail because the editor signed the exact source-admission content,
  // not a bare underlying case record.
  const changedSourceUsage = structuredClone(sourcePacket);
  changedSourceUsage.sourceUsage[0].assetId = "asset-court-closure-finding-recut";
  assert.throws(
    () => assertCasefileSourcePacket(changedSourceUsage, { now: NOW }),
    /editorial_review_source_packet_mismatch:.*Remediation:/,
  );

  const changedPrimaryMapping = structuredClone(sourcePacket);
  changedPrimaryMapping.claimPrimarySources[1] = {
    claimId: "claim-public-response",
    sourceId: "source-academic-study",
    primarySourceUrl: "https://research.example.org/vault-repair-programme",
    provenance: "academic_research",
  };
  assert.throws(
    () => assertCasefileSourcePacket(changedPrimaryMapping, { now: NOW }),
    /editorial_review_source_packet_mismatch:.*Remediation:/,
  );

  const staleApproval = structuredClone(sourcePacket);
  staleApproval.editorialReview.reviewedAt = new Date(
    NOW.getTime() - (CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1_000,
  ).toISOString();
  assert.throws(
    () => assertCasefileSourcePacket(staleApproval, { now: NOW }),
    /editorial_review_stale:.*Remediation:/,
  );

  const citationOnlyPromotedToMedia = structuredClone(sourcePacket);
  citationOnlyPromotedToMedia.sourceUsage[1] = {
    sourceId: "source-city-paper",
    usage: "visual_media",
    assetId: "asset-city-paper-scan",
  };
  assert.throws(
    () => assertCasefileSourcePacket(citationOnlyPromotedToMedia, { now: NOW }),
    /source_usage_invalid:.*Remediation:/,
  );

  console.log("casefile source packet admission tests passed");
}

void main();
