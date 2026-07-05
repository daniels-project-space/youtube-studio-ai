/**
 * Rebuild the compilation from PERSISTED sources, EXCLUDING bad speakers
 * (Will Smith resolved to an Oprah/DeVon Franklin false-match). Reuses the
 * already-downloaded src-N.mp4 + wh-N transcripts (NO re-discovery / re-download
 * / re-whisper) → re-select on-theme quotes → interleaved blurred-fill montage →
 * cinematic render + music. One render (~85min), clean.
 *   node --env-file=.env.local --import tsx scripts/rebuild-good.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { geminiJson } from "../src/lib/gemini";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const WORK = "/home/ubuntu/speech-work";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";
const TOPIC = "not giving up";
const PER_SPEAKER_SEC = 110, LEAD = 0.4, TAIL = 0.9;

// GOOD speakers only, by persisted src index. Will Smith (7=Oprah false-match) and
// Arnold (3=no on-theme quotes) excluded. Verify indices against ls speech-work.
const GOOD = [
  { name: "Denzel Washington", idx: 1 },
  { name: "Matthew McConaughey", idx: 2 },
  { name: "Eric Thomas", idx: 5 },
  { name: "Inky Johnson", idx: 6 },
  { name: "David Goggins", idx: 8 },
];

type Word = { text: string; start: number; end: number };
type Clip = { start: number; end: number };
type Plan = { speaker: string; file: string; words: Word[]; clips: Clip[] };

function sh(bin: string, args: string[], timeout = 900000) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, timeout });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-400)}`);
  return r.stdout?.toString() ?? "";
}
const ffDur = (f: string) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).trim());

function loadWhisper(jsonPath: string) {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const words: Word[] = [];
  const segs: { start: number; end: number; text: string }[] = [];
  for (const s of data.segments ?? []) {
    segs.push({ start: s.start, end: s.end, text: String(s.text ?? "").trim() });
    for (const w of s.words ?? []) {
      const text = String(w.word ?? "").trim();
      if (text) words.push({ text, start: w.start, end: w.end });
    }
  }
  return { words, segs };
}

async function selectQuotes(segs: { start: number; end: number; text: string }[], speaker: string, windowLen: number): Promise<Clip[]> {
  const transcript = segs.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
  const prompt = `From this ${speaker} transcript (timestamps in seconds), extract the strongest quotes ON THE THEME "${TOPIC}" (perseverance, refusing to quit, pushing through failure).
Pick 2-4 CONTIGUOUS passages, each a COMPLETE thought (never cut mid-sentence), high-energy and quotable, totaling <= ${PER_SPEAKER_SEC}s. Skip tangents, intros, audience chatter, anything off-theme.
Return ONLY JSON: {"clips":[{"start":<sec>,"end":<sec>}]}  (times within 0..${windowLen.toFixed(0)}; [] if nothing on-theme).
TRANSCRIPT:
${transcript}`;
  const res = await geminiJson<{ clips?: Clip[] }>({ prompt, maxTokens: 700 });
  const clips = (res.clips ?? [])
    .map((c) => ({ start: Math.max(0, +c.start), end: Math.min(windowLen, +c.end) }))
    .filter((c) => c.end - c.start >= 2.5 && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const capped: Clip[] = [];
  let tot = 0;
  for (const c of clips) {
    if (tot >= PER_SPEAKER_SEC) break;
    const d = Math.min(c.end - c.start, PER_SPEAKER_SEC - tot);
    capped.push({ start: c.start, end: c.start + d });
    tot += d;
  }
  return capped;
}

// MEMORY-SAFE montage: encode each clip's blurred-fill segment ONE AT A TIME
// (single decoder, capped threads) to a temp file, then concat with stream-copy
// (no re-decode). The old all-inputs-in-one-filtergraph approach OOM-froze the box.
function buildMontageMulti(entries: { file: string; start: number; end: number }[], out: string) {
  const segDir = join(WORK, "seg");
  mkdirSync(segDir, { recursive: true });
  const listLines: string[] = [];
  entries.forEach((e, i) => {
    const seg = join(segDir, `seg-${String(i).padStart(3, "0")}.mp4`);
    const filter =
      `[0:v]trim=${e.start}:${e.end},setpts=PTS-STARTPTS,fps=30,split[b][f];` +
      `[b]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=26,eq=brightness=-0.06[bb];` +
      `[f]scale=1920:1080:force_original_aspect_ratio=decrease[ff];` +
      `[bb][ff]overlay=(W-w)/2:(H-h)/2,setsar=1[v];` +
      `[0:a]atrim=${e.start}:${e.end},asetpts=PTS-STARTPTS,aresample=48000[a]`;
    sh("ffmpeg", ["-y", "-threads", "2", "-i", e.file, "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-pix_fmt", "yuv420p", seg], 300000);
    listLines.push(`file '${seg}'`);
  });
  writeFileSync(join(segDir, "list.txt"), listLines.join("\n"));
  sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", join(segDir, "list.txt"), "-c", "copy", out], 300000);
}

function assemble(plans: Plan[]) {
  type Unit = { speaker: string; file: string; start: number; end: number; words: Word[] };
  const units: Unit[] = [];
  const maxClips = Math.max(0, ...plans.map((p) => p.clips.length));
  for (let ci = 0; ci < maxClips; ci++)
    for (const p of plans) {
      const c = p.clips[ci];
      if (c) units.push({ speaker: p.speaker, file: p.file, start: c.start, end: c.end, words: p.words });
    }
  const entries: { file: string; start: number; end: number }[] = [];
  const segments: SpeechSegment[] = [];
  const words: SpeechWord[] = [];
  let base = 0;
  units.forEach((u, ui) => {
    entries.push({ file: u.file, start: u.start, end: u.end });
    const dur = u.end - u.start;
    for (const w of u.words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= u.start && mid < u.end)
        words.push({
          text: w.text,
          start: Math.max(0, Math.round((base + (w.start - u.start)) * 1000)),
          end: Math.round(Math.min(base + dur, base + (w.end - u.start)) * 1000),
        });
    }
    segments.push({ index: ui + 1, total: units.length, start: Math.round(base * 1000), end: Math.round((base + dur) * 1000), label: u.speaker });
    base += dur;
  });
  words.sort((a, b) => a.start - b.start);
  return { entries, segments, words };
}

async function main() {
  const plans: Plan[] = [];
  for (const g of GOOD) {
    const file = join(WORK, `src-${g.idx}.mp4`);
    const wh = join(WORK, `wh-${g.idx}`, `src-${g.idx}.json`);
    if (!existsSync(file) || !existsSync(wh)) { console.log(`skip ${g.name}: missing src-${g.idx} or wh`); continue; }
    const { words, segs } = loadWhisper(wh);
    const dur = ffDur(file);
    const raw = await selectQuotes(segs, g.name, dur);
    if (!raw.length) { console.log(`skip ${g.name}: no on-theme quotes`); continue; }
    const clips = raw.map((c) => ({ start: Math.max(0, c.start - LEAD), end: Math.min(dur, c.end + TAIL) }));
    plans.push({ speaker: g.name, file, words, clips });
    console.log(`✓ ${g.name}: ${clips.length} quotes (+${clips.reduce((s, c) => s + (c.end - c.start), 0).toFixed(0)}s)`);
  }
  if (!plans.length) throw new Error("no plans");
  const { entries, segments, words } = assemble(plans);
  const montage = join(WORK, "montage-good.mp4");
  buildMontageMulti(entries, montage);
  const dur = ffDur(montage);
  copyFileSync(montage, join(WEB, "nq-montage.mp4"));
  writeFileSync(join(WORK, "plan.json"), JSON.stringify({ topic: TOPIC, speakers: plans.map((p) => p.speaker), durationSec: dur, words, segments }, null, 0));
  console.log(`montage ${dur.toFixed(1)}s, ${words.length} caption words, ${segments.length} cuts; speakers: ${plans.map((p) => p.speaker).join(", ")}`);
  const bed = join(WEB, "bed-aspirational.mp3");
  console.log("rendering cinematic 1080p (concurrency 3) …");
  await renderCinematicSpeech({
    words, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/nq-montage.mp4`,
    musicSrc: existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined,
    musicVolume: 0.14,
    durationSec: dur, width: 1920, height: 1080,
    outPath: join(WEB, "notgivingup.mp4"), concurrency: 3,
    log: (m) => console.log("   " + m),
  });
  console.log("DONE →", `${HTTP_PUB}/notgivingup.mp4`);
}
main().catch((e) => { console.error("REBUILD FAILED:", e.message); process.exit(1); });
