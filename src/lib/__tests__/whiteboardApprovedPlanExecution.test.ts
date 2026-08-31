import assert from "node:assert/strict";

import { castWhiteboardSync, type WhiteboardStoryboard } from "@/lib/whiteboardSync";

const approvedPlan: WhiteboardStoryboard = {
  title: "Approved renderer recovery plan",
  fullText: "A supplied plan must not require the unused remote planner.",
  panels: [{
    idx: 0,
    narration: "A supplied plan must not require the unused remote planner.",
    layers: [{
      kind: "art",
      draw: "a simple approved marker scene",
      color: "black",
      cue: "supplied plan",
      box: [0.2, 0.2, 0.5, 0.5],
    }],
  }],
};

const saved = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  eleven: process.env.ELEVENLABS_API_KEY,
};

async function main(): Promise<void> {
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;

    await assert.rejects(
      () => castWhiteboardSync({
        brief: {
          topic: "approved-plan recovery",
          ttsProvider: "elevenlabs",
          elevenVoiceId: "test-voice",
        },
        runDir: "/tmp/whiteboard-approved-plan-execution-test",
        generateImage: async () => {
          throw new Error("image generation must not be reached before the TTS readiness gate");
        },
        plan: approvedPlan,
      }),
      /ELEVENLABS_API_KEY missing/,
      "a supplied approved plan skips the unused remote storyboard-planner gate before any paid work",
    );
  } finally {
    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.anthropic;
    if (saved.openrouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.openrouter;
    if (saved.eleven === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved.eleven;
  }

  console.log("whiteboard approved-plan execution: PASS");
}

void main();
