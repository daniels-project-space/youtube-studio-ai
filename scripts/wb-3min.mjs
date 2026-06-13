// 3-minute test of the middle-ground engine: hero scene + supporting keyword
// sketches per panel. United Fruit / Chiquita, 12 beats, ~440 words.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { castWhiteboardSync } from "../src/lib/whiteboardSync.ts";

await bootstrapSecrets((m) => console.error("[boot]", m), { required: ["GEMINI_API_KEY", "FISH_AUDIO_API_KEY"] });

const FACTS =
  "The United Fruit Company (UFC, founded 1899, later United Brands, then Chiquita) was the dominant banana company in " +
  "Central America. It owned vast plantations (millions of acres), the railroads, the ports, telegraph lines, and a fleet " +
  "of refrigerated steamships known as the Great White Fleet. Writer O. Henry coined 'banana republic' in 1904 for nations " +
  "whose economies and governments UFC controlled. It bought politicians and shaped tax and land laws across Guatemala, " +
  "Honduras and Colombia. In 1928 in Ciénaga, Colombia, the army — protecting UFC interests — opened fire on striking " +
  "banana workers (the Banana Massacre), killing an estimated hundreds. UFC hired public-relations pioneer Edward Bernays " +
  "to shape U.S. opinion. In 1952 Guatemala's elected president Jacobo Árbenz passed land reform to redistribute UFC's idle " +
  "land to peasants. UFC lobbied Washington, casting Árbenz as a communist threat. In 1954 the CIA ran Operation PBSuccess, " +
  "a coup that overthrew Árbenz. Guatemala then fell into a civil war lasting decades in which an estimated 200,000 people " +
  "died. In 2007 successor Chiquita pleaded guilty and paid a $25 million fine for funneling about $1.7 million to the AUC, " +
  "a Colombian paramilitary death squad and designated terrorist group.";

const res = await castWhiteboardSync({
  brief: {
    topic: "The full dark history of Chiquita — the banana company once called United Fruit — and the banana republics it built",
    facts: FACTS,
    header: "CHIQUITA  ·  THE BANANA REPUBLIC",
    panels: 12,
    targetWords: 440,
    width: 1920,
    beats: [
      "the banana company United Fruit (today CHIQUITA), founded 1899 — the most powerful fruit company on earth, a private empire across Central America",
      "it owned the LAND — millions of acres of banana plantations, more land than most of the governments around it",
      "it owned the infrastructure — the railroads, the ports, the telegraph lines, and the Great White Fleet of steamships",
      "it owned the politics — buying presidents and writing the tax laws; in 1904 O. Henry coined the phrase 'banana republic' for these captive nations",
      "the workers paid the price — brutal conditions, company scrip instead of money, and no rights on the plantations",
      "1928 in Colombia — when the workers went on strike, the army opened fire on them: the Banana Massacre",
      "the cover-up — United Fruit hired propaganda pioneer Edward Bernays to bury the story and shape American opinion",
      "Guatemala, 1952 — the elected president Jacobo Árbenz passed a land reform to hand United Fruit's idle land to landless peasants",
      "United Fruit fought back — lobbying Washington and branding Árbenz a communist threat to be removed",
      "1954 — the CIA ran Operation PBSuccess, a coup that overthrew the elected Árbenz",
      "the aftermath — Guatemala fell into decades of civil war in which an estimated 200,000 people died",
      "2007 and the verdict — successor Chiquita pleaded guilty, a $25 million fine for $1.7 million paid to a paramilitary death squad: a company that rewrote whole nations for profit",
    ],
  },
  runDir: join(process.cwd(), "output", "whiteboard", "3min"),
  outPath: join(process.cwd(), "output", "whiteboard", "3min", "out.mp4"),
  log: (m) => console.error("[wb]", m),
});
console.log(JSON.stringify({ out: res.outPath, title: res.title, panels: res.panels.length, durationMs: res.durationMs }, null, 2));
