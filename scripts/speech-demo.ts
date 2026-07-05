/**
 * END-TO-END demo for the Speech-TV module: real footage cut together + music +
 * word-synced captions + script-timed overlays — a watchable sample like the
 * reference. NOT the production pipeline; a deterministic harness to prove the
 * look on real content.
 *
 *   npx tsx scripts/speech-demo.ts            (or ./node_modules/.bin/tsx ...)
 *
 * Reads /tmp/speech-demo-config.json:
 *   { source, whisperJson, music, webDir, httpBase, outName,
 *     clips: [{start,end}],            // seconds in the ORIGINAL source
 *     cues: MotionCue[] }              // ms in the MONTAGE timeline
 *
 * Steps: ffmpeg trim+concat the clips → montage; remap whisper words into the
 * montage timeline; serve montage+music over http; renderMotivationalSpeech
 * with footage + music + captions + cues; copy result to the web dir.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderMotivationalSpeech } from "../src/lib/remotionRender";
import type { MotionCue, SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

type Clip = { start: number; end: number }; // seconds, original source
type Config = {
  source: string;
  whisperJson: string;
  music?: string;
  webDir: string;
  httpBase: string;
  outName: string;
  clips: Clip[];
  cues: MotionCue[];
};

const cfg: Config = JSON.parse(readFileSync("/tmp/speech-demo-config.json", "utf8"));

function sh(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-800)}`);
  }
  return r.stdout?.toString() ?? "";
}

function ffprobeDuration(file: string): number {
  const out = sh("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(out.trim());
}

// ---- 1. trim + concat clips into one montage (frame-accurate, re-encoded) ----
function buildMontage(clips: Clip[], source: string, out: string) {
  const parts: string[] = [];
  const labels: string[] = [];
  clips.forEach((c, i) => {
    parts.push(
      `[0:v]trim=${c.start}:${c.end},setpts=PTS-STARTPTS,scale=1280:720,fps=30,setsar=1[v${i}]`,
    );
    parts.push(`[0:a]atrim=${c.start}:${c.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const filter =
    parts.join(";") +
    ";" +
    labels.join("") +
    `concat=n=${clips.length}:v=1:a=1[v][a]`;
  sh("ffmpeg", [
    "-y", "-i", source,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-pix_fmt", "yuv420p",
    out,
  ]);
}

// ---- 2. remap whisper words (sec) into the montage timeline (ms) -------------
function remapWords(whisperJson: string, clips: Clip[]): SpeechWord[] {
  const data = JSON.parse(readFileSync(whisperJson, "utf8"));
  const allWords: { text: string; start: number; end: number }[] = [];
  for (const seg of data.segments ?? []) {
    for (const w of seg.words ?? []) {
      const text = String(w.word ?? "").trim();
      if (text) allWords.push({ text, start: w.start, end: w.end });
    }
  }
  const out: SpeechWord[] = [];
  let base = 0; // montage seconds consumed by prior clips
  for (const c of clips) {
    const dur = c.end - c.start;
    for (const w of allWords) {
      // a word belongs to this clip if its midpoint falls inside [start,end)
      const mid = (w.start + w.end) / 2;
      if (mid >= c.start && mid < c.end) {
        const ns = base + (w.start - c.start);
        const ne = base + (w.end - c.start);
        out.push({
          text: w.text,
          start: Math.max(0, Math.round(ns * 1000)),
          end: Math.round(Math.min(base + dur, ne) * 1000),
        });
      }
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
    segs.push({
      index: i + 1,
      total: clips.length,
      start: Math.round(base * 1000),
      end: Math.round((base + dur) * 1000),
    });
    base += dur;
  });
  return segs;
}

async function main() {
  if (!existsSync(cfg.source)) throw new Error("missing source: " + cfg.source);
  const montage = "/tmp/speech-montage.mp4";
  console.log(`clips: ${cfg.clips.length}, cues: ${cfg.cues.length}`);

  console.log("1/4 building montage (trim+concat)…");
  buildMontage(cfg.clips, cfg.source, montage);
  const dur = ffprobeDuration(montage);
  console.log(`   montage = ${dur.toFixed(1)}s`);

  console.log("2/4 remapping words + segments…");
  const words = remapWords(cfg.whisperJson, cfg.clips);
  const segments = buildSegments(cfg.clips);
  console.log(`   words=${words.length}, segments=${segments.length}`);

  console.log("3/4 publishing montage + music to web dir for OffthreadVideo…");
  const montageWeb = join(cfg.webDir, "montage.mp4");
  copyFileSync(montage, montageWeb);
  let musicUrl: string | undefined;
  if (cfg.music && existsSync(cfg.music)) {
    copyFileSync(cfg.music, join(cfg.webDir, "bed.mp3"));
    musicUrl = `${cfg.httpBase}/bed.mp3`;
  }

  console.log("4/4 rendering full sample…");
  const out = join(cfg.webDir, cfg.outName);
  await renderMotivationalSpeech({
    sourceVideoSrc: `${cfg.httpBase}/montage.mp4`,
    musicSrc: musicUrl,
    musicVolume: 0.1,
    words,
    segments,
    cues: cfg.cues,
    durationSec: dur,
    outPath: out,
    concurrency: 4,
    log: (m) => console.log("   " + m),
  });
  console.log("DONE →", out);
  console.log("LINK:", `${cfg.httpBase}/${cfg.outName}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
