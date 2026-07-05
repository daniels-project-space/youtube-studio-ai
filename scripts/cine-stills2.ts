/**
 * Quick visual check of the speaker name lower-third — render CinematicSpeech
 * stills ~1s into a few labeled segments (where the name tag should be showing),
 * using the existing plan.json + montage. No long render.
 *   node --import tsx scripts/cine-stills2.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeechStills } from "../src/lib/remotionRender";

const plan = JSON.parse(readFileSync("/home/ubuntu/speech-work/plan.json", "utf8"));
const WEB = "/var/www/html/speech-tv";
const fps = 30;
const segs = plan.segments as { start: number; end: number; label?: string }[];
const pick = [segs[0], segs[1], segs[3]].filter(Boolean);
const frames = pick.map((s) => Math.round((s.start / 1000 + 1.0) * fps));

async function main() {
  await renderCinematicSpeechStills({
    words: plan.words,
    segments: plan.segments,
    sourceVideoSrc: "http://127.0.0.1/speech-tv/nq-montage.mp4",
    durationSec: plan.durationSec,
    frames,
    outPaths: frames.map((_, i) => join(WEB, `tag_${i}.jpg`)),
    width: 1920,
    height: 1080,
  });
  pick.forEach((s, i) => console.log(`${s.label} -> http://87.106.233.113/speech-tv/tag_${i}.jpg`));
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
