// DOCUMOTION e2e: recreate the reference "archival collage explainer" minute
// (Henry Ford / Fordlandia) — VISUAL ENGINE ONLY (narration/music/SFX are
// separate modules). plan → gated stills+cutouts → draft render → verifier
// refine loop → final 1080p. Artifacts cache in RUN_DIR; delete a file there
// to regenerate that stage.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuMotion } from "../src/lib/documotion.ts";

const log = (m) => console.error(`[documotion] ${m}`);

await bootstrapSecrets((m) => console.error(`[boot] ${m}`), {
  required: ["GEMINI_API_KEY", "FAL_KEY"],
});

const RUN_DIR = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "fordlandia-v2");

const topic =
  "Fordlandia — Henry Ford's failed jungle city. In 1928 Henry Ford bought 2.5 million acres of the Brazilian " +
  "Amazon to grow his own rubber for car tyres and break the British rubber monopoly. He built a slice of Michigan " +
  "in the jungle: white clapboard houses, a golf course, swimming pools, hamburgers in the canteen and strict " +
  "Detroit-style shifts for Brazilian rubber tappers. The rubber trees died of leaf blight, the workers rioted " +
  "against the rules and the food, and Ford lost over $20 million (about $300 million today) without Fordlandia " +
  "ever supplying usable rubber for a single Ford car.";

const referenceNotes =
  "Beat structure to recreate: (1) HOOK parallax_portrait — cutout of Henry Ford in a suit over an industrial " +
  "factory-illustration plate, his name as the giant distressed title behind him, yellow highlight callouts about " +
  "car tyres and his solution; (2) map_zoom — aged halftone satellite-style map of South America, green ring " +
  "labelled AMAZON; (3) photo_slide — taped sepia photos of jungle clearing and town construction sliding over the " +
  "map; (4) matte_sequence — rough matte cuts between the absurd transplants: white clapboard suburban street, " +
  "golf course, swimming pool, factory; (5) parallax portrait of Brazilian workers at a canteen with highlight " +
  "'BRAZILIAN WORKERS' and handwritten notes about American food and strict shifts; (6) collage_pan — slow " +
  "diagonal rostrum pan across a big taped photo board of the whole doomed project; (7) object_drop — ruined " +
  "overgrown factory plate with dollar bundles dropping in, title about the $20 million loss; (8) quote_card " +
  "landing the irony.";

const t0 = Date.now();
const result = await craftDocuMotion({
  topic,
  referenceNotes,
  durationSec: 60,
  runDir: RUN_DIR,
  maxRefineRounds: Number(process.env.DOCU_REFINE_ROUNDS ?? 2),
  log,
});
log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${result.outPath}`);

console.log(
  JSON.stringify(
    {
      out: result.outPath,
      verdict: result.verdict,
      rounds: result.rounds,
      title: result.plan.title,
      shots: result.plan.shots.map(
        (s, i) => `${i}:${s.kind} ${s.durationSec}s cam=${s.camera?.move}/${s.camera?.intensity}`,
      ),
    },
    null,
    2,
  ),
);
