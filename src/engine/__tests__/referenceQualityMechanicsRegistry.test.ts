import assert from "node:assert/strict";

import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import {
  createReferenceQualityMechanicsLedger,
  referenceQualityVisualReviewCriteriaForRoute,
} from "@/engine/referenceQualityMechanicsRegistry";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import {
  createVisualReviewReleaseReceipt,
} from "@/lib/finalMasterReleaseCertificate";
import { createUnmeasuredReferenceQualityFinalMasterBinding } from "@/lib/referenceQualityFinalMasterBinding";

const finalMaster = { sha256: "a".repeat(64), durationSec: 90 };
const reviewFingerprint = "b".repeat(64);
const reviewReceiptFingerprint = "c".repeat(64);
const frameKey = "owner/alice/runs/mechanics/visual-review/frames/f001.jpg";

function brief(input: Readonly<Record<string, unknown>>) {
  return createChannelProgramBrief({
    nicheKey: "educational",
    locale: "en",
    concept: "An original, repeatable educational program with a clear viewer promise.",
    ...input,
  });
}

function routeSeed(input: Readonly<Record<string, unknown>>) {
  const programBrief = brief(input);
  return channelProgramRouteRunSeed({
    route: resolveChannelProgramRoute(programBrief),
    programBrief,
  });
}

function visualRelease(referenceCriteria: unknown[] = []) {
  return createVisualReviewReleaseReceipt({
    reviewFingerprint,
    reviewReceiptVersion: "video-review/v5",
    reviewReceiptFingerprint,
    verdict: "pass",
    summary: "The existing evidence-backed visual review passed.",
    defects: [],
    focusWindows: [],
    referenceCriteria,
    referenceCriteriaComplete: true,
    evidence: {
      source: finalMaster,
      manifestKey: "owner/alice/runs/mechanics/visual-review/manifest.json",
      frameKeys: [frameKey],
      frameArtifacts: [{
        r2Key: frameKey,
        contentSha256: "d".repeat(64),
        byteLength: 128,
      }],
    },
  });
}

function factualBinding(seed: ReturnType<typeof routeSeed>) {
  return createUnmeasuredReferenceQualityFinalMasterBinding({
    contract: referenceQualityContractFor(seed.family),
    finalMasterSha256: finalMaster.sha256,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  });
}

const autonomousFactualRoutes = [
  routeSeed({ family: "narrated_stock" }),
  routeSeed({ family: "sleep" }),
  routeSeed({ family: "shorts" }),
  routeSeed({
    family: "quizyear",
    programIntent: { kind: "certified_quiz", profile: "world_geography" },
  }),
  routeSeed({ family: "illustrated_explainer" }),
];

for (const seed of autonomousFactualRoutes) {
  const ledger = createReferenceQualityMechanicsLedger({
    route: seed,
    finalMaster,
    visualRelease: visualRelease(),
    referenceQualityBinding: factualBinding(seed),
  });
  assert.equal(ledger.mechanicsKind, "reference-quality-contract", `${seed.routeKey} keeps its factual contract`);
  assert.ok(ledger.requirements.length > 0, `${seed.routeKey} enumerates its transferable mechanics`);
  assert.ok(
    ledger.evidence.every((item) => item.measurementState === "unmeasured"),
    `${seed.routeKey} does not infer a measured pass from generic QA`,
  );
}

const narratedSeed = autonomousFactualRoutes[0]!;
const explainerSeed = routeSeed({ family: "illustrated_explainer" });
assert.deepEqual(
  referenceQualityVisualReviewCriteriaForRoute({
    route: explainerSeed,
    referenceQualityBinding: factualBinding(explainerSeed),
  }),
  [{
    id: "purposeful-visual-change",
    criterion:
      "Every visual change must prove, clarify, or advance the current spoken or on-screen point; decorative novelty is a defect.",
    scope: "global",
  }, {
    id: "legible-visual-model",
    criterion:
      "Keep the episode's central diagram, spatial model, or illustrated metaphor legible at the moment it carries the explanation; do not replace explanation with decorative motion.",
    scope: "global",
  }],
  "an explainer's frozen pacing and legibility standards become typed final-master reviewer criteria",
);
assert.deepEqual(
  referenceQualityVisualReviewCriteriaForRoute({
    route: narratedSeed,
    referenceQualityBinding: factualBinding(narratedSeed),
  }),
  [],
  "source-trace requirements stay outside a frame-only reviewer rather than being falsely observed",
);
const casefileLookingVisual = createReferenceQualityMechanicsLedger({
  route: narratedSeed,
  finalMaster,
  visualRelease: visualRelease([{
    id: "evidence-bearing-visual-rhythm",
    scope: "global",
    verdict: "pass",
    evidenceFrameIds: ["f001"],
  }]),
  referenceQualityBinding: factualBinding(narratedSeed),
});
const sourceTracePacing = casefileLookingVisual.evidence.find((item) =>
  item.requirementId === "evidence-bearing-visual-rhythm" &&
  item.evidenceId === "reviewer-confirmed-purposeful-change-map",
);
assert.equal(
  sourceTracePacing?.measurementState,
  "unmeasured",
  "a visual criterion alone cannot satisfy a source-trace-plus-review requirement",
);

