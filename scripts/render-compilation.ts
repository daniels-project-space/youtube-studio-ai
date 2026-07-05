/**
 * RESUME the multi-speaker compilation render after a crash, without redoing the
 * slow discovery/whisper. Reuses the surviving whisper jsons; re-downloads the
 * (cleaned) source clips for the exact windows the successful run used; re-picks
 * quotes; rebuilds the montage; renders (raised per-frame timeout, lower concurrency).
 *
 *   node --env-file=.env.local --import tsx scripts/render-compilation.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geminiJson } from "../src/lib/gemini";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";
const TOPIC = "not giving up";
const PER_SPEAKER_SEC = 100, LEAD = 0.5, TAIL = 1.4;

// the clean sources the successful discovery run found (from compilation.log)
const SOURCES = [
  { name: "Les Brown", id: "SDIE_QPOPzo", winStart: 536, winLen: 600, file: "/tmp/comp-1.mp4", whisper: "/tmp/comp-wh-1/comp-1.json" },
  { name: "Eric Thomas", id: "6vuetQSwFW8", winStart: 177, winLen: 444, file: "/tmp/comp-2.mp4", whisper: "/tmp/comp-wh-2/comp-2.json" },
];

type Word = { text: string; start: number; end: number };
type Clip = { start: number; end: number };
type Plan = { speaker: string; file: string; words: Word[]; clips: Clip[] };

function sh(bin: string, args: string[], timeout = 420000) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, timeout });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-500)}`);
  return r.stdout?.toString() ?? "";
}
const ffDur = (f: string) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).trim());

function loadWhisper(p: string) {
  const data = JSON.parse(readFileSync(p, "utf8"));
  const words: Word[] = [];
  const segs: { start: number; end: number; text: string }[] = [];
  for (const s of data.segments ?? []) {
    segs.push({ start: s.start, end: s.end, text: String(s.text ?? "").trim() });
    for (const w of s.words ?? []) {
      const t = String(w.word ?? "").trim();
      if (t) words.push({ text: t, start: w.start, end: w.end });
    }
  }
  return { words, segs };
}

async function selectQuotes(segs: { start: number; end: number; text: string }[], speaker: string, windowLen: number): Promise<Clip[]> {
  const transcript = segs.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
  const prompt = `From this ${speaker} transcript (seconds), extract the strongest quotes ON THE THEME "${TOPIC}" (perseverance, refusing to quit, pushing through failure). Pick 2-4 CONTIGUOUS passages, each a COMPLETE thought, high-energy, totaling <= ${PER_SPEAKER_SEC}s. Skip tangents/intros/chatter. Return ONLY JSON: {"clips":[{"start":<sec>,"end":<sec>}]} within 0..${windowLen.toFixed(0)}.`;
  const res = await geminiJson<{ clips?: Clip[] }>({ prompt, maxTokens: 700 });
  let clips = (res.clips ?? []).map((c) => ({ start: Math.max(0, +c.start), end: Math.min(windowLen, +c.end) }))
    .filter((c) => c.end - c.start >= 2.5).sort((a, b) => a.start - b.start);
  const capped: Clip[] = []; let tot = 0;
  for (const c of clips) { if (tot >= PER_SPEAKER_SEC) break; const d = Math.min(c.end - c.start, PER_SPEAKER_SEC - tot); capped.push({ start: c.start, end: c.start + d }); tot += d; }
  return capped;
}

function buildMontageMulti(entries: { file: string; start: number; end: number }[], out: string) {
  const files = [...new Set(entries.map((e) => e.file))];
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts: string[] = [], labels: string[] = [];
  entries.forEach((e, i) => {
    const k = files.indexOf(e.file);
    parts.push(`[${k}:v]trim=${e.start}:${e.end},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1[v${i}]`);
    parts.push(`[${k}:a]atrim=${e.start}:${e.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const filter = parts.join(";") + ";" + labels.join("") + `concat=n=${entries.length}:v=1:a=1[v][a]`;
  sh("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", out], 600000);
}

function assemble(plans: Plan[]) {
  const entries: { file: string; start: number; end: number }[] = [];
  const segments: SpeechSegment[] = [];
  const words: SpeechWord[] = [];
  let base = 0;
  plans.forEach((p, pi) => {
    const segStart = base;
    for (const c of p.clips) {
      entries.push({ file: p.file, start: c.start, end: c.end });
      const dur = c.end - c.start;
      for (const w of p.words) {
        const mid = (w.start + w.end) / 2;
        if (mid >= c.start && mid < c.end)
          words.push({ text: w.text, start: Math.max(0, Math.round((base + (w.start - c.start)) * 1000)), end: Math.round(Math.min(base + dur, base + (w.end - c.start)) * 1000) });
      }
      base += dur;
    }
    segments.push({ index: pi + 1, total: plans.length, start: Math.round(segStart * 1000), end: Math.round(base * 1000), label: p.speaker });
  });
  words.sort((a, b) => a.start - b.start);
  return { entries, segments, words };
}

async function main() {
  mkdirSync(WEB, { recursive: true });
  const plans: Plan[] = [];
  for (const s of SOURCES) {
    console.log(`=== ${s.name} ===`);
    if (!existsSync(s.file)) {
      console.log(`  re-downloading ${s.id} ${s.winStart}-${s.winStart + s.winLen}s …`);
      sh("yt-dlp", [`https://www.youtube.com/watch?v=${s.id}`, "--download-sections", `*${s.winStart}-${s.winStart + s.winLen}`,
        "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", s.file, "--no-warnings"]);
    }
    const { words, segs } = loadWhisper(s.whisper);
    const dur = ffDur(s.file);
    const raw = await selectQuotes(segs, s.name, dur);
    if (!raw.length) { console.log("  no quotes, skip"); continue; }
    const clips = raw.map((c) => ({ start: Math.max(0, c.start - LEAD), end: Math.min(dur, c.end + TAIL) }));
    plans.push({ speaker: s.name, file: s.file, words, clips });
    console.log(`  ${clips.length} quotes (+${clips.reduce((a, c) => a + (c.end - c.start), 0).toFixed(0)}s)`);
  }
  if (!plans.length) throw new Error("no plans");

  const { entries, segments, words } = assemble(plans);
  writeFileSync("/tmp/comp-plan.json", JSON.stringify({ segments, words, entries }, null, 0));
  const montage = "/tmp/comp-montage.mp4";
  buildMontageMulti(entries, montage);
  const dur = ffDur(montage);
  copyFileSync(montage, join(WEB, "comp-montage.mp4"));
  console.log(`montage ${dur.toFixed(1)}s, ${words.length} caption words, ${segments.length} chapters`);

  const bed = join(WEB, "bed-aspirational.mp3");
  console.log("rendering cinematic 1080p (concurrency 3, 180s frame timeout) …");
  await renderCinematicSpeech({
    words, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/comp-montage.mp4`,
    musicSrc: existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined,
    musicVolume: 0.14,
    durationSec: dur, width: 1920, height: 1080,
    outPath: join(WEB, "compilation.mp4"), concurrency: 3,
    log: (m) => console.log("   " + m),
  });
  console.log("\nDONE — speakers:", plans.map((p) => p.speaker).join(", "), "| length", dur.toFixed(0) + "s");
  console.log("LINK:", `${HTTP_PUB}/compilation.mp4`);
}

main().catch((e) => { console.error("RESUME FAILED:", e.message); process.exit(1); });
