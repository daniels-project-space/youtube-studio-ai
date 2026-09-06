/**
 * The b-roll relevance gate must actually run when it can, and say so when it cannot.
 *
 * gateClip is the watermark/relevance/grade gate for every stock clip a channel
 * selects. Its judged path goes through visionLocal on the OpenRouter route —
 * but its GUARD still asked hasGeminiKey(), which is hard-wired to false
 * ("Generic Gemini is intentionally unavailable"). So the gate returned
 * `{relevant: true, score: 8}` for every clip, on every run, without judging one.
 *
 * The previous version of this test asserted exactly that degrade branch, by
 * deleting GEMINI_API_KEY — and it passed for the wrong reason. hasGeminiKey()
 * ignores the environment entirely, so the branch under test was the only branch
 * reachable, and a test that cannot fail is not evidence. Its own comment also
 * said "its full judged path calls Gemini vision", which had stopped being true.
 *
 * So this now pins the DISCRIMINATION rather than one branch:
 *
 *   no vision provider   degrade safe — accept unjudged, and LOG it, because a
 *                        gate that cannot run must not look like one that passed
 *   vision available     the guard is passed and the real path is entered
 *
 * The two are told apart without a network call or a real video: with a
 * nonexistent file the judged path fails every frame grab and returns score 5,
 * while the degrade branch returns score 8. Different values, so the assertion
 * cannot be satisfied by the wrong branch.
 */
import assert from "node:assert/strict";
import { gateClip, type FootageBrief } from "@/lib/footagecraft";

const brief: FootageBrief = {
  topic: "a documentary about deep sea exploration",
  orientation: "landscape",
};

const saved = {
  providers: process.env.VISION_PROVIDERS,
  openrouter: process.env.OPENROUTER_API_KEY,
  disable: process.env.VISION_DISABLE_GEMINI,
};

function restore(): void {
  for (const [key, value] of Object.entries({
    VISION_PROVIDERS: saved.providers,
    OPENROUTER_API_KEY: saved.openrouter,
    VISION_DISABLE_GEMINI: saved.disable,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function run(): Promise<void> {
  // ---- no vision provider: degrade safe, and SAY SO ----------------------
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.VISION_PROVIDERS;
  const logs: string[] = [];
  const degraded = await gateClip("/nonexistent/clip.mp4", 8, "deep sea footage", brief, (m) => logs.push(m));
  assert.deepEqual(
    degraded,
    { relevant: true, score: 8 },
    "with no vision provider the gate must accept rather than starve the render of b-roll it never judged",
  );
  assert.ok(
    logs.some((l) => /GATE DID NOT RUN/.test(l)),
    `a gate that cannot run must not be silent about it; got: ${JSON.stringify(logs)}`,
  );

  // ---- vision available: the guard is passed ------------------------------
  // score 5, not 8: the judged path was entered, every frame grab failed on the
  // nonexistent file, and it returned its own no-frames result. Nothing here
  // reaches the network.
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.VISION_PROVIDERS = "openrouter";
  const entered = await gateClip("/nonexistent/clip.mp4", 8, "deep sea footage", brief, () => {});
  assert.notDeepEqual(
    entered,
    { relevant: true, score: 8 },
    "with a vision provider configured the gate must ENTER its judged path, not return the degrade shortcut",
  );
  assert.equal(entered.score, 5, "the no-frames result of the judged path");
}

run()
  .then(() => {
    restore();
    console.log("FOOTAGE GATE PASS — it runs when it can, and names the loss when it cannot");
  })
  .catch((error) => {
    restore();
    console.error(error);
    process.exitCode = 1;
  });