const fictionalSeed = routeSeed({
  family: "illustrated_explainer",
  programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
});
const fictionalLedger = createReferenceQualityMechanicsLedger({
  route: fictionalSeed,
  finalMaster,
  visualRelease: visualRelease(),
  syntheticScenario: syntheticScenarioContract("ai_decision"),
});
assert.equal(fictionalLedger.mechanicsKind, "fictional-scenario-contract");
assert.equal(fictionalLedger.referenceContractFingerprint, undefined);
assert.ok(
  fictionalLedger.requirements.every((item) => item.area === "route_contract"),
  "fictional routes do not inherit factual-source requirements",
);
const fictionalContract = fictionalLedger.evidence.find((item) =>
  item.requirementId === "fictional-scenario-contract",
);
assert.deepEqual(
  fictionalContract && {
    measurementState: fictionalContract.measurementState,
    proofScope: fictionalContract.measurementState === "measured" ? fictionalContract.proofScope : undefined,
  },
  { measurementState: "measured", proofScope: "route_contract" },
  "the sealed scenario profile is only route-contract provenance",
);
const fictionalOpening = fictionalLedger.evidence.find((item) =>
  item.requirementId === "fictional-scenario-opening-disclosure",
);
assert.equal(
  fictionalOpening?.measurementState,
  "unmeasured",
  "the authored disclosure gate cannot claim that a final master contains the opening disclosure",
);

const narration = [
  "According to U.S. Bureau of Labor Statistics, the figure was 4.1%.",
  "According to U.S. Bureau of Labor Statistics, payrolls changed by 151,000.",
  "According to U.S. Bureau of Labor Statistics, weekly hours held at 34.3.",
].join(" ");
const dataStoryBody = {
  version: "data-story-source-ledger/v1" as const,
  topic: "Labour-market changes",
  sources: [{
    id: "bls",
    name: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/",
    snapshotSha256: "e".repeat(64),
  }],
  claims: [
    { id: "unemployment", sourceId: "bls", numericAnchor: "4.1%", context: "approved unemployment figure" },
    { id: "jobs", sourceId: "bls", numericAnchor: "151,000", context: "approved payroll figure" },
    { id: "hours", sourceId: "bls", numericAnchor: "34.3", context: "approved weekly-hours figure" },
  ],
};
const sourceLedger = {
  ...dataStoryBody,
  review: {
    decision: "approved" as const,
    reviewerId: "editor-1",
    reviewId: "review-1",
    reviewedAt: new Date().toISOString(),
    reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(dataStoryBody),
  },
};
const sourceDataLedger = createReferenceQualityMechanicsLedger({
  route: narratedSeed,
  selectedCapabilityKeys: ["source_attributed_data_story"],
  finalMaster,
  visualRelease: visualRelease(),
  referenceQualityBinding: factualBinding(narratedSeed),
  narrationText: narration,
  dataStorySourceLedger: sourceLedger,
});
const sourceAssetProof = sourceDataLedger.evidence.find((item) =>
  item.requirementId === "source-attributed-data-story-admission",
);
assert.deepEqual(
  sourceAssetProof && {
    measurementState: sourceAssetProof.measurementState,
    proofScope: sourceAssetProof.measurementState === "measured" ? sourceAssetProof.proofScope : undefined,
    proofKind: sourceAssetProof.measurementState === "measured" ? sourceAssetProof.proofKind : undefined,
  },
  {
    measurementState: "measured",
    proofScope: "source_asset",
    proofKind: "data-story-source-ledger/v1",
  },
  "a selected source-data capability records only its typed source asset, never final-master shot coverage",
);
assert.ok(
  sourceDataLedger.evidence
    .filter((item) => item.requirementId !== "source-attributed-data-story-admission")
    .every((item) => item.measurementState === "unmeasured"),
  "a source ledger cannot upgrade the factual reference contract's final-output mechanics",
);
const replayedSourceDataLedger = createReferenceQualityMechanicsLedger({
  route: structuredClone(narratedSeed),
  selectedCapabilityKeys: ["source_attributed_data_story"],
  finalMaster,
  visualRelease: visualRelease(),
  referenceQualityBinding: factualBinding(narratedSeed),
  narrationText: narration,
  dataStorySourceLedger: structuredClone(sourceLedger),
});
assert.equal(
  replayedSourceDataLedger.ledgerFingerprint,
  sourceDataLedger.ledgerFingerprint,
  "a route-bearing retry replays its frozen capability seed without consulting current channel state",
);

assert.throws(
  () => createReferenceQualityMechanicsLedger({
    route: narratedSeed,
    selectedCapabilityKeys: ["z_future_capability", "source_attributed_data_story"],
    finalMaster,
    visualRelease: visualRelease(),
    referenceQualityBinding: factualBinding(narratedSeed),
  }),
  /canonical sorted order/,
  "capability keys must replay their sealed canonical order",
);
assert.throws(
  () => createReferenceQualityMechanicsLedger({
    route: autonomousFactualRoutes[2],
    selectedCapabilityKeys: ["source_attributed_data_story"],
    finalMaster,
    visualRelease: visualRelease(),
    referenceQualityBinding: factualBinding(autonomousFactualRoutes[2]!),
  }),
  /incompatible with the sealed channel route/,
  "a source-data capability cannot be replayed onto a non-narrated route",
);

assert.notEqual(
  channelProgramRouteRunSeedFingerprint(narratedSeed),
  channelProgramRouteRunSeedFingerprint({
    ...narratedSeed,
    directives: {
      ...narratedSeed.directives,
      claimMode: "fictional_scenario_no_external_claims",
    },
  }),
  "the full frozen seed fingerprint changes when a claim-mode directive is tampered",
);

console.log("reference-quality mechanics registry tests passed");
