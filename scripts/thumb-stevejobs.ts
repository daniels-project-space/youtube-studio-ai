/**
 * Golden thumbnail (Banana / Nano Banana Pro) for the CATEGORY-2 demo:
 * "Steve Jobs — Never Give Up On Your Dreams" (one person, one topic).
 *   node --env-file=.env.local --import tsx scripts/thumb-stevejobs.ts
 */
import { buildThumbBrief, bananaThumbnail } from "../src/lib/banana";

const imageStyle =
  "cinematic high-contrast portrait, dramatic single-source rim light, moody charcoal background, premium editorial movie-poster look, crisp photographic detail";

const brief = buildThumbBrief({
  channelName: "MINDSET",
  imageStyle,
  palette: ["charcoal black", "deep slate", "warm gold"],
  accentColor: "#ffd27a",
  scene:
    "A lone visionary tech founder, late 40s, close-cropped greying hair and short grey beard, wearing an iconic plain black turtleneck and round rimless glasses, jaw set, an intense defiant determined gaze locked straight to camera. A single hard rim-light carves his face out of a deep charcoal void; faint atmospheric haze; a subtle glowing apple-shaped light dissolving far back in the darkness. Powerful, cinematic, hopeful-but-fierce.",
  lines: [
    { text: "Never give up on your", accent: false },
    { text: "Dreams", payoff: true, accent: true },
  ],
  badge: "Mindset",
});

async function main() {
  const out = "/var/www/html/speech-tv/thumb-stevejobs.jpg";
  console.log("brief:\n", brief, "\n---");
  const { path, verdict } = await bananaThumbnail({
    brief,
    outJpg: out,
    expectWords: ["NEVER GIVE UP ON YOUR", "DREAMS"],
    imageStyle,
    title: "Steve Jobs — Never Give Up On Your Dreams",
    log: (m) => console.log(m),
  });
  console.log("\nDONE", path, JSON.stringify(verdict));
  console.log("LINK: http://87.106.233.113/speech-tv/thumb-stevejobs.jpg");
}
main().catch((e) => { console.error("THUMB FAILED:", e.message); process.exit(1); });
