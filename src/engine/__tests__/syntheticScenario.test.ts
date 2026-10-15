import assert from "node:assert/strict";

import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { designPipeline } from "@/engine/designer";
import {
  SYNTHETIC_SCENARIO_DISCLOSURE,
  SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
  assertSyntheticScenarioOpeningDisclosure,
  assertSyntheticScenarioContract,
  syntheticScenarioContract,
  syntheticScenarioVisualKindFor,
  syntheticScenarioWritingDirective,
} from "@/engine/syntheticScenario";

for (const profile of ["ai_town", "ai_decision", "ai_pov"] as const) {
  const contract = syntheticScenarioContract(profile);
  assert.deepEqual(assertSyntheticScenarioContract(contract), contract);
  assert.equal(contract.fictional, true);
  assert.equal(contract.visibleDisclosure, SYNTHETIC_SCENARIO_DISCLOSURE);
  assert.match(syntheticScenarioWritingDirective(contract), /not a real simulation or real-world result/);
  assert.deepEqual(
    assertSyntheticScenarioOpeningDisclosure(
      contract,
      `[warm] ${contract.visibleDisclosure}. These illustrative assumptions are not a real simulation.`,
    ),
    {
      version: SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
      profile,
      visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
      openingVerified: true,
    },
  );
  assert.throws(
    () => assertSyntheticScenarioOpeningDisclosure(contract, "A long opening without a disclosure."),
    /must say "FICTIONAL AI SCENARIO"/,
  );
  assert.throws(
    () => assertSyntheticScenarioOpeningDisclosure(
      contract,
      "FICTIONAL AI SCENARIO. These illustrative assumptions describe a real simulation and measured outcomes.",
    ),
    /not a real simulation or real-world result/u,
    "the exact disclosure phrase must not make the real-world disclaimer check tautological",
  );
  assert.throws(
    () => assertSyntheticScenarioOpeningDisclosure(
      contract,
      "This is not a FICTIONAL AI SCENARIO. These illustrative assumptions are not a real simulation.",
    ),
    /must affirm, not negate/u,
  );
}

const scenarioArtifact = artifactContract("syntheticScenario");
assert.equal(scenarioArtifact.type, "SyntheticScenarioContract");
assert.equal(scenarioArtifact.opaque, false);
assert.equal(scenarioArtifact.persist, "reference");
assert.doesNotThrow(() => validateArtifact(scenarioArtifact, syntheticScenarioContract("ai_town")));

const disclosureArtifact = artifactContract("syntheticScenarioDisclosure");
assert.equal(disclosureArtifact.type, "SyntheticScenarioDisclosure");
assert.equal(disclosureArtifact.opaque, false);
assert.equal(disclosureArtifact.persist, "reference");
assert.doesNotThrow(() => validateArtifact(disclosureArtifact, {
  version: SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
  profile: "ai_town",
  visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
  openingVerified: true,
}));
assert.throws(
  () => validateArtifact(disclosureArtifact, {
    version: SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
    profile: "ai_town",
    visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
    openingVerified: false,
  }),
);

assert.equal(syntheticScenarioVisualKindFor("ai_town", 0, 5), "town_overview");
assert.equal(syntheticScenarioVisualKindFor("ai_decision", 2, 5), "decision_outcome");
assert.equal(syntheticScenarioVisualKindFor("ai_pov", 3, 5), "pov_hud");

const designed = designPipeline({
  family: "illustrated_explainer",
  syntheticScenario: syntheticScenarioContract("ai_town"),
});
const blocks = designed.pipeline.map((entry) => entry.block);
const scenario = blocks.indexOf("synthetic_scenario");
const script = blocks.indexOf("script_gen");
const disclosure = blocks.indexOf("scenario_disclosure_gate");
const graph = blocks.indexOf("episode_graph");
const renderer = blocks.indexOf("scene_compiler");
const thumbnail = blocks.indexOf("thumbnail_gen");
assert(scenario >= 0 && scenario < script);
assert(disclosure === script + 1);
assert(graph > disclosure && renderer > graph && thumbnail > renderer);
assert.equal(blocks.filter((block) => block === "thumbnail_gen").length, 1,
  "the scenario lane must use the universal Nano Banana thumbnail block exactly once");

assert.throws(
  () => designPipeline({ family: "narrated_stock", syntheticScenario: syntheticScenarioContract("ai_pov") }),
  /supported only by Illustrated Explainer/,
);

console.log("Synthetic scenario pipeline tests passed");
