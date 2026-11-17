import assert from "node:assert/strict";
import { synthNarration } from "../tts";
import { elevenDialogue } from "../motionComic";
import { listAccountVoices } from "../voicecraft";
import { synthQwenNarration } from "../qwenTts";

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  await assert.rejects(synthNarration({ text: "test", provider: "elevenlabs" }), /requires an explicitly selected Qwen/);
  await assert.rejects(synthNarration({ text: "test", provider: "fish" }), /requires an explicitly selected Qwen/);
  await assert.rejects(synthNarration({ text: "test" }), /requires an explicitly selected Qwen/);
  await assert.rejects(synthNarration({ text: "test", provider: "qwen3", qwenSpeaker: "Ryan" }), /project-scoped render handoff/);
  await assert.rejects(synthQwenNarration({ text: "test", speaker: "Ryan" }), /project-scoped render handoff/);
  await assert.rejects(elevenDialogue([{ text: "test", voice_id: "fixture" }]), /requires an explicitly selected Qwen/);
  await assert.rejects(listAccountVoices(), /requires an explicitly selected Qwen/);
  assert.equal(calls, 0);
  console.log("Private Automation rejects non-Qwen narration before any provider call");
}
void main();
