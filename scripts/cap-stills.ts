/**
 * Fast caption-spacing check: render 3 stills of CinematicSpeech over the montage
 * (incl. the jammed 95s "thousand years to live" spot) to confirm the karaoke
 * spacing fix — no 35-min full re-render.
 *   node --import tsx scripts/cap-stills.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeechStills } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const data = JSON.parse(readFileSync("/tmp/mont-wh/comp-montage.json", "utf8"));
const words: SpeechWord[] = [];
for (const s of data.segments ?? [])
  for (const w of s.words ?? []) {
    const t = String(w.word ?? "").trim();
    if (t) words.push({ text: t, start: Math.round(w.start * 1000), end: Math.round(w.end * 1000) });
  }
const endMs = words.length ? words[words.length - 1].end : 211000;
const segments: SpeechSegment[] = [{ index: 1, total: 1, start: 0, end: endMs }];
const WEB = "/var/www/html/speech-tv";
const frames = [Math.round(95 * 30), Math.round(30 * 30), Math.round(150 * 30)];

async function main() {
  await renderCinematicSpeechStills({
    words,
    segments,
    sourceVideoSrc: "http://127.0.0.1/speech-tv/comp-montage.mp4",
    durationSec: 211.5,
    frames,
    outPaths: frames.map((_, i) => join(WEB, `capfix_${i}.jpg`)),
    width: 1920,
    height: 1080,
  });
  console.log("done");
  frames.forEach((_, i) => console.log(`http://87.106.233.113/speech-tv/capfix_${i}.jpg`));
}
main().catch((e) => { console.error("CAP STILLS FAILED:", e.message); process.exit(1); });
