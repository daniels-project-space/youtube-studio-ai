import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertAutomationNarrationPolicy } from "../automationNarrationPolicy";
import { ExecutionError } from "../executionErrors";

process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";

const narration = (params: Record<string, unknown> = {}) => [{ block: "narration_tts", params }];
const rejected = (fn: () => void, code: string) => assert.throws(fn, (error: unknown) =>
  error instanceof ExecutionError && error.code === code && error.retryable === false);

assert.doesNotThrow(() => assertAutomationNarrationPolicy([{ block: "assemble" }], {}));
assert.doesNotThrow(() => assertAutomationNarrationPolicy([{ block: "whiteboard_scribe" }, ...narration({ ttsProvider: "fish" })], {}, {}), "other projects retain their own narration policy");
for (const block of ["whiteboard_scribe", "motion_comic", "lore_short", "documotion_short"]) {
  rejected(() => assertAutomationNarrationPolicy([{ block, params: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } }], {}), "AUTOMATION_QWEN_MODULE_UNSUPPORTED");
}
for (const params of [{}, { ttsProvider: "fish" }, { ttsProvider: "elevenlabs" }, { ttsProvider: "unknown" }]) {
  rejected(() => assertAutomationNarrationPolicy(narration(params), { voiceId: "Ryan" }), "AUTOMATION_QWEN_CONFIGURATION_REQUIRED");
}
rejected(() => assertAutomationNarrationPolicy(narration({ ttsProvider: "qwen3" }), { voiceId: "legacy-fish-id" }), "AUTOMATION_QWEN_SPEAKER_REQUIRED");
assert.doesNotThrow(() => assertAutomationNarrationPolicy(narration({ ttsProvider: "QWEN3", qwenSpeaker: "Serena" }), { voiceId: "legacy-fish-id" }));
assert.doesNotThrow(() => assertAutomationNarrationPolicy(narration({ ttsProvider: "qwen3" }), { voiceId: "Ryan" }));
rejected(() => assertAutomationNarrationPolicy(narration({ ttsProvider: "qwen3", qwenSpeaker: "bad" }), { voiceId: "Ryan" }), "AUTOMATION_QWEN_SPEAKER_REQUIRED");
const worker = readFileSync(new URL("../../trigger/runPipeline.ts", import.meta.url), "utf8");
const admission = worker.indexOf("assertAutomationNarrationPolicy(entries, seedStore);");
assert.ok(admission > 0, "the real pipeline worker must enforce the policy");
assert.ok(admission < worker.indexOf("child.triggerAndWait(", admission), "admit before paid child dispatch");
assert.ok(admission < worker.indexOf("runEngine(resolved", admission), "admit before module execution");
console.log("AUTOMATION NARRATION POLICY PASS: non-Qwen rejected, legacy voices not substituted, explicit Qwen accepted");
