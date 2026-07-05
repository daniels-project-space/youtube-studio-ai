/**
 * Crash-safe re-render: finish the compilation from the persisted plan + montage
 * (no re-discovery / re-whisper). Used if auto-compilation's render dies.
 *   node --env-file=.env.local --import tsx scripts/render-from-plan.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeech } from "../src/lib/remotionRender";

const WEB = "/var/www/html/speech-tv";
const WORK = "/home/ubuntu/speech-work";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";

const ffDur = (f: string) =>
  parseFloat(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).stdout?.toString().trim() || "0");

async function main() {
  const plan = JSON.parse(readFileSync(join(WORK, "plan.json"), "utf8"));
  const montage = join(WEB, "nq-montage.mp4");
  const dur = ffDur(montage) || plan.durationSec;
  const bed = join(WEB, "bed-aspirational.mp3");
  console.log(`re-render: ${plan.words.length} words, ${plan.segments.length} chapters, ${dur.toFixed(1)}s, speakers: ${(plan.speakers || []).join(", ")}`);
  await renderCinematicSpeech({
    words: plan.words,
    segments: plan.segments,
    sourceVideoSrc: `${HTTP_LOCAL}/nq-montage.mp4`,
    musicSrc: existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined,
    musicVolume: 0.14,
    durationSec: dur, width: 1920, height: 1080,
    // concurrency 1: a single render worker (~1-2GB) can't exhaust the 16GB box.
    // concurrency 3 OOM-froze it twice. Slower (~40min) but safe.
    outPath: join(WEB, "notgivingup.mp4"), concurrency: 1,
    log: (m) => console.log("   " + m),
  });
  console.log("DONE →", `${HTTP_PUB}/notgivingup.mp4`);
}
main().catch((e) => { console.error("RE-RENDER FAILED:", e.message); process.exit(1); });
