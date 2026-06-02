/**
 * Functional check for the narrated text blocks (Stage 3a). Hydrates keys from
 * the vault, asserts the 3a pipeline graph validates, and generates a real
 * script via Gemini. Run: npx tsx scripts/test-narrated.ts
 */
import { bootstrapSecrets } from "@/lib/bootstrap";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { synthScript } from "@/lib/scriptGen";
import { synthNarration, hasFishKey, resolveVoiceId } from "@/lib/tts";
import { searchFootage, hasPexelsKey } from "@/lib/footage";

async function main() {
  await bootstrapSecrets((m) => console.log(`[boot] ${m}`));
  registerAllBlocks();

  // 1. Graph check: the 3a chain must validate (consumes satisfied upstream).
  validatePipeline([
    { block: "topic_select" },
    { block: "script_gen", params: { style: "essay", maxSeconds: 120 } },
    { block: "hook_craft" },
    { block: "qa_script" },
  ]);
  console.log("PASS: 3a pipeline graph valid (topic→script→hook→qa)");

  // 2. Live generation.
  const s = await synthScript(
    { topic: "the psychology of procrastination", style: "essay", maxSeconds: 120 },
    (m) => console.log(`[script] ${m}`),
  );
  if (s.sections.length === 0 || s.narrationText.length < 50) {
    throw new Error("FAIL: script too thin");
  }
  console.log("PASS: live script generated");
  console.log("  hook:", s.hook);
  console.log("  sections:", s.sections.length, "| estSec:", s.estDurationSec);
  console.log("  preview:", s.narrationText.slice(0, 220).replace(/\n+/g, " "), "…");

  // 3. Narration graph + live TTS (3b).
  validatePipeline([
    { block: "topic_select" },
    { block: "script_gen" },
    { block: "narration_tts" },
  ]);
  console.log("PASS: narration graph valid (topic→script→narration_tts)");
  console.log("  voice resolve(psychological):", resolveVoiceId("psychological"));
  if (hasFishKey()) {
    const audio = await synthNarration({
      text: "This is a short narration test for the studio pipeline.",
      voiceId: "sleepless_historian",
    });
    if (audio.length < 1000) throw new Error("FAIL: TTS audio too small");
    console.log(`PASS: live TTS produced ${Math.round(audio.length / 1024)}KB mp3`);
  } else {
    console.log("SKIP: no Fish Audio key hydrated (cannot live-test TTS)");
  }
  // 4. Footage graph + live Pexels (3c).
  validatePipeline([
    { block: "topic_select" },
    { block: "script_gen" },
    { block: "stock_footage" },
  ]);
  console.log("PASS: footage graph valid (topic→script→stock_footage)");
  if (hasPexelsKey()) {
    const clips = await searchFootage("rainy city street night", 2, "landscape");
    if (clips.length === 0 || !clips[0].url.includes("http")) {
      throw new Error("FAIL: Pexels returned no clips");
    }
    console.log(`PASS: Pexels returned ${clips.length} clips (${clips[0].width}x${clips[0].height}, ${clips[0].durationSec}s)`);
  } else {
    console.log("SKIP: no Pexels key hydrated");
  }
  console.log("\nALL NARRATED 3a+3b+3c CHECKS PASSED");
}

main().catch((e) => {
  console.error("NARRATED TEST FAILED:", e);
  process.exit(1);
});
