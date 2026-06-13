// DOCUMOTION e2e — robbery_noir style: a real heist reconstructed with the
// depth_parallax capability (Banana stills → 2.5D camera-through-photo). Proves
// the module COMPOSES capabilities for a new style, not a hardcoded pipeline.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuMotion } from "../src/lib/documotion.ts";

const log = (m) => console.error(`[documotion] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "FAL_KEY"] });

const RUN_DIR = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "robbery");

const topic =
  "The 2003 Antwerp Diamond Heist — often called the heist of the century. Leonardo Notarbartolo and the 'School of " +
  "Turin' bypassed a vault protected by ten layers of security (a combination lock, infrared heat detectors, a " +
  "seismic sensor, a magnetic field, and a guarded door two floors underground) and stole an estimated $100+ million " +
  "in diamonds, gold and jewellery. Reconstruct how they cased the building for years, defeated each sensor, and how " +
  "a bag of half-eaten sandwiches and a partial DNA trace finally undid them.";

const referenceNotes =
  "Reconstruct it cinematically: open on the diamond vault in the dark (depth_parallax, camera drifting in past the " +
  "foreground gate to the safe behind), establish the Antwerp Diamond Centre, walk the crew casing the building and " +
  "defeating each sensor as depth_parallax reconstruction scenes, an object_drop of the loot, a map_zoom of Antwerp, " +
  "and close on how the sandwiches betrayed them.";

const t0 = Date.now();
const result = await craftDocuMotion({
  topic,
  style: "robbery_noir",
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
      shots: result.plan.shots.map((s, i) => `${i}:${s.kind} ${s.durationSec}s cam=${s.camera?.move}/${s.camera?.intensity}`),
    },
    null,
    2,
  ),
);
