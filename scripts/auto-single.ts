/**
 * CATEGORY 2 — ONE PERSON × ONE TOPIC, cutting across MULTIPLE of their speeches.
 *   SOLO_SPEAKER="Steve Jobs" SOLO_TOPIC="never giving up on your dreams" \
 *     node --env-file=.env.local --import tsx scripts/auto-single.ts
 *   env: DRY=1 (stop before render), SOLO_SOURCES=N (how many speeches, default 3),
 *        REDISCOVER=1 (re-find sources), SOLO_TARGET_SEC, SOLO_SLUG.
 *
 * Finds several HD speeches of the SAME vetted person on the topic → whisper each
 * → combine into one global transcript → Gemini selects CONTEXT-RICH passages
 * (setup + payoff, not just one-liners) and orders them as an arc → sentence-snapped
 * cuts → cinematic render (captions + name lower-third + loudnorm) → Banana thumbnail.
 * Memory-safe montage (one clip at a time) + concurrency-1 render (OOM-safe).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findRawSources } from "../src/lib/speechSource";
import { geminiJson } from "../src/lib/gemini";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import { generateSpeechThumbnail } from "../src/lib/speechThumbnail";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const WORK = "/home/ubuntu/speech-work";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";

const SPEAKER = process.env.SOLO_SPEAKER || "Steve Jobs";
const TOPIC = process.env.SOLO_TOPIC || "never giving up on your dreams";
const TARGET_SEC = parseFloat(process.env.SOLO_TARGET_SEC || "270");
const N_SOURCES = parseInt(process.env.SOLO_SOURCES || "3", 10);
// HD mandate dropped for solo — SD-era icons (Steve Jobs) only have SD speeches,
// and the cinematic grade + blurred-fill makes SD read as intentional/archival.
const MIN_HEIGHT_SOLO = parseInt(process.env.SOLO_MIN_HEIGHT || "240", 10);
const SLUG = (process.env.SOLO_SLUG || SPEAKER.toLowerCase().replace(/[^a-z]+/g, "-")).replace(/(^-|-$)/g, "");
const DRY = process.env.DRY === "1";
const LEAD = 0.12, TAIL = 0.3;

type Word = { text: string; start: number; end: number };
type Seg = { start: number; end: number; text: string };
type Clip = { start: number; end: number; why?: string };
type Entry = { file: string; start: number; end: number; words: Word[]; why?: string };
type Src = { id: string; url: string; file: string; wh: string; title: string; durationSec: number };

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
  const segs: Seg[] = [];
  for (const s of data.segments ?? []) {
    segs.push({ start: s.start, end: s.end, text: String(s.text ?? "").trim() });
    for (const w of s.words ?? []) {
      const t = String(w.word ?? "").trim();
      if (t) words.push({ text: t, start: w.start, end: w.end });
    }
  }
  return { words, segs };
}

// SELECTION + CONTEXT + PACING: context-rich passages across all speeches, arc-ordered.
async function selectArc(segs: Seg[], totalDur: number): Promise<Clip[]> {
  const transcript = segs.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join("\n");
  const prompt = `You are the editor of a cinematic motivational short of ${SPEAKER} on the theme "${TOPIC}". This transcript is several of ${SPEAKER}'s speeches/interviews stitched into ONE timeline (timestamps in seconds).
Choose the STRONGEST passages that land ON THE THEME, and INCLUDE CONTEXT — the set-up and reasoning that leads into each key line, not just the punchline. Each clip should be a self-contained mini-moment (a full thought with its lead-in), roughly 14-30 seconds, so it actually lands.
RULES:
- complete thoughts only (never start/end mid-sentence); skip intros, logistics, applause, tangents.
- clips MUST NOT overlap in time; pick DISTINCT moments (draw from DIFFERENT parts of the timeline / different speeches), no two making the same point.
- include 9-13 clips. CRITICAL: total run time MUST be AT LEAST 200 seconds (aim ${Math.round(TARGET_SEC)}s).
- ORDER as an ARC: open with a gripping hook, build, and END on the single most iconic/powerful line.
Return ONLY JSON: {"clips":[{"start":<sec>,"end":<sec>,"why":"<=4 words"}]} in arc order, times within 0..${totalDur.toFixed(0)}.
TRANSCRIPT:
${transcript}`;
  const res = await geminiJson<{ clips?: Clip[] }>({ prompt, maxTokens: 1800 });
  return (res.clips ?? [])
    .map((c) => ({ start: Math.max(0, +c.start), end: Math.min(totalDur, +c.end), why: c.why }))
    .filter((c) => c.end - c.start >= 3 && c.end > c.start);
}

function snapToSentences(c: Clip, segs: Seg[]): Clip {
  if (!segs.length) return c;
  let s = c.start, e = c.end;
  const cs = segs.find((g) => c.start >= g.start - 0.05 && c.start < g.end);
  if (cs) s = cs.start; else { const n = segs.find((g) => g.start >= c.start); if (n) s = n.start; }
  const ce = segs.find((g) => c.end > g.start && c.end <= g.end + 0.05);
  if (ce) e = ce.end; else { const b = segs.filter((g) => g.end <= c.end + 0.05); if (b.length) e = b[b.length - 1].end; }
  return e > s ? { start: s, end: e, why: c.why } : c;
}

// drop entries overlapping an accepted one in the SAME source file (double-audio bug).
function dedupeEntries(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    if (e.end - e.start < 3) continue;
    if (out.some((o) => o.file === e.file && e.start < o.end && e.end > o.start)) continue;
    out.push(e);
  }
  return out;
}

// MEMORY-SAFE multi-file montage: each clip encoded alone (blurred-fill + loudnorm
// + edge-fades), then concat-copy. One decoder at a time → can't OOM the box.
function buildMontage(entries: Entry[], out: string) {
  const segDir = join(WORK, "seg-solo");
  mkdirSync(segDir, { recursive: true });
  const list: string[] = [];
  entries.forEach((e, i) => {
    const seg = join(segDir, `s-${String(i).padStart(3, "0")}.mp4`);
    const d = Math.max(0.2, e.end - e.start);
    const fo = Math.max(0, d - 0.08).toFixed(3);
    const filter =
      `[0:v]trim=${e.start}:${e.end},setpts=PTS-STARTPTS,fps=30,split[b][f];` +
      `[b]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=26,eq=brightness=-0.06[bb];` +
      `[f]scale=1920:1080:force_original_aspect_ratio=decrease[ff];` +
      `[bb][ff]overlay=(W-w)/2:(H-h)/2,setsar=1[v];` +
      `[0:a]atrim=${e.start}:${e.end},asetpts=PTS-STARTPTS,aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.06,afade=t=out:st=${fo}:d=0.08[a]`;
    sh("ffmpeg", ["-y", "-threads", "2", "-i", e.file, "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-pix_fmt", "yuv420p", seg], 300000);
    list.push(`file '${seg}'`);
  });
  writeFileSync(join(segDir, "list.txt"), list.join("\n"));
  sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", join(segDir, "list.txt"), "-c", "copy", out], 300000);
}

function assemble(entries: Entry[]) {
  const segments: SpeechSegment[] = [];
  const cap: SpeechWord[] = [];
  let base = 0;
  entries.forEach((e, i) => {
    const dur = e.end - e.start;
    for (const w of e.words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= e.start && mid < e.end)
        cap.push({
          text: w.text,
          start: Math.max(0, Math.round((base + (w.start - e.start)) * 1000)),
          end: Math.round(Math.min(base + dur, base + (w.end - e.start)) * 1000),
        });
    }
    segments.push({ index: i + 1, total: entries.length, start: Math.round(base * 1000), end: Math.round((base + dur) * 1000), label: SPEAKER });
    base += dur;
  });
  cap.sort((a, b) => a.start - b.start);
  return { segments, words: cap, dur: base };
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  console.log(`SOLO multi-source: ${SPEAKER} — "${TOPIC}"  (${N_SOURCES} speeches, target ${TARGET_SEC}s)`);
  const sourcesJson = join(WORK, "sources.json");
  let srcs: Src[];
  if (existsSync(sourcesJson) && process.env.REDISCOVER !== "1") {
    srcs = JSON.parse(readFileSync(sourcesJson, "utf8"));
    console.log(`CACHED ${srcs.length} sources — skipping discovery/download/whisper`);
  } else {
    const found = await findRawSources({ speaker: SPEAKER, theme: TOPIC, count: N_SOURCES, maxChecks: 10, minHeight: MIN_HEIGHT_SOLO, log: (m) => console.log("  " + m) });
    if (!found.length) throw new Error("no clean HD sources found");
    srcs = [];
    for (const f of found) {
      const file = join(WORK, `src-${f.id}.mp4`);
      const wdir = join(WORK, `wh-${f.id}`);
      const winStart = Math.max(20, Math.floor(f.durationSec * 0.04));
      const winLen = Math.min(900, Math.floor(f.durationSec) - winStart);
      console.log(`download [${f.id}] ${winStart}-${winStart + winLen}s :: ${f.title.slice(0, 50)}`);
      if (!existsSync(file)) sh("yt-dlp", [f.url, "--download-sections", `*${winStart}-${winStart + winLen}`,
        "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", file, "--no-warnings"], 600000);
      mkdirSync(wdir, { recursive: true });
      if (!existsSync(join(wdir, `src-${f.id}.json`))) {
        console.log(`  whisper [${f.id}] …`);
        sh("whisper", [file, "--model", "base", "--language", "en", "--word_timestamps", "True", "--output_format", "json", "--output_dir", wdir], 1200000);
      }
      srcs.push({ id: f.id, url: f.url, file, wh: join(wdir, `src-${f.id}.json`), title: f.title, durationSec: f.durationSec });
    }
    writeFileSync(sourcesJson, JSON.stringify(srcs, null, 0));
  }

  // load each source, build a global combined transcript
  const loaded = srcs.map((s) => ({ ...s, ...loadWhisper(s.wh), dur: ffDur(s.file) }));
  let base = 0;
  const bases: number[] = [];
  const combinedSegs: Seg[] = [];
  for (const s of loaded) {
    bases.push(base);
    for (const g of s.segs) combinedSegs.push({ start: g.start + base, end: g.end + base, text: g.text });
    base += s.dur;
  }
  const totalDur = base;
  console.log(`combined ${loaded.length} speeches → ${totalDur.toFixed(0)}s transcript`);

  const rawGlobal = await selectArc(combinedSegs, totalDur);
  // map each global clip back to its source + snap + LEAD/TAIL
  const entries: Entry[] = [];
  for (const c of rawGlobal) {
    const i = loaded.findIndex((s, k) => c.start >= bases[k] && c.start < bases[k] + s.dur);
    if (i < 0) continue;
    const s = loaded[i];
    const ls = c.start - bases[i];
    const le = Math.min(c.end, bases[i] + s.dur) - bases[i];
    const snap = snapToSentences({ start: ls, end: le, why: c.why }, s.segs);
    const start = Math.max(0, snap.start - LEAD);
    const end = Math.min(s.dur, snap.end + TAIL);
    entries.push({ file: s.file, start, end, words: s.words, why: c.why });
  }
  const final = dedupeEntries(entries);
  console.log(`\n=== ARC PLAN (${final.length} clips across ${new Set(final.map((e) => e.file)).size} speeches) ===`);
  final.forEach((e, i) => console.log(`  ${i + 1}. ${(e.end - e.start).toFixed(1)}s  [${e.file.split("-").pop()?.replace(".mp4", "")}]  ${e.why ?? ""}`));
  const totalLen = final.reduce((s, e) => s + (e.end - e.start), 0);
  console.log(`total ${totalLen.toFixed(0)}s`);

  const montage = join(WORK, "solo-montage.mp4");
  buildMontage(final, montage);
  const { segments, words } = assemble(final);
  const mdur = ffDur(montage);
  copyFileSync(montage, join(WEB, `${SLUG}-montage.mp4`));
  writeFileSync(join(WORK, "solo-plan.json"), JSON.stringify({ speaker: SPEAKER, topic: TOPIC, durationSec: mdur, words, segments }, null, 0));
  console.log(`montage ${mdur.toFixed(1)}s, ${words.length} caption words, ${segments.length} cuts -> ${HTTP_PUB}/${SLUG}-montage.mp4`);
  if (DRY) { console.log("DRY — stopping before render."); return; }

  const bed = join(WEB, "bed-aspirational.mp3");
  console.log("rendering cinematic 1080p (concurrency 1) …");
  await renderCinematicSpeech({
    words, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/${SLUG}-montage.mp4`,
    musicSrc: existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined,
    musicVolume: 0.13,
    durationSec: mdur, width: 1920, height: 1080,
    outPath: join(WEB, `${SLUG}.mp4`), concurrency: 1,
    log: (m) => console.log("   " + m),
  });
  console.log(`VIDEO: ${HTTP_PUB}/${SLUG}.mp4`);

  try {
    const tw = TOPIC.trim().split(/\s+/);
    console.log("thumbnail (banana) …");
    await generateSpeechThumbnail({
      person: SPEAKER,
      lines: [{ text: tw.slice(0, -1).join(" ") }, { text: tw[tw.length - 1], payoff: true, accent: true }],
      expectWords: [tw.slice(0, -1).join(" ").toUpperCase(), tw[tw.length - 1].toUpperCase()],
      outJpg: join(WEB, `${SLUG}-thumb.jpg`),
      log: (m) => console.log("  " + m),
    });
    console.log(`THUMB: ${HTTP_PUB}/${SLUG}-thumb.jpg`);
  } catch (e) {
    console.log("thumbnail failed (non-fatal):", (e as Error).message);
  }
}
main().catch((e) => { console.error("SOLO FAILED:", e.message); process.exit(1); });
