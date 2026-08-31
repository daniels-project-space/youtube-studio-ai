import assert from "node:assert/strict";

import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  assertScenarioVisualTreatmentBinding,
  assertScenarioVisualTreatmentThumbnailProvenance,
  assertScenarioVisualTreatmentThumbnailProvenanceForRoute,
  createScenarioVisualTreatmentFromRoute,
  createScenarioVisualTreatmentThumbnailBinding,
  createScenarioVisualTreatmentThumbnailProvenance,
  resolveScenarioVisualTreatmentForNewVisualArtifact,
  resolveScenarioVisualTreatmentForRoute,
  scenarioVisualTreatmentThumbnailQaPassed,
} from "@/engine/scenarioVisualTreatment";
import {
  SYNTHETIC_SCENARIO_DISCLOSURE,
  SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
  syntheticScenarioContract,
} from "@/engine/syntheticScenario";

const topic = "A fictional town tests one impossible civic trade-off";
const fictionalBrief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "educational",
  locale: "en",
  concept: "A clearly disclosed fictional scenario show with repeatable visual rules.",
  programIntent: { kind: "fictional_scenario", profile: "ai_town" },
});
const fictionalRoute = resolveChannelProgramRoute(fictionalBrief);
const fictionalSeed = channelProgramRouteRunSeed({
  route: fictionalRoute,
  programBrief: fictionalBrief,
});

assert(fictionalSeed.requiredBlocks.includes("scenario_visual_treatment"));
const treatment = createScenarioVisualTreatmentFromRoute({ route: fictionalSeed, topic });
assert.equal(treatment.profile, "ai_town");
assert.equal(treatment.policy.depiction, "fictional_illustrative_only");
assert.equal(treatment.policy.realEntityHandling, "prohibited");
assert.equal(treatment.policy.realPlaceHandling, "prohibited");
assert.equal(treatment.policy.stockFootage, "prohibited");
assert.equal(treatment.policy.entityImagery, "prohibited");
assert.equal(treatment.policy.disclosure.visibleDisclosure, SYNTHETIC_SCENARIO_DISCLOSURE);

assert.doesNotThrow(() => assertScenarioVisualTreatmentBinding({
  treatment,
  route: fictionalSeed,
  topic,
  scenario: syntheticScenarioContract("ai_town"),
  disclosure: {
    version: SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
    profile: "ai_town",
    visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
    openingVerified: true,
  },
}));

assert.throws(
  () => assertScenarioVisualTreatmentBinding({
    treatment: { ...treatment, profile: "ai_pov" },
    route: fictionalSeed,
    topic,
    scenario: syntheticScenarioContract("ai_town"),
  }),
  /fingerprint|profile/i,
  "a treatment payload cannot be retargeted to a different fictional visual grammar",
);
assert.throws(
  () => assertScenarioVisualTreatmentBinding({
    treatment,
    route: fictionalSeed,
    topic: "A different topic must not reuse the sealed treatment",
    scenario: syntheticScenarioContract("ai_town"),
  }),
  /topic fingerprint/i,
);

assert.throws(
  () => resolveScenarioVisualTreatmentForRoute({
    treatment: undefined,
    route: fictionalSeed,
    scenario: syntheticScenarioContract("ai_town"),
    topic,
    consumer: "test",
  }),
  /requires its sealed scenario visual treatment/i,
  "a current fictional route must not bypass the receipt",
);

const thumbnailBinding = createScenarioVisualTreatmentThumbnailBinding(treatment);
const thumbnailProvenance = createScenarioVisualTreatmentThumbnailProvenance({
  treatment,
  binding: thumbnailBinding,
  thumbnailRequestHash: "a".repeat(64),
  qaRequestHash: "b".repeat(64),
  artifactSha256: "c".repeat(64),
  visualTreatmentCompliant: true,
});
assert.doesNotThrow(() => assertScenarioVisualTreatmentThumbnailProvenance({
  provenance: thumbnailProvenance,
  treatment,
  thumbnailArtifactSha256: "c".repeat(64),
  consumer: "test",
}));
assert.doesNotThrow(() => assertScenarioVisualTreatmentThumbnailProvenanceForRoute({
  provenance: thumbnailProvenance,
  route: fictionalSeed,
  thumbnailArtifactSha256: "c".repeat(64),
  consumer: "test",
  operation: "publish thumbnail package art",
}));
assert.throws(
  () => assertScenarioVisualTreatmentThumbnailProvenance({
    provenance: thumbnailProvenance,
    treatment,
    thumbnailArtifactSha256: "d".repeat(64),
    consumer: "test",
  }),
  /thumbnail bytes/i,
  "upload must not reuse treatment provenance after a thumbnail object swap",
);
assert.throws(
  () => assertScenarioVisualTreatmentThumbnailProvenance({
    provenance: { ...thumbnailProvenance, qaRequestHash: "e".repeat(64) },
    treatment,
    thumbnailArtifactSha256: "c".repeat(64),
    consumer: "test",
  }),
  /fingerprint/i,
  "a QA-request tamper must invalidate sealed thumbnail provenance",
);
assert.equal(
  scenarioVisualTreatmentThumbnailQaPassed({ visualTreatmentCompliant: true }),
  true,
  "fictional package art requires an explicit positive treatment finding",
);
assert.equal(
  scenarioVisualTreatmentThumbnailQaPassed({ visualTreatmentCompliant: false }),
  false,
  "a treatment rejection can never become publishable through the generic thumbnail gate",
);
assert.equal(
  scenarioVisualTreatmentThumbnailQaPassed({}),
  false,
  "a malformed or unavailable treatment verdict fails closed for fictional package art",
);

