/**
 * Functional check for the narrated text blocks (Stage 3a). Hydrates keys from
 * the vault, asserts the 3a pipeline graph validates, and generates a real
 * script via Gemini. Run: npx tsx scripts/test-narrated.ts
 */
import { bootstrapSecrets } from "@/lib/bootstrap";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { synthScript } from "@/lib/scriptGen";

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
  console.log("\nALL NARRATED 3a CHECKS PASSED");
}

main().catch((e) => {
  console.error("NARRATED TEST FAILED:", e);
  process.exit(1);
});
