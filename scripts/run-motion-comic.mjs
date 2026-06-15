// Standalone drawn-comic-page spike (NOT pipeline-wired). Real story: the
// Christmas Truce of 1914.
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { castMotionComic } from "../src/lib/motionComic.ts";

await bootstrapSecrets((m) => console.error("[boot]", m), { required: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"] });

const res = await castMotionComic({
  brief: {
    topic: "The Christmas Truce of 1914 — the night enemies stopped the war and met in No Man's Land",
    facts:
      "A TRUE story. December 1914, the Western Front, Flanders. British and German soldiers were dug into freezing, muddy " +
      "trenches yards apart, after months of slaughter. On Christmas Eve the Germans lit candles and small trees on their " +
      "parapets and began singing 'Stille Nacht' (Silent Night). The British answered with their own carols. Slowly, men " +
      "called out 'Merry Christmas' across the lines. Unarmed soldiers climbed out into No Man's Land, shook hands, exchanged " +
      "gifts — cigarettes, chocolate, buttons — showed photos of families, and helped bury each other's dead. In places they " +
      "played football in the mud. For one day, the guns were silent. Then orders came; the war resumed, and high commands " +
      "made sure it never happened again. But the men who were there never forgot that the enemy was human.",
    panels: 8,
    width: 1920,
    music: true,
    musicPrompt:
      "Tender, aching cinematic underscore: solo piano and warm strings, a faint music-box carol motif, hopeful but sorrowful, slow, instrumental, no vocals",
  },
  runDir: join(process.cwd(), "output", "motioncomic", "truce-test"),
  outPath: join(process.cwd(), "output", "motioncomic", "truce-test", "out.mp4"),
  log: (m) => console.error("[mc]", m),
});
console.log(JSON.stringify(res, null, 2));
