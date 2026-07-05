/**
 * Fast preview of the CINEMATIC look over the already-built montage. Renders a
 * handful of stills (no full video) so the look can be approved before a long
 * render. Reuses /tmp/speech-demo-config.json + /tmp/whisper-out + the montage
 * already published at <httpBase>/montage.mp4.
 *
 *   ./node_modules/.bin/tsx scripts/cinematic-stills.ts
 */
import { readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeechStills } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const cfg = JSON.parse(readFileSync("/tmp/speech-demo-config.json", "utf8"));
type Clip = { start: number; end: number };

function remapWords(whisperJson: string, clips: Clip[]): SpeechWord[] {
  const data = JSON.parse(readFileSync(whisperJson, "utf8"));
  const all: { text: string; start: number; end: number }[] = [];
  for (const seg of data.segments ?? [])
    for (const w of seg.words ?? []) {
      const text = String(w.word ?? "").trim();
      if (text) all.push({ text, start: w.start, end: w.end });
    }
  const out: SpeechWord[] = [];
  let base = 0;
  for (const c of clips) {
    const dur = c.end - c.start;
    for (const w of all) {
      const mid = (w.start + w.end) / 2;
      if (mid >= c.start && mid < c.end)
        out.push({
          text: w.text,
          start: Math.max(0, Math.round((base + (w.start - c.start)) * 1000)),
          end: Math.round(Math.min(base + dur, base + (w.end - c.start)) * 1000),
        });
    }
    base += dur;
  }
  return out.sort((a, b) => a.start - b.start);
}

function buildSegments(clips: Clip[]): SpeechSegment[] {
  const segs: SpeechSegment[] = [];
  let base = 0;
  clips.forEach((c, i) => {
    const dur = c.end - c.start;
    segs.push({ index: i + 1, total: clips.length, start: Math.round(base * 1000), end: Math.round((base + dur) * 1000) });
    base += dur;
  });
  return segs;
}

async function main() {
  const words = remapWords(cfg.whisperJson, cfg.clips);
  const segments = buildSegments(cfg.clips);
  const durationSec = 80.83;
  const frames = [120, 450, 1350, 2280]; // 4s, 15s, 45s, 76s
  const tmp = frames.map((f) => `/tmp/cine_${f}.jpg`);
  console.log(`rendering ${frames.length} cinematic stills…`);
  await renderCinematicSpeechStills({
    words,
    segments,
    sourceVideoSrc: `${cfg.httpBase}/montage.mp4`,
    durationSec,
    frames,
    outPaths: tmp,
  });
  tmp.forEach((p, i) => {
    const web = join(cfg.webDir, `cine_${i + 1}.jpg`);
    copyFileSync(p, web);
    console.log("→", `${cfg.httpBase}/cine_${i + 1}.jpg`, "(", p, ")");
  });
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
