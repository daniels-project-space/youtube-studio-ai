import assert from "node:assert/strict";
import { assertCandidateBenchmarkMaterialization } from "../candidateBenchmarkMaterialization";
import { materializeWorkerPipelineParams, prepareWorkerModuleConfig } from "../../engine/workerPipelineMaterialization";

const entries = [
  { block: "editor_brief", params: { original: "first" } },
  { block: "editor_brief", params: { original: "second" } },
  { block: "qa_visual", params: {} },
];
const config = { editor_brief: { preset: "hype" }, retired_block: { ignored: true } };
const original = structuredClone(entries);
const prepared = prepareWorkerModuleConfig(entries, config);
const actual = materializeWorkerPipelineParams(entries, prepared.paramsByBlock, false);
assertCandidateBenchmarkMaterialization(entries, config, actual);
assert.deepEqual(entries, original);
assert.deepEqual(actual[0].params, actual[1].params, "worker uses the first occurrence's parameters for duplicates");
assert.notDeepEqual(actual, entries, "preset changes worker parameters");
assert.throws(() => assertCandidateBenchmarkMaterialization(entries, config, entries), /materialization/);
assert.throws(() => assertCandidateBenchmarkMaterialization(entries, { editor_brief: { unknown_knob: true } }, actual), /invalid/);
assert.throws(() => assertCandidateBenchmarkMaterialization(entries, config, [...actual, { block: "added_by_policy", params: {} }]), /materialization/);
console.log("candidate benchmark materialization parity and rejection checks passed");
