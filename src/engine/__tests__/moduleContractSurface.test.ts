import assert from "node:assert/strict";
import { moduleContractSurface } from "../moduleContractSurface";

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

const thumbnail = moduleContractSurface(["thumbnail_gen"]);
assert.ok(thumbnail);
assert.ok(thumbnail.requiredInputs.includes("topic"));
assert.ok(!thumbnail.optionalInputs.includes("topic"), "required artifacts must not be presented as optional");
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
