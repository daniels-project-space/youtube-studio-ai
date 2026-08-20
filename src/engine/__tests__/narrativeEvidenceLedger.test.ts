import assert from "node:assert/strict";

import {
  NARRATIVE_EVIDENCE_LEDGER_REVIEW_MAX_AGE_MS,
  assertNarrativeEvidenceLedger,
  createNarrativeEvidenceLedger,
  evaluateNarrativeEvidenceLedger,
  narrativeEvidenceLedgerContentFingerprint,
  type NarrativeEvidenceClaim,
  type NarrativeEvidenceLedger,
} from "../narrativeEvidenceLedger";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const REVIEWED_AT = "2026-08-20T11:00:00.000Z";

const reliableClaim: NarrativeEvidenceClaim = {
  id: "claim-bridge-collapse",
  approvedText: "The bridge deck failed after corrosion had reduced the load-bearing capacity of the joint.",
  assertionState: "established",
  confidence: "high",
  uncertainty: { level: "qualified", summary: "The exact order of two contributing maintenance decisions remains uncertain." },
  causalRole: "direct_cause",
  supports: [{
    railId: "rail-editorial",
    sourceIds: ["source-inspection-report"],
    upstreamClaimIds: ["claim-inspection-finding"],
  }],
  allowedVisualTreatments: [
    { kind: "source_proof", onScreenCitation: true, exactSourceAssetRequired: true },
    {
      kind: "neutral_reenactment",
      visiblyLabeled: true,
      disclosureText: "Illustrated reconstruction based on reviewed records.",
      anonymousDepictionOnly: true,
      doesNotClaimDirectObservation: true,
    },
    { kind: "data_diagram", onScreenCitation: true },
  ],
};

function validLedger(): NarrativeEvidenceLedger {
  return createNarrativeEvidenceLedger({
    subject: "Bridge inspection failure",
    evidenceRails: [{
      id: "rail-editorial",
      kind: "editorial_evidence_packet",
      packetFingerprint: "a".repeat(64),
      sourceIds: ["source-inspection-report"],
      upstreamClaimIds: ["claim-inspection-finding"],
    }],
    claims: [reliableClaim],
    editorialReview: { reviewerId: "reviewer-ada", reviewId: "review-narrative-001", reviewedAt: REVIEWED_AT },
    now: NOW,
  });
}

{
  const ledger = validLedger();
  assert.equal(evaluateNarrativeEvidenceLedger(ledger, NOW).safe, true);
  assert.equal(ledger.release, "private_human_editorial_review_only");
  assert.equal(ledger.requiresHumanEditorialReview, true);
}

{
  const ledger = validLedger();
  const reordered = {
    ...ledger,
    claims: [...ledger.claims].reverse(),
    evidenceRails: [...ledger.evidenceRails].reverse(),
  };
  assert.equal(narrativeEvidenceLedgerContentFingerprint(reordered), ledger.contentFingerprint);
}

{
  const ledger = validLedger();
  const invalid = {
    ...ledger,
    claims: [{
      ...ledger.claims[0]!,
      supports: [{
        ...ledger.claims[0]!.supports[0]!,
        sourceIds: ["source-not-in-reviewed-rail"],
      }],
    }],
  };
  const report = evaluateNarrativeEvidenceLedger(invalid, NOW);
  assert.equal(report.safe, false);
  assert.ok(report.issues.some((issue) => issue.code === "unknown_support_member"));
}

{
  const ledger = validLedger();
  const disputed: NarrativeEvidenceClaim = {
    ...ledger.claims[0]!,
    id: "claim-competing-account",
    approvedText: "A competing account attributes the failure to an unusual storm load.",
    assertionState: "contested",
    confidence: "limited",
    uncertainty: { level: "material", summary: "The surviving records do not resolve which explanation is complete." },
    causalRole: "correlation_only",
    allowedVisualTreatments: [{
      kind: "neutral_reenactment",
      visiblyLabeled: true,
      disclosureText: "Illustrated reconstruction based on competing accounts.",
      anonymousDepictionOnly: true,
      doesNotClaimDirectObservation: true,
    }],
  };
  const content = {
    version: ledger.version,
    subject: ledger.subject,
    evidenceRails: ledger.evidenceRails,
    claims: [ledger.claims[0]!, disputed],
    relations: [{
      id: "relation-competing-explanations",
      kind: "counterclaim" as const,
      fromClaimId: disputed.id,
      toClaimId: ledger.claims[0]!.id,
      explanation: "The accounts attribute the failure to different mechanisms.",
    }],
  };
  const contentFingerprint = narrativeEvidenceLedgerContentFingerprint(content);
  const report = evaluateNarrativeEvidenceLedger({
    ...content,
    contentFingerprint,
    editorialReview: { ...ledger.editorialReview, reviewedLedgerFingerprint: contentFingerprint },
    release: ledger.release,
    requiresHumanEditorialReview: true,
  }, NOW);
  assert.equal(report.safe, false);
  assert.ok(report.issues.some((issue) => issue.code === "neutral_reenactment_blocked"));
}

{
  const ledger = validLedger();
  const stale = {
    ...ledger,
    editorialReview: {
      ...ledger.editorialReview,
      reviewedAt: new Date(NOW - NARRATIVE_EVIDENCE_LEDGER_REVIEW_MAX_AGE_MS - 1).toISOString(),
    },
  };
  const report = evaluateNarrativeEvidenceLedger(stale, NOW);
  assert.equal(report.safe, false);
  assert.ok(report.issues.some((issue) => issue.code === "review_stale"));
}

{
  const ledger = validLedger();
  assert.throws(() => assertNarrativeEvidenceLedger({ ...ledger, contentFingerprint: "b".repeat(64) }, NOW));
}

console.log("NARRATIVE EVIDENCE LEDGER PASS");
