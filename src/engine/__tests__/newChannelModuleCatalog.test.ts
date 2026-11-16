import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { designPipeline } from "@/engine/designer";
import { MODULE_CATALOG, NEW_CHANNEL_MODULE_CATALOG } from "@/engine/moduleCatalog";
import { configurableModules } from "@/engine/moduleRegistry";
import { resolvePipelineModuleConfig } from "@/engine/runtimeModuleConfig";
import { resolveRequestedChannelVoice } from "@/lib/channelVoiceCasting";

registerAllBlocks();

const narration = NEW_CHANNEL_MODULE_CATALOG.find((module) => module.block === "narration_tts");
assert.ok(narration, "new-channel catalog must retain the narration controls");

const provider = narration.params.find((field) => field.key === "ttsProvider");
assert.deepEqual(
  provider?.options?.map((option) => option.value),
  ["qwen3"],
  "new-channel setup must expose only the selected Qwen narration provider",
);
assert.deepEqual(
  narration.params.find((field) => field.key === "qwenSpeaker")?.options?.map((option) => option.value),
  ["Ryan"],
  "new-channel setup must expose the currently qualified Qwen voice",
);

const onboardingNarration = configurableModules(undefined, "new_channel")
  .find((module) => module.blockId === "narration_tts")?.surface;
assert.ok(onboardingNarration, "the actual onboarding module registry must expose narration controls");
assert.deepEqual(
  onboardingNarration.knobs.find((knob) => knob.id === "ttsProvider")?.values,
  ["qwen3"],
  "the real onboarding UI must expose only Qwen3 for new-channel narration",
);
assert.deepEqual(
  onboardingNarration.knobs.find((knob) => knob.id === "qwenSpeaker")?.values,
  ["Ryan"],
  "the real onboarding UI must expose the currently qualified Qwen speaker",
);
const runtimeNarration = configurableModules(undefined, "runtime")
  .find((module) => module.blockId === "narration_tts")?.surface;
assert.deepEqual(
  runtimeNarration?.knobs.find((knob) => knob.id === "ttsProvider")?.values,
  ["fish", "elevenlabs", "qwen3"],
  "existing channels retain their previously supported narration provider settings",
);

const defaultDesign = designPipeline({ family: "narrated_stock", publishMode: "draft" });
const defaultRuntime = resolvePipelineModuleConfig({
  entries: defaultDesign.pipeline,
  moduleConfig: {},
  scope: "new_channel",
});
assert.equal(defaultRuntime.frozenModuleConfig.narration_tts?.ttsProvider, "qwen3");
assert.equal(defaultRuntime.frozenModuleConfig.narration_tts?.qwenSpeaker, "Ryan");
assert.deepEqual(
  resolveRequestedChannelVoice({
    pipeline: defaultDesign.pipeline,
    moduleConfig: defaultRuntime.frozenModuleConfig,
    locale: "en",
  }),
  { provider: "qwen3", qwenSpeaker: "Ryan", qwenLanguage: "English" },
  "the default new-channel route must resolve to the qualified Qwen voice without a UI override",
);

const legacyNarration = MODULE_CATALOG.find((module) => module.block === "narration_tts");
assert.ok(
  legacyNarration?.params.some((field) => field.key === "qwenSpeaker"),
  "the legacy catalog must retain historic settings for existing channel receipts",
);
assert.match(
  legacyNarration?.params.find((field) => field.key === "ttsProvider")?.options?.find((option) => option.value === "qwen3")?.label ?? "",
  /qualified cloud route/i,
  "the legacy Qwen control must describe the cloud-backed qualified route rather than a retired GPU topology",
);

const whiteboard = MODULE_CATALOG.find((module) => module.block === "whiteboard_scribe");
assert.ok(whiteboard, "the catalog must describe the Whiteboard renderer");
assert.match(
  whiteboard.description,
  /sealed storyboard.*channel-selected narration.*attested Novita line art.*deterministic hand/i,
  "the Whiteboard presentation must describe the production-owned planner, voice, art, and draw paths",
);
assert.doesNotMatch(
  whiteboard.description,
  /Gemini storyboards|Fish narrates/i,
  "the Whiteboard presentation must not advertise retired fixed-provider defaults",
);

console.log("New-channel narration catalog policy tests passed");
