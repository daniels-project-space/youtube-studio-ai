// 90-second test on Flash Image, rendered at 2K (2560x1440). Chiquita, 7 beats.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { castWhiteboardSync } from "../src/lib/whiteboardSync.ts";

await bootstrapSecrets((m) => console.error("[boot]", m), { required: ["GEMINI_API_KEY", "FISH_AUDIO_API_KEY"] });

const FACTS =
  "The United Fruit Company (UFC, founded 1899, later Chiquita) dominated bananas across Central America. It owned vast " +
  "plantations, the railroads, the ports, and a fleet of steamships, and it bought politicians. Writer O. Henry coined " +
  "'banana republic' in 1904 for nations whose governments UFC controlled. In 1928 in Ciénaga, Colombia, the army — " +
  "protecting UFC interests — opened fire on striking banana workers (the Banana Massacre), killing an estimated hundreds. " +
  "UFC hired public-relations pioneer Edward Bernays to shape U.S. opinion. In 1952 Guatemala's elected president Jacobo " +
  "Árbenz passed land reform to redistribute UFC's idle land; in 1954 the CIA ran Operation PBSuccess, a coup that " +
  "overthrew him, and Guatemala fell into a civil war in which an estimated 200,000 died. In 2007 successor Chiquita " +
  "pleaded guilty and paid a $25 million fine for funneling about $1.7 million to the AUC, a paramilitary death squad.";

const res = await castWhiteboardSync({
  brief: {
    topic: "Why Chiquita — the banana company once called United Fruit — is the evil 'banana republic' company",
    facts: FACTS,
    header: "CHIQUITA  ·  THE BANANA REPUBLIC",
    panels: 7,
    targetWords: 220,
    width: 2560,
    beats: [
      "the banana company United Fruit (today CHIQUITA), founded 1899 — a private empire stretching across Central America",
      "it owned the land, the railroads and the ports, and it bought the governments; in 1904 O. Henry coined the phrase 'banana republic'",
      "1928 in Colombia — when the workers went on strike, the army opened fire on them: the Banana Massacre",
      "the cover-up — United Fruit hired propaganda pioneer Edward Bernays to shape American opinion",
      "Guatemala, 1954 — after president Árbenz tried land reform, the CIA ran a coup that overthrew him",
      "the aftermath — Guatemala fell into decades of civil war in which an estimated 200,000 people died",
      "2007 and the verdict — Chiquita pleaded guilty, a $25 million fine for money paid to a death squad: a company that rewrote nations for profit",
    ],
  },
  runDir: join(process.cwd(), "output", "whiteboard", "90s"),
  outPath: join(process.cwd(), "output", "whiteboard", "90s", "out.mp4"),
  log: (m) => console.error("[wb]", m),
});
console.log(JSON.stringify({ out: res.outPath, title: res.title, panels: res.panels.length, durationMs: res.durationMs }, null, 2));
