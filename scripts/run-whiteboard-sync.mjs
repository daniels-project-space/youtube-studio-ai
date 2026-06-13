// Standalone-module smoke test: drive the WHOLE synced whiteboard pipeline
// through src/lib/whiteboardSync.ts (one call) instead of the ad-hoc scripts.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { castWhiteboardSync } from "../src/lib/whiteboardSync.ts";

await bootstrapSecrets((m) => console.error("[boot]", m), { required: ["GEMINI_API_KEY", "FISH_AUDIO_API_KEY"] });

const FACTS =
  "The United Fruit Company (UFC, founded 1899, later Chiquita) dominated the banana trade across Central America. Writer " +
  "O. Henry coined 'banana republic' in 1904 for nations whose economies and governments UFC controlled. UFC owned vast " +
  "land, the railroads and ports, and bought politicians. In 1928 in Ciénaga, Colombia, the army — protecting UFC interests " +
  "— opened fire on striking banana workers (the Banana Massacre), killing into the hundreds. UFC hired PR pioneer Edward " +
  "Bernays to shape U.S. opinion. In 1954 the CIA backed a coup (PBSuccess) that overthrew Guatemala's elected Jacobo Árbenz " +
  "after his land reform threatened UFC. In 2007 successor Chiquita pleaded guilty and paid a $25 million fine for funneling " +
  "about $1.7 million to a Colombian paramilitary death squad (the AUC), a designated terrorist group.";

const res = await castWhiteboardSync({
  brief: {
    topic: "Why Chiquita — the banana company once called United Fruit — is the evil 'banana republic' company",
    facts: FACTS,
    header: "CHIQUITA  ·  THE BANANA REPUBLIC",
    beats: [
      "the banana company United Fruit (today CHIQUITA), founded 1899, owns the land, railroads, ports and politicians of Central America",
      "writer O. Henry coins 'banana republic' (1904) for these captive nations",
      "the 1928 Banana Massacre — the army guns down striking banana workers in Colombia",
      "propaganda man Edward Bernays + the 1954 CIA coup that overthrows Guatemala's elected Árbenz",
      "2007 — Chiquita pleads guilty, a $25M fine for ~$1.7M paid to the AUC death squad",
      "verdict — a company that rewrote whole nations for profit",
    ],
  },
  runDir: join(process.cwd(), "output", "whiteboard", "module-test"),
  outPath: join(process.cwd(), "output", "whiteboard", "module-test", "out.mp4"),
  log: (m) => console.error("[wb]", m),
});
console.log(JSON.stringify({ out: res.outPath, title: res.title, panels: res.panels.length, durationMs: res.durationMs }, null, 2));
