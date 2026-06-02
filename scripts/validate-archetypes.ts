import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { ARCHETYPES } from "@/engine/archetypes";
import { LOFI_PIPELINE } from "@/trigger/blocks/lofiBlocks";

registerAllBlocks();
let ok = true;
for (const [key, a] of Object.entries(ARCHETYPES)) {
  try {
    const resolved = validatePipeline(a.pipeline);
    console.log(`OK   archetype ${key} (${resolved.blocks.length} blocks)`);
  } catch (e) {
    ok = false;
    console.log(`FAIL archetype ${key}: ${e instanceof Error ? e.message : e}`);
  }
}
try {
  const resolved = validatePipeline(LOFI_PIPELINE);
  console.log(`OK   LOFI_PIPELINE (${resolved.blocks.length} blocks)`);
} catch (e) {
  ok = false;
  console.log(`FAIL LOFI_PIPELINE: ${e instanceof Error ? e.message : e}`);
}
console.log(ok ? "\nALL ARCHETYPES VALID" : "\nVALIDATION FAILURES");
process.exit(ok ? 0 : 1);
