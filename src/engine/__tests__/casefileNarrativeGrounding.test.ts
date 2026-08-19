import assert from "node:assert/strict";

import { casefileNarrativeGroundingPrompt } from "@/engine/casefileNarrativeGrounding";
import { CASEFILE_SOURCE_PACKET_VERSION } from "@/engine/sourceFirstAdmission";

const packet = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-grounded-hook",
  casePacket: {
    version: "casefile/v1",
    id: "case-grounded-hook",
    title: "The Grounded Hook",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-archive",
      kind: "court_record",
      title: "Court finding",
      publisher: "Regional Court Archive",
      locator: "https://archive.example.org/finding",
      excerpt: "The signed finding establishes the closure order.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://archive.example.org/rights",
      },
    }],
    claims: [{
      id: "claim-closure",
      order: 10,
      text: "The signed court finding ordered the archive closed.",
      state: "established",
      sourceIds: ["source-archive"],
      operationalRisk: "none",
    }],
    sensitivity: {
      activeAllegations: false,
      involvesMinors: false,
      includesGraphicDetail: false,
      actionableWrongdoing: false,
    },
    reconstruction: {
      mode: "illustrated_reconstruction",
      disclosureText: "Illustrated reconstruction based on cited records.",
    },
  },
  claimPrimarySources: [{
    claimId: "claim-closure",
    sourceId: "source-archive",
    primarySourceUrl: "https://archive.example.org/finding",
    provenance: "court_record",
  }],
  sourceUsage: [{
    sourceId: "source-archive",
    usage: "visual_media",
    assetId: "asset-finding",
    rightsEvidenceLocator: "https://archive.example.org/rights",
  }],
  editorialReview: {
    id: "editorial-review-grounded-hook",
    decision: "approved",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: "2026-08-14T12:00:00.000Z",
    reviewedPacketFingerprint: "a".repeat(64),
    reviewedSourcePacketFingerprint: "b".repeat(64),
  },
};

const prompt = casefileNarrativeGroundingPrompt(packet);
assert.match(prompt, /CASEFILE NARRATIVE SOURCE LOCK/);
assert.match(prompt, /claim-closure \[established; source source-archive, Regional Court Archive\]/);
assert.match(prompt, /The signed court finding ordered the archive closed\./);
assert.match(prompt, /https:\/\/archive\.example\.org\/finding/);
assert.match(prompt, /may not invent a threat, motive, hidden event/i);
assert.equal(prompt, casefileNarrativeGroundingPrompt(packet), "source grounding must be deterministic");

assert.throws(
  () => casefileNarrativeGroundingPrompt({
    ...packet,
    claimPrimarySources: [{ ...packet.claimPrimarySources[0], claimId: "claim-unmapped" }],
  }),
  /lacks an admitted primary source/i,
);

console.log("casefile narrative grounding tests passed");
