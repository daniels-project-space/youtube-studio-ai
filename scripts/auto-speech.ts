/**
 * FULL AUTO pipeline (one command) for the motivational-speech module:
 *   discover topic + RAW source (vision-gated)
 *   → download a window → whisper word-timestamps
 *   → Gemini auto-selects the punchiest contiguous passages
 *   → cut + concat → cinematic render (karaoke captions + music) → publish.
 *
 *   node --env-file=.env.local --import tsx scripts/auto-speech.ts
 *
 * This is the production pipeline minus the Convex/Trigger/R2 plumbing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findRawSource, pickMotivationalTopic } from "../src/lib/speechSource";
import { geminiJson } from "../src/lib/gemini";
import { renderCinematicSpeech } from "../src/lib/remotionRender";
import type { SpeechSegment, SpeechWord } from "../src/remotion/speech/types";

const WEB = "/var/www/html/speech-tv";
const HTTP_LOCAL = "http://127.0.0.1/speech-tv";
const HTTP_PUB = "http://87.106.233.113/speech-tv";

type Clip = { start: number; end: number };

function sh(bin: string, args: string[], timeout = 240000) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 27, timeout });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status}): ${r.stderr?.toString().slice(-600)}`);
  return r.stdout?.toString() ?? "";
}
const ffDur = (f: string) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).trim());

function loadWords(jsonPath: string) {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const words: { text: string; start: number; end: number }[] = [];
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

function buildMontage(clips: Clip[], source: string, out: string) {
  const parts: string[] = [];
  const labels: string[] = [];
  clips.forEach((c, i) => {
    parts.push(`[0:v]trim=${c.start}:${c.end},setpts=PTS-STARTPTS,scale=1280:720,fps=30,setsar=1[v${i}]`);
    parts.push(`[0:a]atrim=${c.start}:${c.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const filter = parts.join(";") + ";" + labels.join("") + `concat=n=${clips.length}:v=1:a=1[v][a]`;
  sh("ffmpeg", ["-y", "-i", source, "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", out], 300000);
}

function remap(words: { text: string; start: number; end: number }[], clips: Clip[]) {
  const out: SpeechWord[] = [];
  const segs: SpeechSegment[] = [];
  let base = 0;
  clips.forEach((c, i) => {
    const dur = c.end - c.start;
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= c.start && mid < c.end)
        out.push({
          text: w.text,
          start: Math.max(0, Math.round((base + (w.start - c.start)) * 1000)),
          end: Math.round(Math.min(base + dur, base + (w.end - c.start)) * 1000),
        });
    }
    segs.push({ index: i + 1, total: clips.length, start: Math.round(base * 1000), end: Math.round((base + dur) * 1000) });
    base += dur;
  });
  return { words: out.sort((a, b) => a.start - b.start), segments: segs };
}

async function selectCuts(
  segs: { start: number; end: number; text: string }[],
  topic: { theme: string; speaker: string },
  windowLen: number,
): Promise<Clip[]> {
  const transcript = segs.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
  const prompt = `You are editing a faceless motivational short from a ${topic.speaker} seminar.
Theme: "${topic.theme}".
Below is a timestamped transcript (seconds). Choose 3-5 CONTIGUOUS passages that, played back-to-back in order, form ONE tight, punchy, self-contained motivational message (~70-95 seconds total). Each passage must start and end on a complete thought (don't cut mid-sentence). Prefer vivid, quotable, high-energy lines. Avoid tangents, audience chatter, and dead air.

Return ONLY JSON: {"title":"...","clips":[{"start":<sec>,"end":<sec>}]}  (times within 0..${windowLen.toFixed(0)})

TRANSCRIPT:
${transcript}`;
  const res = await geminiJson<{ title?: string; clips?: Clip[] }>({ prompt, maxTokens: 800 });
  let clips = (res.clips ?? [])
    .map((c) => ({ start: Math.max(0, +c.start), end: Math.min(windowLen, +c.end) }))
    .filter((c) => c.end - c.start >= 2 && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  // cap total to ~95s
  const capped: Clip[] = [];
  let total = 0;
  for (const c of clips) {
    if (total >= 95) break;
    const d = Math.min(c.end - c.start, 95 - total);
    capped.push({ start: c.start, end: c.start + d });
    total += d;
  }
  if (!capped.length) throw new Error("Gemini returned no usable clips");
  console.log(`  title: ${res.title ?? "(none)"}`);
  return capped;
}

async function main() {
  mkdirSync(WEB, { recursive: true });

  // 1. discover topic + raw, vision-gated source
  const topic = pickMotivationalTopic({ seedIndex: 1 });
  const src = await findRawSource({ topic, maxChecks: 5, log: (m) => console.log(m) });
  console.log(`\nsource: ${src.url} (${Math.round(src.durationSec / 60)}m)`);

  // 2. download a content-rich window
  const winStart = Math.max(60, Math.floor(src.durationSec * 0.25));
  const winLen = 600; // 10 min
  const raw = "/tmp/auto-raw.mp4";
  console.log(`downloading window ${winStart}s..${winStart + winLen}s …`);
  sh("yt-dlp", [src.url, "--download-sections", `*${winStart}-${winStart + winLen}`,
    "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4", "-o", raw, "--no-warnings"], 300000);

  // 3. whisper word timestamps
  console.log("whisper transcribing …");
  const wdir = "/tmp/auto-whisper";
  mkdirSync(wdir, { recursive: true });
  sh("whisper", [raw, "--model", "base", "--language", "en", "--word_timestamps", "True",
    "--output_format", "json", "--output_dir", wdir], 480000);
  const { words, segs } = loadWords(join(wdir, "auto-raw.json"));
  console.log(`  ${words.length} words, ${segs.length} segments`);

  // 4. Gemini selects the punchy cuts
  console.log("selecting cuts (Gemini) …");
  const clips = await selectCuts(segs, topic, ffDur(raw));
  console.log("  clips:", clips.map((c) => `${c.start.toFixed(1)}-${c.end.toFixed(1)}`).join(", "));

  // 5. montage + remap
  const montage = "/tmp/auto-montage.mp4";
  buildMontage(clips, raw, montage);
  const dur = ffDur(montage);
  copyFileSync(montage, join(WEB, "auto-montage.mp4"));
  const { words: rw, segments } = remap(words, clips);
  console.log(`  montage ${dur.toFixed(1)}s, ${rw.length} caption words`);

  // 6. music bed
  let musicUrl: string | undefined;
  const bed = join(WEB, "bed.mp3");
  if (existsSync(bed)) musicUrl = `${HTTP_LOCAL}/bed.mp3`;

  // 7. cinematic render
  console.log("rendering cinematic …");
  const out = join(WEB, "auto-final.mp4");
  await renderCinematicSpeech({
    words: rw, segments,
    sourceVideoSrc: `${HTTP_LOCAL}/auto-montage.mp4`,
    musicSrc: musicUrl, musicVolume: 0.09,
    durationSec: dur, outPath: out, concurrency: 4,
    log: (m) => console.log("   " + m),
  });

  console.log("\n=== DONE ===");
  console.log("topic:", topic.theme, "·", topic.speaker);
  console.log("source:", src.url);
  console.log("LINK:", `${HTTP_PUB}/auto-final.mp4`);
}

main().catch((e) => { console.error("AUTO FAILED:", e.message); process.exit(1); });
