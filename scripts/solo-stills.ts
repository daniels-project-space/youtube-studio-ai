/**
 * Polish check (Pass 4): render CinematicSpeech stills from the solo plan to
 * verify the name lower-third vs the source watermark, captions, grade, letterbox.
 *   node --import tsx scripts/solo-stills.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeechStills } from "../src/lib/remotionRender";

const plan = JSON.parse(readFileSync("/home/ubuntu/speech-work/solo-plan.json", "utf8"));
const WEB = "/var/www/html/speech-tv";
const SLUG = (process.env.SOLO_SLUG || String(plan.speaker || "solo").toLowerCase().replace(/[^a-z]+/g, "-")).replace(/(^-|-$)/g, "");
const fps = 30;
const segs = plan.segments as { start: number; end: number }[];
// 1.2s into the first cut (name tag visible), plus a mid and a late frame
const pick = [segs[0], segs[Math.min(2, segs.length - 1)], segs[segs.length - 1]].filter(Boolean);
const frames = pick.map((s) => Math.round((s.start / 1000 + 1.2) * fps));

async function main() {
  await renderCinematicSpeechStills({
    words: plan.words,
    segments: plan.segments,
    sourceVideoSrc: `http://127.0.0.1/speech-tv/${SLUG}-montage.mp4`,
    durationSec: plan.durationSec,
    frames,
    outPaths: frames.map((_, i) => join(WEB, `solo_tag_${i}.jpg`)),
    width: 1920,
    height: 1080,
  });
  frames.forEach((f, i) => console.log(`frame ${f} -> http://87.106.233.113/speech-tv/solo_tag_${i}.jpg`));
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
