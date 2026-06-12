// DOCUMOTION e2e: recreate the reference "archival collage explainer" minute
// (Henry Ford / Fordlandia) — plan → stills+cutouts → narration → render →
// underscore+SFX mix → QA gate → R2 share link. Artifacts cache in RUN_DIR;
// delete a file there to regenerate that stage. DOCU_DRAFT=1 = fast 540p
// silent body for iteration.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuVideo } from "../src/lib/documotion.ts";
import { putObject, presignDownload } from "../src/lib/storage.ts";

const log = (m) => console.error(`[documotion] ${m}`);

await bootstrapSecrets((m) => console.error(`[boot] ${m}`), {
  required: ["GEMINI_API_KEY", "FAL_KEY", "SUNO_API_KEY"],
});

const RUN_DIR = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "fordlandia");
const DRAFT = process.env.DOCU_DRAFT === "1";

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
  "golf course, swimming pool, factory; (5) parallax or wide shot of Brazilian workers at a canteen feast with " +
  "highlight 'BRAZILIAN WORKERS' and handwritten notes about American food and strict shifts; (6) collage_pan — " +
  "slow diagonal rostrum pan across a big taped photo board of the whole doomed project; (7) object_drop — ruined " +
  "overgrown factory plate with dollar bundles dropping in, title about the $20 million loss; (8) quote_card " +
  "landing the irony.";

const t0 = Date.now();
const result = await craftDocuVideo({
  topic,
  referenceNotes,
  durationSec: 60,
  runDir: RUN_DIR,
  draft: DRAFT,
  skipQa: process.env.DOCU_SKIP_QA === "1",
  log,
});
log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${result.outPath}`);

let share = null;
if (!DRAFT && process.env.R2_ACCESS_KEY_ID) {
  const key = `documotion/fordlandia/${Date.now()}.mp4`;
  await putObject(key, await readFile(result.outPath), { contentType: "video/mp4" });
  share = await presignDownload(key, { expiresIn: 604800 });
  log(`uploaded → ${key}`);
}

console.log(
  JSON.stringify(
    {
      out: result.outPath,
      share,
      qa: result.qa ?? null,
      title: result.plan.title,
      shots: result.plan.shots.map((s, i) => `${i}:${s.kind} ${result.timings[i]?.startSec.toFixed(1)}-${result.timings[i]?.endSec.toFixed(1)}s`),
    },
    null,
    2,
  ),
);
