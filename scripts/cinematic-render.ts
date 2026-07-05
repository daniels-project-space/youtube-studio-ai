/**
 * Full CINEMATIC render over the already-built montage (speech audio + music
 * bed). Reuses /tmp/speech-demo-config.json + whisper + the published montage.
 *
 *   ./node_modules/.bin/tsx scripts/cinematic-render.ts
 */
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
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

  let musicUrl: string | undefined;
  if (cfg.music && existsSync(cfg.music)) {
    copyFileSync(cfg.music, join(cfg.webDir, "bed.mp3"));
    musicUrl = `${cfg.httpBase}/bed.mp3`;
  }

  const out = join(cfg.webDir, "cinematic-full.mp4");
  console.log(`rendering cinematic full (${durationSec}s, ${words.length} words)…`);
  await renderCinematicSpeech({
    words,
    segments,
    sourceVideoSrc: `${cfg.httpBase}/montage.mp4`,
    musicSrc: musicUrl,
    musicVolume: 0.09,
    durationSec,
    outPath: out,
    concurrency: 4,
    log: (m) => console.log("  " + m),
  });
  console.log("DONE →", out);
  console.log("LINK:", `${cfg.httpBase}/cinematic-full.mp4`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
