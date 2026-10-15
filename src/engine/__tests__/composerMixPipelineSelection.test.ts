import assert from "node:assert/strict";
import { designPipeline } from "@/engine/designer";
import { COMPOSER_MIX_ASSEMBLY_VERSION, selectComposerMixAssembly } from "@/engine/composerMixPipelineSelection";
import {
  CHANNEL_AWARE_SCRIPT_GEN_VERSION,
  CHANNEL_AWARE_SCRIPT_QA_VERSION,
  selectChannelAwareScriptQa,
} from "@/engine/channelAwareScriptQaSelection";
import { channelPipelineValidationSeedKeys } from "@/engine/channelPipelineSeedKeys";
import { contentLaneForFamily } from "@/engine/contentLane";
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

const scriptSource: PipelineEntry[] = [
  { block: "script_gen" }, { block: "qa_script", params: { strict: true } }, { block: "narration_tts" },
];
const scriptSelected = selectChannelAwareScriptQa(scriptSource);
assert.equal(scriptSelected[1].version, CHANNEL_AWARE_SCRIPT_QA_VERSION);
assert.equal(scriptSource[1].version, undefined, "selection does not mutate the source pipeline");
assert.deepEqual(scriptSelected[1].params, scriptSource[1].params);
assert.equal(selectChannelAwareScriptQa([
  scriptSource[0], { ...scriptSource[1], version: "1.0.0-channel-pin" }, scriptSource[2],
])[1].version, "1.0.0-channel-pin", "explicit legacy or channel versions remain pinned");
assert.equal(selectChannelAwareScriptQa([scriptSource[1], scriptSource[0]])[0].version, undefined,
  "the channel critic is not selected before its script producer");

const qaIndex = designed.pipeline.findIndex((entry) => entry.block === "qa_script");
const scriptIndex = designed.pipeline.findIndex((entry) => entry.block === "script_gen");
assert.ok(qaIndex > scriptIndex,
  "real narrated design includes an ordered script critic");
assert.equal(designed.pipeline[qaIndex].version, CHANNEL_AWARE_SCRIPT_QA_VERSION,
  "new narrated channel designs select the channel-conditioned critic");
assert.equal(designed.pipeline[scriptIndex].version, CHANNEL_AWARE_SCRIPT_GEN_VERSION,
  "new narrated channel designs pair identity-grounded writing with its channel-conditioned critic");
assert.ok(channelPipelineValidationSeedKeys(contentLaneForFamily("narrated_stock")!, undefined, designed.pipeline)
  .includes("showBible"),
  "the selected production graph declares its frozen channel identity seed");
assert.equal(loop.pipeline.some((entry) => entry.block === "qa_script"), false,
  "music-loop pipelines do not acquire a script critic they do not use");

console.log("MODULE VERSION SELECTION PASS: composer mix and channel-aware script QA select on real new designs while preserving pins and unrelated loop routes");
