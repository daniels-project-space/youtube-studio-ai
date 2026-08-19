import assert from "node:assert/strict";

import {
  assertCasefileEvidenceGrammar,
  assertCasefilePacket,
  CasePacketSchema,
  casefileFingerprint,
  compileCasefileEvidenceGrammar,
  evaluateCasefileSafety,
  RECONSTRUCTION_DISCLOSURE,
  type CasePacket,
} from "@/engine/casefile";

const historicalCase: CasePacket = {
  version: "casefile/v1" as const,
  id: "case-century-vault",
  title: "The Vault That Failed Before the Heist Began",
  kind: "historical_heist" as const,
  status: "historical_closed" as const,
  sourceLedger: [
    {
      id: "source-national-archive",
      kind: "official_record" as const,
      title: "National archive incident report",
      publisher: "National Archives",
      locator: "https://archive.example.org/reports/vault-incident",
      excerpt: "The report records the vault's construction defects, the inspection sequence, and the later closure.",
      rights: {
        provenance: "public_domain" as const,
        visualUse: "visual_clearance_confirmed" as const,
        evidenceLocator: "https://archive.example.org/rights/public-domain",
      },
    },
    {
      id: "source-city-paper",
      kind: "archival_news" as const,
      title: "How the vault closure changed the city",
      publisher: "City Paper Archive",
      locator: "https://newspaper.example.org/1978/vault-closure",
      excerpt: "Contemporary reporting describes the public response to the closure and the repair programme.",
      rights: {
        provenance: "unknown" as const,
        visualUse: "citation_only" as const,
      },
    },
  ],
  claims: [
    {
      id: "claim-design-failure",
      order: 10,
      text: "The official inspection identified a construction defect before the vault failed.",
      state: "established" as const,
      sourceIds: ["source-national-archive"],
      operationalRisk: "none" as const,
    },
    {
      id: "claim-public-response",
      order: 20,
      text: "The closure prompted a documented repair programme and public response.",
      state: "established" as const,
      sourceIds: ["source-city-paper", "source-national-archive"],
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
  cinemaScope: {
    aspectRatio: "2.35:1" as const,
    frameRate: 25 as const,
    titleSafeMarginPct: 0.1,
    captionSafeMarginPct: 0.14,
  },
};

const admitted = assertCasefilePacket(historicalCase);
assert.equal(admitted.id, historicalCase.id);
assert.equal(evaluateCasefileSafety(historicalCase).safe, true);

const grammar = compileCasefileEvidenceGrammar(historicalCase);
assert.equal(grammar.scenes.length, 2);
assert.equal(grammar.scenes[0].treatment, "source_document");
assert.equal(grammar.scenes[1].treatment, "source_document", "the deterministic compiler selects a cleared source before a citation-only source");
assert.equal(grammar.scenes.every((scene) => scene.onScreenCitation), true);
assert.equal(assertCasefileEvidenceGrammar(historicalCase, grammar).packetFingerprint, grammar.packetFingerprint);

const reordered = structuredClone(historicalCase);
reordered.sourceLedger.reverse();
reordered.claims.reverse();
reordered.claims[0].sourceIds.reverse();
assert.equal(casefileFingerprint(historicalCase), casefileFingerprint(reordered));
assert.deepEqual(compileCasefileEvidenceGrammar(historicalCase), compileCasefileEvidenceGrammar(reordered));
assert.match(casefileFingerprint(historicalCase), /^[a-f0-9]{64}$/);

const invalidSource = structuredClone(historicalCase);
invalidSource.sourceLedger[0].locator = "not-a-source-url";
assert.equal(CasePacketSchema.safeParse(invalidSource).success, false, "ledger records require a stable URL");

const invalidRights = structuredClone(historicalCase);
invalidRights.sourceLedger[0].rights = {
  provenance: "unknown",
  visualUse: "visual_clearance_confirmed",
};
assert.equal(
  evaluateCasefileSafety(invalidRights).issues.some((item) => item.code === "invalid_visual_rights"),
  true,
  "visual media needs auditable rights provenance",
);
assert.throws(() => assertCasefilePacket(invalidRights), /invalid_visual_rights/);

const sensitiveCase = structuredClone(historicalCase);
sensitiveCase.status = "active_investigation";
sensitiveCase.sensitivity.activeAllegations = true;
sensitiveCase.sensitivity.involvesMinors = true;
sensitiveCase.sensitivity.includesGraphicDetail = true;
sensitiveCase.sensitivity.actionableWrongdoing = true;
sensitiveCase.claims[0].state = "alleged";
sensitiveCase.claims[0].operationalRisk = "actionable";
sensitiveCase.claims[0].sourceIds = ["source-missing"];
const sensitiveReport = evaluateCasefileSafety(sensitiveCase);
for (const code of [
  "active_case",
  "active_allegation",
  "minor_involved",
  "graphic_detail",
  "actionable_wrongdoing",
  "unresolved_claim_state",
  "unsupported_claim",
] as const) {
  assert.equal(sensitiveReport.issues.some((item) => item.code === code), true, `missing safety blocker ${code}`);
}
assert.throws(() => assertCasefilePacket(sensitiveCase), /casefile safety gate blocked/);

const citationOnlyAsMedia = structuredClone(grammar);
citationOnlyAsMedia.scenes[1].sourceId = "source-city-paper";
citationOnlyAsMedia.scenes[1].citation = {
  sourceId: "source-city-paper",
  label: "City Paper Archive: How the vault closure changed the city",
  locator: "https://newspaper.example.org/1978/vault-closure",
};
citationOnlyAsMedia.scenes[1].treatment = "source_archival_media";
assert.throws(
  () => assertCasefileEvidenceGrammar(historicalCase, citationOnlyAsMedia),
  /citation-only source/,
);

const reconstructionWithoutDisclosure = structuredClone(historicalCase);
reconstructionWithoutDisclosure.reconstruction = { mode: "dramatized_reconstruction" };
assert.equal(
  evaluateCasefileSafety(reconstructionWithoutDisclosure).issues.some((item) => item.code === "reconstruction_disclosure_missing"),
  true,
);
const reconstructionCase = structuredClone(historicalCase);
reconstructionCase.reconstruction = {
  mode: "dramatized_reconstruction",
  disclosureText: RECONSTRUCTION_DISCLOSURE,
};
const reconstructionGrammar = compileCasefileEvidenceGrammar(reconstructionCase);
reconstructionGrammar.scenes[0].treatment = "dramatized_reconstruction";
reconstructionGrammar.scenes[0].reconstructionDisclosure = RECONSTRUCTION_DISCLOSURE;
assert.equal(assertCasefileEvidenceGrammar(reconstructionCase, reconstructionGrammar).scenes[0].reconstructionDisclosure, RECONSTRUCTION_DISCLOSURE);

console.log("casefile contract test passed");
