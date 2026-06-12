// Two fresh renders for THE QUIET STOIC via the standalone banana module.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { buildThumbBrief, bananaThumbnail } from "../src/lib/banana.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });

const CHANNEL = {
  channelName: "The Quiet Stoic",
  imageStyle: "cinematic marble statues in a black void, painterly chiaroscuro, gold dust light",
  palette: ["black", "marble white", "gold #d4a017"],
  accentColor: "gold #d4a017",
  textObject: "paint_smear",
  badge: "THE QUIET STOIC",
};

const JOBS = [
  {
    out: "qstoic_anger.jpg",
    title: "Why Stoics Never Get Angry",
    scene:
      "a serene colossal marble bust, eyes closed, completely unmoved in the foreground while a second furious " +
      "statue behind it shatters into flying marble fragments, its rage destroying only itself - thin gold dust " +
      "drifting between them in a black void.",
    lines: [
      { text: "ANGER IS" },
      { text: "WEAKNESS", payoff: true, accent: true },
    ],
  },
  {
    out: "qstoic_memento.jpg",
    title: "Memento Mori - The Stoic Art of Remembering Death",
    scene:
      "a hooded marble statue cradling a large golden hourglass against its chest, the falling sand turning to " +
      "glowing gold dust that drifts away and dissolves into the black void - calm acceptance, not horror, " +
      "a single shaft of warm light from above.",
    lines: [
      { text: "REMEMBER" },
      { text: "YOU MUST DIE", payoff: true, accent: true },
    ],
  },
];

for (const j of JOBS) {
  const outJpg = join(tmpdir(), j.out);
  try {
    const { verdict } = await bananaThumbnail({
      brief: buildThumbBrief({ ...CHANNEL, scene: j.scene, lines: j.lines }),
      outJpg,
      expectWords: j.lines.flatMap((l) => l.text.split(" ")),
      imageStyle: CHANNEL.imageStyle,
      title: j.title,
      log: (m) => console.log(`  ${m}`),
    });
    console.log(`OK ${j.out} punch=${verdict.punch} style=${verdict.styleMatch} story=${verdict.storyMatch}`);
  } catch (e) {
    console.log(`FAIL ${j.out}: ${e.message}`);
  }
}
