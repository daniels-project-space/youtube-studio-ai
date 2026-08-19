import assert from "node:assert/strict";
import { gateClip, type FootageBrief } from "@/lib/footagecraft";

// P2-5 (GOLDEN_MODULE_AUDIT_2026-08.md): "visuals" was never test-run
// directly — coverage relied only on the broad production-readiness
// globbing. gateClip() (footagecraft.ts:289, cited in the catalog as
// footagecraft.ts:284-334) is the actual watermark/relevance gate for every
// b-roll clip a channel selects. Its full judged path calls Gemini vision, so
// this test exercises the one branch that's both real, load-bearing, and
// callable with zero network: the explicit degrade-safe fast path when no
// Gemini key is configured. This path matters on its own — if it silently
// flipped to `relevant: false`, every channel running without a configured
// Gemini key would starve its render of b-roll instead of degrading gracefully.

const brief: FootageBrief = {
  topic: "a documentary about deep sea exploration",
  orientation: "landscape",
};

async function run(): Promise<void> {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    // No real video file is touched: hasGeminiKey() is checked before any
    // frame grab or network call, so this exercises the true degrade branch,
    // not a mocked one.
    const result = await gateClip("/nonexistent/clip.mp4", 8, "deep sea footage", brief);
    assert.deepEqual(
      result,
      { relevant: true, score: 8 },
      "gateClip must degrade-safe (relevant:true, score:8) when no Gemini key is configured, never silently reject footage it never actually judged",
    );
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
}

run()
  .then(() => console.log("footagecraftGateClip.test.ts: gateClip degrade-safe (no-Gemini-key) branch verified — never silently starves the render"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
