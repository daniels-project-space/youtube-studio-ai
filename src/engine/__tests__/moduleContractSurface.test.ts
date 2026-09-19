import assert from "node:assert/strict";
import { moduleContractSurface } from "../moduleContractSurface";

const children = moduleContractSurface(["children_video_treatment", "thumbnail_gen"]);
assert.ok(children, "a registered binding should expose a contract surface");
assert.deepEqual(children.executableIds, ["children_video_treatment", "thumbnail_gen"]);
assert.ok(children.optionalInputs.includes("childrenVideoTreatment"));
assert.ok(children.optionalOutputs.includes("thumbnailScenarioVisualTreatmentProvenance"));
assert.ok(children.capabilities.includes("package.thumbnail"));
assert.ok(children.requiredDownstreamCapabilities.includes("package.thumbnail"));
assert.deepEqual(moduleContractSurface(["missing-module"]), {
  executableIds: ["missing-module"],
  missingExecutableIds: ["missing-module"],
  requiredInputs: [],
  optionalInputs: [],
  requiredCapabilities: [],
  outputs: [],
  optionalOutputs: [],
  capabilities: [],
  requiredDownstreamCapabilities: [],
});

console.log("module contract surface tests passed");
