/**
 * MULTI-SPEAKER motivational compilation (one command), reboot-resilient.
 *   topic → speakers (raw-availability first) → per-speaker RAW vision-gated source
 *   → whisper → Gemini picks on-theme quotes → padded 1080p montage
 *   → cinematic render (karaoke captions + aspirational music) → publish.
 *
 *   AUTO_TARGET_MIN=8 node --env-file=.env.local --import tsx scripts/auto-compilation.ts
 *
 * All intermediates persist under /home/ubuntu/speech-work (NOT /tmp), and the
 * assembled plan + montage are written to disk before the long render — so if the
 * render dies, scripts/render-from-plan.ts finishes it without redoing discovery.
 * Tolerant: speakers with no clean raw source (or no on-theme quotes) are skipped.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findRawSource } from "../src/lib/speechSource";
import { geminiJson } from "../src/lib/gemini";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const WORK = "/home/ubuntu/speech-work";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";

const TOPIC = process.env.AUTO_TOPIC || "not giving up";
// VETTED PERSONALITIES ONLY — recognizable public figures (the vision gate also
// confirms the person on camera IS the named speaker). HD-availability first so
// the 720p+ gate still reaches length. Loop stops at TARGET_SEC; the rest are
// fallbacks for when earlier names lack a clean HD source of the actual person.
const SPEAKERS = [
  "Denzel Washington",
  "Matthew McConaughey",
  "Arnold Schwarzenegger",
  "Kobe Bryant",
  "David Goggins",
  "Will Smith",
  "Eric Thomas",
  "Inky Johnson",
  "Les Brown",
  "Steve Harvey",
];
const TARGET_SEC = (parseFloat(process.env.AUTO_TARGET_MIN ?? "8") || 8) * 60;
const PER_SPEAKER_SEC = 110;
// cuts are snapped to whole sentences (below), so only a hair of breath is added.
const LEAD = 0.12, TAIL = 0.3;

type Word = { text: string; start: number; end: number };
type Clip = { start: number; end: number };
type Plan = { speaker: string; file: string; words: Word[]; clips: Clip[] };

function sh(bin: string, args: string[], timeout = 300000) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, timeout });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-500)}`);
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

async function selectQuotes(
  segs: { start: number; end: number; text: string }[],
  speaker: string,
  windowLen: number,
): Promise<Clip[]> {
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

// Snap each chosen quote to WHOLE-SENTENCE boundaries using the whisper segments
// (sentence-level start/end) so cuts never land mid-sentence and aren't abrupt:
// begin at the sentence containing the chosen start, end at the sentence containing
// the chosen end.
function snapToSentences(clips: Clip[], segs: { start: number; end: number; text: string }[]): Clip[] {
  if (!segs.length) return clips;
  return clips.map((c) => {
    let s = c.start, e = c.end;
    const containsStart = segs.find((g) => c.start >= g.start - 0.05 && c.start < g.end);
    if (containsStart) s = containsStart.start;
    else { const nxt = segs.find((g) => g.start >= c.start); if (nxt) s = nxt.start; }
    const containsEnd = segs.find((g) => c.end > g.start && c.end <= g.end + 0.05);
    if (containsEnd) e = containsEnd.end;
    else { const before = segs.filter((g) => g.end <= c.end + 0.05); if (before.length) e = before[before.length - 1].end; }
    return e > s ? { start: s, end: e } : c;
  });
}

// MEMORY-SAFE montage: encode each clip's blurred-fill segment ONE AT A TIME
// (single decoder, capped threads) with per-clip LOUDNESS NORMALIZATION (loudnorm
// → consistent volume across speakers) and short audio edge-fades (no pops), then
// concat with stream-copy. The all-inputs-at-once filtergraph OOM-froze the box.
function buildMontageMulti(entries: { file: string; start: number; end: number }[], out: string) {
  const segDir = join(WORK, "seg");
  mkdirSync(segDir, { recursive: true });
  const listLines: string[] = [];
  entries.forEach((e, i) => {
    const seg = join(segDir, `seg-${String(i).padStart(3, "0")}.mp4`);
    const segDur = Math.max(0.2, e.end - e.start);
    const fOut = Math.max(0, segDur - 0.08).toFixed(3);
    const filter =
      `[0:v]trim=${e.start}:${e.end},setpts=PTS-STARTPTS,fps=30,split[b][f];` +
      `[b]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=26,eq=brightness=-0.06[bb];` +
      `[f]scale=1920:1080:force_original_aspect_ratio=decrease[ff];` +
      `[bb][ff]overlay=(W-w)/2:(H-h)/2,setsar=1[v];` +
      `[0:a]atrim=${e.start}:${e.end},asetpts=PTS-STARTPTS,aresample=48000,` +
      `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.06,afade=t=out:st=${fOut}:d=0.08[a]`;
    sh("ffmpeg", ["-y", "-threads", "2", "-i", e.file, "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-pix_fmt", "yuv420p", seg], 300000);
    listLines.push(`file '${seg}'`);
  });
  writeFileSync(join(segDir, "list.txt"), listLines.join("\n"));
  sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", join(segDir, "list.txt"), "-c", "copy", out], 300000);
}

function assemble(plans: Plan[]) {
  // INTERLEAVE clips across speakers (round-robin) so the edit cross-cuts between
  // them — A1,B1,C1,A2,B2,… — instead of one speaker all the way then the next.
  type Unit = { speaker: string; file: string; start: number; end: number; words: Word[] };
  const units: Unit[] = [];
  const maxClips = Math.max(0, ...plans.map((p) => p.clips.length));
  for (let ci = 0; ci < maxClips; ci++) {
    for (const p of plans) {
      const c = p.clips[ci];
      if (c) units.push({ speaker: p.speaker, file: p.file, start: c.start, end: c.end, words: p.words });
    }
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
    // one chapter per cut → the corner ring advances with the cross-cutting
    segments.push({ index: ui + 1, total: units.length, start: Math.round(base * 1000), end: Math.round((base + dur) * 1000), label: u.speaker });
    base += dur;
  });
  words.sort((a, b) => a.start - b.start);
  return { entries, segments, words };
}

async function main() {
  mkdirSync(WEB, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const plans: Plan[] = [];
  let totalSec = 0;
  let idx = 0;

  for (const name of SPEAKERS) {
    if (totalSec >= TARGET_SEC) break;
    idx++;
    console.log(`\n=== speaker ${idx}: ${name} ===`);
    try {
      const src = await findRawSource({
        speaker: name,
        theme: TOPIC,
        maxChecks: 8,
        log: (m) => console.log("  " + m),
      });
      const winStart = Math.max(45, Math.floor(src.durationSec * 0.2));
      const winLen = Math.min(480, Math.max(280, Math.floor(src.durationSec * 0.5)));
      const file = join(WORK, `src-${idx}.mp4`);
      console.log(`  download 1080p ${winStart}-${winStart + winLen}s  [${src.title.slice(0, 50)}]`);
      sh("yt-dlp", [src.url, "--download-sections", `*${winStart}-${winStart + winLen}`,
        "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", file, "--no-warnings"], 480000);
      console.log("  whisper…");
      const wdir = join(WORK, `wh-${idx}`);
      mkdirSync(wdir, { recursive: true });
      sh("whisper", [file, "--model", "base", "--language", "en", "--word_timestamps", "True",
        "--output_format", "json", "--output_dir", wdir], 900000);
      const { words, segs } = loadWhisper(join(wdir, `src-${idx}.json`));
      const dur = ffDur(file);
      console.log(`  ${words.length} words; selecting on-theme quotes…`);
      const raw = await selectQuotes(segs, name, dur);
      if (!raw.length) { console.log("  ↳ no on-theme quotes, skip"); continue; }
      const snapped = snapToSentences(raw, segs);
      const clips = snapped.map((c) => ({ start: Math.max(0, c.start - LEAD), end: Math.min(dur, c.end + TAIL) }));
      const add = clips.reduce((s, c) => s + (c.end - c.start), 0);
      plans.push({ speaker: name, file, words, clips });
      totalSec += add;
      console.log(`  ✓ ${clips.length} quotes (+${add.toFixed(0)}s) → total ${totalSec.toFixed(0)}s / ${TARGET_SEC}s`);
    } catch (e) {
      console.log(`  ↳ skip ${name}: ${(e as Error).message.slice(0, 140)}`);
    }
  }

  if (!plans.length) throw new Error("no speakers yielded a clean raw source");

  console.log(`\nassembling ${plans.length} speakers …`);
  const { entries, segments, words } = assemble(plans);
  const montage = join(WORK, "montage.mp4");
  buildMontageMulti(entries, montage);
  const dur = ffDur(montage);
  copyFileSync(montage, join(WEB, "nq-montage.mp4"));
  // persist plan for crash-safe re-render
  writeFileSync(join(WORK, "plan.json"), JSON.stringify({ topic: TOPIC, speakers: plans.map((p) => p.speaker), durationSec: dur, words, segments }, null, 0));
  console.log(`montage ${dur.toFixed(1)}s, ${words.length} caption words, ${segments.length} chapters — plan.json written`);

  const bed = join(WEB, "bed-aspirational.mp3");
  const musicUrl = existsSync(bed) ? `${HTTP_LOCAL}/bed-aspirational.mp3` : undefined;

  console.log("rendering cinematic 1080p (concurrency 1 — OOM-safe) …");
  const out = join(WEB, "notgivingup.mp4");
  await renderCinematicSpeech({
    words, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/nq-montage.mp4`,
    musicSrc: musicUrl, musicVolume: 0.14,
    durationSec: dur, width: 1920, height: 1080,
    outPath: out, concurrency: 1,
    log: (m) => console.log("   " + m),
  });

  console.log("\n=== DONE ===");
  console.log("topic:", TOPIC, "| speakers:", plans.map((p) => p.speaker).join(", "));
  console.log("length:", dur.toFixed(1) + "s");
  console.log("LINK:", `${HTTP_PUB}/notgivingup.mp4`);
}

main().catch((e) => { console.error("COMPILATION FAILED:", e.message); process.exit(1); });
