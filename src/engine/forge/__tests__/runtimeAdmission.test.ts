import assert from "node:assert/strict";
import { forgedSpecUsesI2V, makeForgedBlock, registerForgedSpecs } from "@/engine/forge/runtime";
import { _clear, getManifest } from "@/engine/registry";
import type { ForgedModuleSpec } from "@/engine/forge/spec";
import type { StageContext } from "@/engine/types";

const nestedI2vSpec = {
  id: "forged_nested_i2v",
  label: "Nested I2V proof",
  description: "A bounded proof that a nested I2V primitive is detected before execution.",
  whenToUse: "Only when a motion overlay is explicitly required.",
  consumes: ["topic"],
  requiredDownstreamCapabilities: ["master.assembled"],
  produces: "extraOverlays",
  anchorAfter: ["visual_inserts"],
  params: [],
  maxCostUsd: 1,
  steps: [{
    op: "foreach",
    overFrom: "$store.topic",
    max: 1,
    steps: [{
      op: "i2v",
      imageFrom: "$steps.0",
      prompt: "A deliberate, gentle camera push through a historic illustration.",
      durationSec: 5,
    }],
  }],
} as ForgedModuleSpec;

const imageOnlySpec = {
  ...nestedI2vSpec,
  id: "forged_image_only",
  steps: [{ op: "image", prompt: "A text-free archival illustration with clear focal hierarchy." }],
} as ForgedModuleSpec;

// The current schema limits foreach nesting, but runtime stays defensive for
// persisted legacy specs and any future schema expansion.
const deeplyNestedI2vSpec = {
  ...nestedI2vSpec,
  id: "forged_deeply_nested_i2v",
  steps: [{
    op: "foreach",
    overFrom: "$store.topic",
    max: 1,
    steps: [{
      op: "foreach",
      overFrom: "$item.frames",
      max: 1,
      steps: [{
        op: "i2v",
        imageFrom: "$steps.0",
        prompt: "A measured tracking shot that preserves the panel's focal subject.",
        durationSec: 5,
      }],
    }],
  }],
} as unknown as ForgedModuleSpec;

async function assertions(): Promise<void> {
  assert.equal(forgedSpecUsesI2V(nestedI2vSpec), true);
  assert.equal(forgedSpecUsesI2V(deeplyNestedI2vSpec), true);
  assert.equal(forgedSpecUsesI2V(imageOnlySpec), false);

  // `run` checks the I2V runtime before a temp dir, LLM, or image primitive;
  // the intentionally minimal context is therefore enough to exercise it.
  await assert.rejects(
    makeForgedBlock(nestedI2vSpec).run({ stageBudgetUsd: 1 } as StageContext),
    /pipeline video runtime is not admissible[\s\S]*MINIMAX_H3_NOVITA_/,
  );

  // A non-video forged spec cannot fall back to the broader run budget either.
  await assert.rejects(
    makeForgedBlock(imageOnlySpec).run({} as StageContext),
    /requires a positive compiler-admitted stage budget before paid execution/,
  );

  // Forged modules are first-class ABI participants: registration preserves
  // capability requirements instead of silently creating a legacy manifest.
  _clear();
  registerForgedSpecs([{
    ...imageOnlySpec,
    capabilities: ["visuals.forged_overlay"],
    requiredDownstreamCapabilities: ["master.assembled"],
  }]);
  const manifest = getManifest("forged_image_only");
  assert(manifest);
  assert.deepEqual(manifest.capabilities, ["visuals.forged_overlay"]);
  assert.deepEqual(manifest.requiredDownstreamCapabilities, ["master.assembled"]);
  assert.equal(manifest.certification.status, "contract");
}

void assertions().then(() => {
  console.log("forged runtime admission test passed");
});
