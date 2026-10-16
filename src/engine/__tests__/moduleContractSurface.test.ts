import assert from "node:assert/strict";
import { registerAllBlocks } from "../blocks";
import { allManifests } from "../registry";
import { GENERATED_MODULE_ABI } from "../generatedModuleAbi";
import { moduleAbiFromManifests, moduleContractSurface } from "../moduleContractSurface";

const children = moduleContractSurface(["children_video_treatment", "thumbnail_gen"]);
assert.ok(children, "a registered binding should expose a contract surface");
assert.deepEqual(children.executableIds, ["children_video_treatment", "thumbnail_gen"]);
assert.ok(children.optionalInputs.includes("childrenVideoTreatment"));
assert.ok(children.optionalOutputs.includes("thumbnailScenarioVisualTreatmentProvenance"));
assert.ok(children.capabilities.includes("package.thumbnail"));
assert.ok(children.requiredDownstreamCapabilities.includes("package.thumbnail"));
assert.equal(children.requiredDownstreamConsumes["package.thumbnail"], "childrenVideoTreatment");
assert.deepEqual(children.downstreamContracts["package.thumbnail"], {
  key: "childrenVideoTreatment",
  type: "ChildrenVideoTreatment",
  version: "1.0.0",
  persist: "reference",
  opaque: false,
});
assert.equal(children.requiredInputContracts.find((item) => item.key === "episodeGraph")?.type, "EpisodeGraph");
assert.ok(children.outputs.includes("childrenVideoTreatment"), "required artifact outputs come from executable manifests");

const thumbnail = moduleContractSurface(["thumbnail_gen"]);
assert.ok(thumbnail);
assert.ok(thumbnail.requiredInputs.includes("topic"));
assert.ok(!thumbnail.optionalInputs.includes("topic"), "required artifacts must not be presented as optional");
assert.ok(thumbnail.outputs.length > 0, "module returns list required artifacts as well as capabilities");
assert.deepEqual(moduleContractSurface(["missing-module"]), {
  executableIds: ["missing-module"],
  missingExecutableIds: ["missing-module"],
  requiredInputs: [],
  optionalInputs: [],
  requiredInputContracts: [],
  optionalInputContracts: [],
  requiredCapabilities: [],
  outputs: [],
  optionalOutputs: [],
  outputContracts: [],
  optionalOutputContracts: [],
  capabilities: [],
  requiredDownstreamCapabilities: [],
  requiredDownstreamConsumes: {},
  downstreamContracts: {},
});

console.log("module contract surface tests passed");

registerAllBlocks();
const manifests = allManifests();
assert.deepEqual(
  GENERATED_MODULE_ABI,
  moduleAbiFromManifests(manifests),
  "generated operator ABI must match every executable runtime manifest",
);
for (const manifest of manifests) {
  const surface = moduleContractSurface([manifest.id]);
  const expected = GENERATED_MODULE_ABI.modules[manifest.id];
  assert.ok(surface && expected, `${manifest.id} has a generated operator surface`);
  assert.deepEqual(surface.requiredInputContracts, expected.requiredInputs.map((key) => GENERATED_MODULE_ABI.artifacts[key]), `${manifest.id} required inputs`);
  assert.deepEqual(surface.optionalInputContracts, expected.optionalInputs.map((key) => GENERATED_MODULE_ABI.artifacts[key]), `${manifest.id} optional inputs`);
  assert.deepEqual(surface.outputContracts, expected.outputs.map((key) => GENERATED_MODULE_ABI.artifacts[key]), `${manifest.id} required outputs`);
  assert.deepEqual(surface.optionalOutputContracts, expected.optionalOutputs.map((key) => GENERATED_MODULE_ABI.artifacts[key]), `${manifest.id} optional outputs`);
  assert.deepEqual(surface.downstreamContracts, Object.fromEntries(Object.entries(expected.requiredDownstreamConsumes)
    .map(([capability, key]) => [capability, GENERATED_MODULE_ABI.artifacts[key]])), `${manifest.id} downstream artifact contracts`);
}
console.log(`module ABI drift check passed: ${Object.keys(GENERATED_MODULE_ABI.modules).length} executable modules`);
