import assert from "node:assert/strict";
import {
  assertStudioPostproductionDecisionReceipt,
  createStudioTransitionDecisionReceipt,
} from "@/engine/studioPostproductionDecision";

const SHA = "a".repeat(64);

const defaultDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: undefined,
  explicitTransition: undefined,
  studioTransitionPreset: undefined,
  studioSourceEntryFingerprints: [],
});
assert.equal(defaultDecision.selectionSource, "default");
assert.equal(defaultDecision.transitionPreset, "crossfade");

const studioDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: undefined,
  explicitTransition: undefined,
  studioTransitionPreset: "dip_to_black",
  studioSourceEntryFingerprints: [SHA],
});
assert.equal(studioDecision.selectionSource, "studio_asset");
assert.deepEqual(studioDecision.sourceEntryFingerprints, [SHA]);

const operatorDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: { editor_brief: { transitions: "hardcut" } },
  explicitTransition: "hardcut",
  studioTransitionPreset: "crossfade",
  studioSourceEntryFingerprints: [SHA],
});
assert.equal(operatorDecision.selectionSource, "operator_module_config");
assert.equal(operatorDecision.transitionPreset, "hardcut");
assert.deepEqual(operatorDecision.sourceEntryFingerprints, [], "an operator override must not falsely claim a shadowed Studio template was used");
assert.ok(operatorDecision.editorConfigFingerprint);

const presetDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: { editor_brief: { preset: "documentary" } },
  explicitTransition: "crossfade",
  studioTransitionPreset: undefined,
  studioSourceEntryFingerprints: [],
});
assert.equal(presetDecision.selectionSource, "operator_module_config");

const pipelineDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: { editor_brief: { transitions: "crossfade" } },
  explicitTransition: "hardcut",
  studioTransitionPreset: undefined,
  studioSourceEntryFingerprints: [],
});
assert.equal(pipelineDecision.selectionSource, "pipeline_config", "a mismatched frozen editor config may not be misrepresented as the source of the selected transition");

assert.throws(
  () => assertStudioPostproductionDecisionReceipt({ ...operatorDecision, transitionPreset: "crossfade" }),
  /fingerprint/i,
);
assert.throws(
  () => assertStudioPostproductionDecisionReceipt({ ...studioDecision, sourceEntryFingerprints: [] }),
  /fingerprint|source entry/i,
);

console.log("studio post-production decision tests passed");
