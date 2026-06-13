// DOCUMOTION e2e — detective_board style: a true-crime investigation minute
// built on the EVIDENCE BOARD (pinned photos + red string + prowling camera).
// Visual engine only. plan → gated stills → still-verifier refine loop → 1080p.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuMotion } from "../src/lib/documotion.ts";

const log = (m) => console.error(`[documotion] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "FAL_KEY"] });

const RUN_DIR = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "detective");

const topic =
  "The unsolved 1947 Black Dahlia case — aspiring actress Elizabeth Short found murdered in Los Angeles. " +
  "Walk through the investigation like a detective: the victim, the crime scene, the taunting letters mailed to " +
  "police, the dozens of suspects and false confessions, the press circus, and why — despite hundreds of leads — " +
  "the killer was never caught. Keep it factual and evidentiary, building the web of clues.";

const referenceNotes =
  "Open on an EVIDENCE BOARD: pinned photographs of the victim, the crime scene, and suspects connected by taut " +
  "red string, the camera prowling from clue to clue. Then suspect parallax_portrait reveals, photo_slide of " +
  "evidence (the letters, the locations), a map_zoom of the LA crime scene, an object_drop of a key piece of " +
  "evidence, and a closing quote_card on why it stays unsolved.";

const t0 = Date.now();
const result = await craftDocuMotion({
  topic,
  style: "detective_board",
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
