import assert from "node:assert/strict";
import type { PipelineEntry } from "@/engine/types";
import { mergeRuntimeModuleConfig, resolvePipelineModuleConfig } from "@/engine/runtimeModuleConfig";
import { materializeRuntimePipelineParams } from "@/engine/pipelineCompiler";
import { bindScriptNarrationTiming, resolveScriptNarrationTiming, weeklyScriptParams } from "@/lib/narrationTimingPlan";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";
import { materializeWorkerPipelineParams, prepareWorkerModuleConfig } from "@/engine/workerPipelineMaterialization";

const entries: PipelineEntry[] = [
  { block: "script_gen", params: { maxSeconds: 360, genre: "documentary" } },
  { block: "narration_tts" },
  { block: "music", params: { trackCount: 2 } },
  { block: "upload_draft" },
];
const configs: Array<Record<string, Record<string, unknown>> | undefined> = [undefined, {}, { music: { prompt: "quiet piano" } }];
for (const config of configs) {
  for (const madeForKids of [false, true]) {
    const previousParams = snapshotParamsByBlock(entries);
    const previousMerge = mergeRuntimeModuleConfig({ entries, paramsByBlock: previousParams, moduleConfig: config });
    Object.assign(previousParams, previousMerge.paramsByBlock);
    const previous = bindScriptNarrationTiming(materializeRuntimePipelineParams(entries, previousParams)).map(entry =>
      entry.block === "upload_draft" && typeof entry.params?.madeForKids !== "boolean"
        ? { ...entry, params: { ...(entry.params ?? {}), madeForKids } } : entry,
    );
    const prepared = prepareWorkerModuleConfig(entries, config);
    assert.deepEqual(prepared.merged, previousMerge);
    assert.deepEqual(materializeWorkerPipelineParams(entries, prepared.paramsByBlock, madeForKids), previous);
    assert.deepEqual(previous.find(entry => entry.block === "narration_tts")?.params?.scriptNarrationTiming, { version: "script-narration-timing/v1", targetSeconds: 360, style: null, genre: "documentary" });
  }
}
const repeatedScripts = [...entries, { block: "script_gen" }];
for (const saved of [false, true]) {
  for (const explicit of [undefined, false, true]) {
    const source: PipelineEntry[] = [{ block: "upload_draft", params: { madeForKids: explicit, title: "unchanged" } }];
    const original = structuredClone(source);
    const params = prepareWorkerModuleConfig(source, undefined).paramsByBlock;
    const result = materializeWorkerPipelineParams(source, params, saved);
    assert.equal(result[0].params?.madeForKids, saved || explicit === true);
    assert.equal(result[0].params?.title, "unchanged");
    assert.deepEqual(source, original);
  }
}
const prepared = prepareWorkerModuleConfig(repeatedScripts, {});
assert.throws(() => materializeWorkerPipelineParams(repeatedScripts, prepared.paramsByBlock, false), /unique script_gen/);
assert.throws(() => prepareWorkerModuleConfig(entries, { music: { noSuchKnob: true } }), /music|knob|config/i);
const pacedEntries: PipelineEntry[] = [
  { block: "script_gen", params: { maxSeconds: 300, genre: "meditation", style: "gentle", ttsSpeed: 1.05, sentenceGapSec: 0.2 } },
  { block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan", ttsSpeed: 1.05, sentenceGapSec: 0.2 } },
];
const pacedOriginal = structuredClone(pacedEntries);
const paceConfig = { narration_tts: { ttsSpeed: 0.9, sentenceGapSec: 0.6 } };
const paced = materializeWorkerPipelineParams(pacedEntries, prepareWorkerModuleConfig(pacedEntries, paceConfig).paramsByBlock, false);
assert.deepEqual(paced[0].params, { maxSeconds: 300, genre: "meditation", style: "gentle", ttsSpeed: 0.9, sentenceGapSec: 0.6 });
assert.equal(paced[1].params?.ttsSpeed, 0.9);
assert.equal(paced[1].params?.sentenceGapSec, 0.6);
assert.deepEqual(paced[1].params?.scriptNarrationTiming, { version: "script-narration-timing/v1", targetSeconds: 300, genre: "meditation", style: "gentle" });
assert.equal(resolveScriptNarrationTiming(paced[1].params?.scriptNarrationTiming, undefined, undefined).profile, "quiet_listening");
assert.deepEqual(weeklyScriptParams({ pipeline: pacedEntries, moduleConfig: paceConfig }), paced[0].params);
assert.deepEqual(resolvePipelineModuleConfig({ entries: pacedEntries, moduleConfig: { narration_tts: { preset: "meditation" } } }).effectivePipeline[0].params, paced[0].params);
const untouched = materializeWorkerPipelineParams(pacedEntries, prepareWorkerModuleConfig(pacedEntries, { narration_tts: { qwenSpeaker: "Ryan" } }).paramsByBlock, false);
assert.deepEqual(untouched[0].params, pacedOriginal[0].params, "a voice-only change must not rewrite script pacing");
const zeroGap = materializeWorkerPipelineParams(pacedEntries, prepareWorkerModuleConfig(pacedEntries, { narration_tts: { sentenceGapSec: 0 } }).paramsByBlock, false);
assert.equal(zeroGap[0].params?.sentenceGapSec, 0);
assert.equal(zeroGap[0].params?.ttsSpeed, 1.05, "an unset speed must retain the saved script value");
assert.deepEqual(pacedEntries, pacedOriginal, "saved pipeline must not be mutated");
console.log("Worker materialization parity passed: overrides, timing, delivery settings and invalid inputs");
