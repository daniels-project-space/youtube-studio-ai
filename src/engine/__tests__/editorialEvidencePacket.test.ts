import assert from "node:assert/strict";

import {
  EDITORIAL_EVIDENCE_PACKET_VERSION,
  assertEditorialEvidencePacket,
  createEditorialEvidencePacket,
  editorialEvidencePacketContentFingerprint,
  editorialEvidencePacketFromDataStoryLedger,
  evaluateEditorialEvidencePacket,
} from "@/engine/editorialEvidencePacket";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";

const now = Date.now();

const packet = createEditorialEvidencePacket({
  subject: "Why ports became infrastructure bottlenecks",
  sources: [{
    id: "source-port-authority",
    name: "Port Authority annual report",
    url: "https://authority.example.org/reports/annual",
    snapshotSha256: "a".repeat(64),
    kind: "official",
  }],
  claims: [{
    id: "claim-port-delay",
    sourceIds: ["source-port-authority"],
    approvedText: "The approved report recorded a 4.1 day average berth delay.",
    numericAnchor: "4.1 days",
    context: "Use only for the historical annual-report period specified by the source.",
  }],
  review: {
    reviewerId: "reviewer-editorial",
    reviewId: "review-editorial-port-delay",
    reviewedAt: new Date(now).toISOString(),
  },
  now,
});

assert.equal(packet.version, EDITORIAL_EVIDENCE_PACKET_VERSION);
assert.equal(packet.release, "private_human_editorial_review_only");
assert.equal(packet.requiresHumanEditorialReview, true);
assert.equal(assertEditorialEvidencePacket(packet, now).contentFingerprint, packet.contentFingerprint);

const unknownSource = structuredClone(packet);
unknownSource.claims[0]!.sourceIds = ["source-missing"];
unknownSource.contentFingerprint = editorialEvidencePacketContentFingerprint(unknownSource);
unknownSource.review.reviewedPacketFingerprint = unknownSource.contentFingerprint;
assert.equal(evaluateEditorialEvidencePacket(unknownSource, now).issues.some((issue) => issue.code === "unknown_claim_source"), true);

const stale = structuredClone(packet);
stale.review.reviewedAt = new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString();
assert.equal(evaluateEditorialEvidencePacket(stale, now).issues.some((issue) => issue.code === "review_stale"), true);

const tampered = structuredClone(packet);
tampered.claims[0]!.approvedText = "A substituted factual claim.";
assert.equal(evaluateEditorialEvidencePacket(tampered, now).issues.some((issue) => issue.code === "packet_fingerprint_mismatch"), true);

const dataStoryBase = {
  version: "data-story-source-ledger/v1" as const,
  topic: "Port delay trend",
  sources: [{
    id: "port-authority",
    name: "Port Authority",
    url: "https://authority.example.org/data",
    snapshotSha256: "b".repeat(64),
  }],
  claims: [
    { id: "delay-q1", sourceId: "port-authority", numericAnchor: "4.1 days", context: "Q1 average berth delay." },
    { id: "delay-q2", sourceId: "port-authority", numericAnchor: "3.8 days", context: "Q2 average berth delay." },
    { id: "delay-q3", sourceId: "port-authority", numericAnchor: "3.2 days", context: "Q3 average berth delay." },
  ],
};
const dataStoryLedger = {
  ...dataStoryBase,
  review: {
    decision: "approved" as const,
    reviewerId: "reviewer-data",
    reviewId: "review-data-port-delays",
    reviewedAt: new Date(now).toISOString(),
    reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(dataStoryBase),
  },
};
const adapted = editorialEvidencePacketFromDataStoryLedger(dataStoryLedger, now);
assert.equal(adapted.sources[0]?.id, "port-authority");
assert.equal(adapted.sources[0]?.kind, "dataset");
assert.equal(adapted.claims[0]?.numericAnchor, "4.1 days");

console.log("editorial evidence packet tests passed");
