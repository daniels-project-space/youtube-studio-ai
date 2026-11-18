import assert from "node:assert/strict";
import { channelOverviewVoiceSetup } from "../channelOverviewSetup";
import { channelOverviewEffectivePipeline } from "../channelOverviewEffectivePipeline";

const narration = [{ block: "narration_tts", params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } }];
assert.equal(channelOverviewVoiceSetup(narration, undefined, undefined), true);
assert.equal(channelOverviewVoiceSetup(narration, { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Serena" } }, undefined), true);
assert.equal(channelOverviewVoiceSetup(narration, { narration_tts: { ttsProvider: "elevenlabs" } }, "Ryan"), false);
assert.equal(channelOverviewVoiceSetup([{ block: "narration_tts", params: { ttsProvider: "qwen3" } }], undefined, undefined), false);
assert.equal(channelOverviewVoiceSetup([{ block: "loop_clips" }], undefined, undefined), null);
assert.equal(channelOverviewVoiceSetup([{ block: "whiteboard_scribe" }], undefined, undefined), false);
const quotePipeline = [{ block: "quote_overlays", params: { maxQuotes: 2 } }];
assert.equal(channelOverviewEffectivePipeline(quotePipeline, { quote_overlays: { maxQuotes: 5 } })?.[0]?.params?.maxQuotes, 5);
assert.equal(quotePipeline[0]?.params.maxQuotes, 2, "resolving the overview must not mutate the saved pipeline");
assert.equal(channelOverviewEffectivePipeline(quotePipeline, { quote_overlays: { maxQuotes: 500 } }), null);
console.log("Channel overview voice setup contracts passed");
