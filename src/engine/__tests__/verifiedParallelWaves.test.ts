import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { VERIFIED_PARALLEL_GROUPS } from "@/engine/runner";
import { ARCHETYPES } from "@/engine/archetypes";

/**
 * A wave is a small, explicit execution optimization—not a generic DAG guess.
 * This test keeps the admission contract honest when a module's declared
 * inputs/outputs or a preset's order changes.
 */
registerAllBlocks();

const musicWave = VERIFIED_PARALLEL_GROUPS.find((group) =>
  group.includes("music") && group.includes("narration_tts"),
);
assert.deepEqual(musicWave, ["music", "narration_tts"]);

for (const group of VERIFIED_PARALLEL_GROUPS) {
  const manifests = group.map((id) => {
    const manifest = getManifest(id);
    assert.ok(manifest, `parallel wave references unknown block ${id}`);
    return manifest!;
  });
  const produced = new Map<string, string>();
  for (const manifest of manifests) {
    for (const key of Object.keys(manifest.produces)) {
      assert.equal(produced.has(key), false, `${key} has two producers in a parallel wave`);
      produced.set(key, manifest.id);
    }
    for (const key of Object.keys(manifest.optionalProduces)) {
      assert.equal(produced.has(key), false, `${key} has two optional producers in a parallel wave`);
      produced.set(key, manifest.id);
    }
  }
  for (const manifest of manifests) {
    for (const key of [...Object.keys(manifest.consumes), ...Object.keys(manifest.optionalConsumes)]) {
      assert.equal(
        produced.has(key),
        false,
        `${manifest.id} consumes ${key} produced by a sibling in its parallel wave`,
      );
    }
  }
}

for (const key of ["shorts", "meditation"]) {
  const pipeline = ARCHETYPES[key]?.pipeline ?? [];
  const musicIndex = pipeline.findIndex((entry) => entry.block === "music");
  const narrationIndex = pipeline.findIndex((entry) => entry.block === "narration_tts");
  assert.ok(musicIndex >= 0 && narrationIndex >= 0, `${key} must retain both independent stages`);
  assert.equal(Math.abs(musicIndex - narrationIndex), 1, `${key} must keep music/TTS adjacent for the verified wave`);
}

console.log("verified parallel waves preserve independent inputs, outputs, and preset adjacency");
