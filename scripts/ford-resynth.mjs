// Re-synth the Fordlandia narration with ElevenLabs using the VAULT key (the
// clone's .env.local key is per-key-quota-capped). Same text as the approved VO.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { synthNarration } from "../src/lib/tts.ts";

await bootstrapSecrets(() => {}, {});
// ELEVENLABS_API_KEY is exported by the caller (vault key) and bootstrap won't
// override an existing env var.
const narration =
  "In the late 1920s, desperate to break the British monopoly on rubber, Henry Ford made a staggering gamble. " +
  "He purchased two and a half million acres of deep rainforest in the Brazilian Amazon. Massive tracts of ancient " +
  "jungle were violently cleared to make way for a sprawling American town. Ford transplanted a bizarre slice of " +
  "suburban Michigan directly into the sweltering rainforest, complete with red-roofed bungalows and paved sidewalks. " +
  "Local Brazilian rubber tappers were forced into strict, Detroit-style factory shifts and fed an unfamiliar diet of " +
  "American food. These rigid rules soon sparked violent riots, while a relentless leaf blight decimated the closely " +
  "planted rubber trees. Defeated, Ford abandoned the ruined city, losing over twenty million dollars without ever " +
  "harvesting a single usable tyre. In the end, the vines returned, as the jungle quietly reclaimed Ford's arrogant " +
  "attempt to conquer nature with industry.";

const out = join(process.cwd(), "output", "documotion", "fordlandia-v2", "narration.mp3");
console.error(`[resynth] key tail ...${(process.env.ELEVENLABS_API_KEY || "").slice(-6)}`);
const bytes = await synthNarration({ text: narration, provider: "elevenlabs" });
await writeFile(out, bytes);
console.log(`OK elevenlabs narration ${bytes.length} bytes -> ${out}`);
