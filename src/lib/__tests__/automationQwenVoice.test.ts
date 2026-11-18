import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertAutomationVoiceSaved, automationQwenVoiceChange, currentAutomationQwenSpeaker } from "../automationQwenVoice";
import { channelModuleConfigFence } from "../channelModuleConfigFence";
import { resolvePipelineModuleConfig } from "../../engine/runtimeModuleConfig";
import { assertAutomationNarrationPolicy } from "../../engine/automationNarrationPolicy";

const saved = { ttsProvider: "qwen3", qwenSpeaker: "Ryan", ttsSpeed: 0.95 };
const change = automationQwenVoiceChange(saved, "Serena");
assert.deepEqual(change.config, { ...saved, qwenSpeaker: "Serena" });
assert.equal(change.expectedConfigFence, channelModuleConfigFence(saved));
assert.notEqual(change.expectedConfigFence, channelModuleConfigFence({ ...saved, ttsSpeed: 1.05 }));
assert.throws(() => automationQwenVoiceChange(saved, "not-a-speaker"));
assert.throws(() => assertAutomationVoiceSaved({ state: "config_conflict" }), /changed elsewhere/);
assert.throws(() => assertAutomationVoiceSaved({ state: "channel_locked" }), /channel is locked/);
assert.throws(() => assertAutomationVoiceSaved({ state: "module_locked" }), /module is locked/);
assert.doesNotThrow(() => assertAutomationVoiceSaved({}));
assert.equal(currentAutomationQwenSpeaker({ config: change.config, params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" }, identityVoice: "Vivian" }), "Serena");
assert.equal(currentAutomationQwenSpeaker({ config: {}, params: { ttsProvider: "qwen3" }, identityVoice: "Ryan" }), "Ryan");
assert.equal(currentAutomationQwenSpeaker({ config: {}, params: { ttsProvider: "qwen3", qwenSpeaker: " Ryan " } }), "Ryan");
assert.equal(currentAutomationQwenSpeaker({ config: {}, params: { ttsProvider: "fish" }, identityVoice: "Ryan" }), "");

const resolved = resolvePipelineModuleConfig({
  entries: [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } }],
  moduleConfig: { narration_tts: change.config },
});
assert.equal(resolved.effectivePipeline[0]!.params?.qwenSpeaker, "Serena");
assert.equal(resolved.effectivePipeline[0]!.params?.ttsSpeed, 0.95);
assert.doesNotThrow(() => assertAutomationNarrationPolicy(resolved.effectivePipeline, { voiceId: "Ryan" }, { YOUTUBE_AUTOMATION_PRIVATE: "1" }));

const page = readFileSync("src/app/(app)/channels/[slug]/page.tsx", "utf8");
const picker = page.slice(page.indexOf("function AutomationNarratorPicker"), page.indexOf("function NarratorPicker"));
assert.match(picker, /AutomationQwenVoiceControl/);
assert.match(picker, /saveConfig\(\{ channelId:.*blockId: "narration_tts", \.\.\.change/);
console.log("Automation Qwen voice configuration and execution mapping passed");
