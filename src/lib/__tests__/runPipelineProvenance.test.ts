import assert from "node:assert/strict";
import { hasFrozenPipelineProvenance } from "@/lib/runPipelineProvenance";

assert.equal(hasFrozenPipelineProvenance({}), false);
assert.equal(hasFrozenPipelineProvenance({ pipelineInvocationSnapshot: {} }), false);
assert.equal(hasFrozenPipelineProvenance({ pipelineInvocationSha256: "receipt" }), false);
assert.equal(hasFrozenPipelineProvenance({ pipelineInvocationSnapshot: {}, pipelineInvocationSha256: "  " }), false);
assert.equal(hasFrozenPipelineProvenance({ pipelineInvocationSnapshot: {}, pipelineInvocationSha256: "receipt" }), true);

console.log("run pipeline provenance tests passed");