// Historical seeds remain explicitly legacy: readable/resumable, but unable to
// pretend they have the new policy merely because they carry a scenario.
const legacySeed = {
  ...fictionalSeed,
  requiredBlocks: fictionalSeed.requiredBlocks.filter((block) => block !== "scenario_visual_treatment"),
};
assert.equal(resolveScenarioVisualTreatmentForRoute({
  treatment: undefined,
  route: legacySeed,
  scenario: syntheticScenarioContract("ai_town"),
  topic,
  consumer: "test",
}), undefined);
assert.throws(
  () => resolveScenarioVisualTreatmentForNewVisualArtifact({
    treatment: undefined,
    route: legacySeed,
    scenario: syntheticScenarioContract("ai_town"),
    topic,
    consumer: "test",
    operation: "generate thumbnail package art",
  }),
  /legacy fictional route remains readable but cannot generate thumbnail package art/i,
  "legacy fictional routes are readable but cannot create new unbound package art",
);
assert.throws(
  () => assertScenarioVisualTreatmentThumbnailProvenanceForRoute({
    provenance: thumbnailProvenance,
    route: legacySeed,
    thumbnailArtifactSha256: "c".repeat(64),
    consumer: "test",
    operation: "publish thumbnail package art",
  }),
  /legacy fictional route remains readable but cannot publish thumbnail package art/i,
  "a delayed publisher cannot reinterpret legacy fictional package art as nonfiction",
);

const artifact = artifactContract("scenarioVisualTreatment");
assert.equal(artifact.type, "ScenarioVisualTreatment");
assert.equal(artifact.persist, "reference");
assert.doesNotThrow(() => validateArtifact(artifact, treatment));
const thumbnailProvenanceArtifact = artifactContract("thumbnailScenarioVisualTreatmentProvenance");
assert.equal(thumbnailProvenanceArtifact.type, "ScenarioVisualTreatmentThumbnailProvenance");
assert.equal(thumbnailProvenanceArtifact.opaque, false);
assert.equal(thumbnailProvenanceArtifact.persist, "reference");
assert.doesNotThrow(() => validateArtifact(thumbnailProvenanceArtifact, thumbnailProvenance));

const nonfictionBrief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "educational",
  locale: "en",
  concept: "A general illustrated explainer without fictional scenario claims.",
});
const nonfictionRoute = resolveChannelProgramRoute(nonfictionBrief);
const nonfictionSeed = channelProgramRouteRunSeed({ route: nonfictionRoute, programBrief: nonfictionBrief });
assert.throws(
  () => createScenarioVisualTreatmentFromRoute({ route: nonfictionSeed, topic }),
  /not admitted|not a fictional/i,
  "a baseline/nonfiction route cannot manufacture a fictional visual treatment",
);
assert.equal(resolveScenarioVisualTreatmentForNewVisualArtifact({
  treatment: undefined,
  route: nonfictionSeed,
  topic,
  consumer: "test",
  operation: "publish thumbnail package art",
}), undefined, "normal legacy/nonfiction package-art flow remains treatment-free");
assert.equal(assertScenarioVisualTreatmentThumbnailProvenanceForRoute({
  provenance: undefined,
  route: nonfictionSeed,
  consumer: "test",
  operation: "publish thumbnail package art",
}), undefined, "nonfiction publisher paths do not require fictional thumbnail provenance");
assert.equal(resolveScenarioVisualTreatmentForNewVisualArtifact({
  treatment: undefined,
  route: undefined,
  topic,
  consumer: "test",
  operation: "publish thumbnail package art",
}), undefined, "route-less historical work remains readable without a treatment");

console.log("Scenario visual treatment tests passed");
