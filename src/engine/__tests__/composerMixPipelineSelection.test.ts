import assert from "node:assert/strict";
import { designPipeline } from "@/engine/designer";
import { COMPOSER_MIX_ASSEMBLY_VERSION, selectComposerMixAssembly } from "@/engine/composerMixPipelineSelection";
import type { PipelineEntry } from "@/engine/types";

const source: PipelineEntry[] = [
  { block: "composer_brief", params: { musicIntent: { role: "primary_music" } } },
  { block: "music", params: { seed: 42 } },
  { block: "timeline_assemble", params: { durationSec: 600 } },
];
const selected = selectComposerMixAssembly(source);
assert.equal(selected[2].version, COMPOSER_MIX_ASSEMBLY_VERSION);
assert.equal(source[2].version, undefined, "selection does not mutate the source pipeline");
assert.deepEqual(selected[2].params, source[2].params);

const pinned = source.map((entry, index) => index === 2 ? { ...entry, version: "1.0.0-channel-pin" } : entry);
assert.equal(selectComposerMixAssembly(pinned)[2].version, "1.0.0-channel-pin");
assert.equal(selectComposerMixAssembly([source[0], source[1]])[1].version, undefined, "selection needs a timeline consumer");
assert.equal(selectComposerMixAssembly([source[1], source[1], source[2]])[2].version, undefined);
assert.equal(selectComposerMixAssembly([source[2], source[1]])[0].version, undefined, "consumer cannot precede its music producer");

const designed = designPipeline({ family: "narrated_stock", nicheKey: "stoic philosophy resilience" });
const musicIndex = designed.pipeline.findIndex((entry) => entry.block === "music");
const assemblyIndex = designed.pipeline.findIndex((entry) => entry.block === "timeline_assemble");
assert.ok(musicIndex >= 0 && assemblyIndex > musicIndex, "real narrated design has ordered shared music and timeline assembly");
assert.equal(designed.pipeline[assemblyIndex].version, COMPOSER_MIX_ASSEMBLY_VERSION,
  "new channel design selects the registered module that consumes the music mix handoff");

const loop = designPipeline({ family: "music_loop", nicheKey: "lofi" });
assert.equal(loop.pipeline.find((entry) => entry.block === "assemble")?.version, undefined,
  "loop assembly remains owned by its separate duration-safe module");

console.log("COMPOSER MIX PIPELINE SELECTION PASS: safe selection rules, real narrated design adoption, loop and explicit-version isolation");
