import assert from "node:assert/strict";
import { channelPipelineWriteFence } from "../channelPipelineWriteFence";

const base = { pipeline: [{ block: "script_gen", params: { maxSeconds: 300 } }], moduleConfig: { narration_tts: { qwenSpeaker: "Ryan" } }, identity: { persona: "calm" }, disabledBlocks: [] };
const fence = channelPipelineWriteFence(base);
assert.equal(fence, channelPipelineWriteFence(structuredClone(base)));
for (const changed of [
  { ...base, pipeline: [{ block: "script_gen", params: { maxSeconds: 600 } }] },
  { ...base, moduleConfig: { narration_tts: { qwenSpeaker: "Serena" } } },
  { ...base, identity: { persona: "energetic" } },
  { ...base, disabledBlocks: ["script_gen"] },
  { ...base, locked: true },
  { ...base, budget: 20 },
]) assert.notEqual(channelPipelineWriteFence(changed), fence);
assert.equal(channelPipelineWriteFence({ ...base, status: "paused" } as typeof base), fence, "non-pipeline status changes do not disturb the fence");
console.log("Pipeline write fence binds execution and configuration inputs");
