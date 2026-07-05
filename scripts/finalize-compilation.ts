/**
 * Finalize the surviving multi-speaker montage into the watchable cinematic video.
 *
 * Recovery path after the VPS reboot wiped /tmp (whisper jsons + source clips):
 * the montage's own audio IS the final cut, so whispering comp-montage.mp4 gives
 * word timings already aligned to the 0..N montage timeline (zero remapping).
 * Chapters for the channel-bug come from the padding gaps between cuts.
 *
 *   node --env-file=.env.local --import tsx scripts/finalize-compilation.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";
const MONTAGE = join(WEB, "comp-montage.mp4");
const WH = "/tmp/mont-wh/comp-montage.json";

function sh(bin: string, args: string[], timeout = 1_800_000) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, timeout });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-400)}`);
  return r.stdout?.toString() ?? "";
}
const ffDur = (f: string) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).trim());

function ensureWhisper() {
  if (existsSync(WH)) return;
  mkdirSync("/tmp/mont-wh", { recursive: true });
  console.log("whispering montage (base, word timestamps) …");
  sh("whisper", [MONTAGE, "--model", "base", "--language", "en", "--word_timestamps", "True",
    "--output_format", "json", "--output_dir", "/tmp/mont-wh"]);
}

function loadWords(): SpeechWord[] {
  const data = JSON.parse(readFileSync(WH, "utf8"));
  const words: SpeechWord[] = [];
  for (const s of data.segments ?? [])
    for (const w of s.words ?? []) {
      const t = String(w.word ?? "").trim();
      if (t && Number.isFinite(w.start) && Number.isFinite(w.end))
        words.push({ text: t, start: Math.round(w.start * 1000), end: Math.round(w.end * 1000) });
    }
  words.sort((a, b) => a.start - b.start);
  return words;
}

// chapters from cut-gaps: a gap > GAP ms between words starts a new chapter; merge
// any chapter shorter than MINLEN forward into the next so the bug isn't twitchy.
function deriveSegments(words: SpeechWord[], totalMs: number): SpeechSegment[] {
  const GAP = 1100, MINLEN = 7000;
  const cuts = [0];
  for (let i = 1; i < words.length; i++)
    if (words[i].start - words[i - 1].end > GAP) cuts.push(words[i].start);
  cuts.push(totalMs);
  const raw: { start: number; end: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) raw.push({ start: cuts[i], end: cuts[i + 1] });
  const merged: { start: number; end: number }[] = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && last.end - last.start < MINLEN) last.end = c.end;
    else merged.push({ start: c.start, end: c.end });
  }
  const total = merged.length || 1;
  return merged.map((c, i) => ({ index: i + 1, total, start: c.start, end: c.end }));
}

async function main() {
  ensureWhisper();
  const dur = ffDur(MONTAGE);
  const words = loadWords();
  const segments = deriveSegments(words, Math.round(dur * 1000));
  console.log(`montage ${dur.toFixed(1)}s · ${words.length} caption words · ${segments.length} chapters`);
  const bed = join(WEB, "bed-aspirational.mp3");
  console.log("rendering cinematic 1080p (concurrency 3, 180s frame timeout) …");
  await renderCinematicSpeech({
    words, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/comp-montage.mp4`,
    musicSrc: existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined,
    musicVolume: 0.14,
    durationSec: dur, width: 1920, height: 1080,
    outPath: join(WEB, "comp-final.mp4"), concurrency: 3,
    log: (m) => console.log("   " + m),
  });
  console.log("\nDONE →", `${HTTP_PUB}/comp-final.mp4`);
}
main().catch((e) => { console.error("FINALIZE FAILED:", e.message); process.exit(1); });
