/**
 * AssemblyAI transcription → word-level timestamps for caption (SRT) generation,
 * plus pure SRT + chapter builders (no API, unit-testable).
 *
 * We have the exact narration audio (Fish Audio TTS). AssemblyAI transcribes it
 * with word timings; we render an SRT shifted by the title-card intro offset.
 * Key: ASSEMBLYAI_API_KEY (vault service "assemblyai"). Absent → callers degrade
 * (chapters still work; SRT is skipped).
 */
const BASE = "https://api.assemblyai.com/v2";

export function hasAssemblyKey(): boolean {
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}

export interface Word {
  text: string;
  /** ms from start of the audio. */
  start: number;
  end: number;
}

export class AssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyError";
  }
}

/** Transcribe a (public) audio URL → word list. Polls until completed. */
export async function transcribeWords(
  audioUrl: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Word[]> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new AssemblyError("ASSEMBLYAI_API_KEY is not configured");
  const headers = { authorization: key, "content-type": "application/json" };

  const create = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers,
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  const created = (await create.json()) as { id?: string; error?: string };
  if (!create.ok || !created.id) {
    throw new AssemblyError(`create failed: HTTP ${create.status} ${created.error ?? ""}`);
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 600_000);
  const pollMs = opts.pollMs ?? 3000;
  for (;;) {
    if (Date.now() > deadline) throw new AssemblyError("transcription timed out");
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch(`${BASE}/transcript/${created.id}`, { headers });
    const data = (await res.json()) as {
      status?: string;
      error?: string;
      words?: Array<{ text: string; start: number; end: number }>;
    };
    if (data.status === "completed") {
      return (data.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end }));
    }
    if (data.status === "error") throw new AssemblyError(`transcription error: ${data.error ?? ""}`);
  }
}

/* ------------------------------- SRT ----------------------------------- */

function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const millis = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(millis, 3)}`;
}

/**
 * Group words into SRT cues. A cue breaks on max words, a long gap, or max
 * duration. All times shifted by `offsetMs` (the title-card intro).
 */
export function wordsToSrt(
  words: Word[],
  offsetMs = 0,
  opts: { maxWords?: number; maxGapMs?: number; maxDurMs?: number } = {},
): string {
  const maxWords = opts.maxWords ?? 8;
  const maxGap = opts.maxGapMs ?? 700;
  const maxDur = opts.maxDurMs ?? 5000;
  const cues: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length === 0) {
      cur.push(w);
      continue;
    }
    const prev = cur[cur.length - 1];
    const gap = w.start - prev.end;
    const dur = w.end - cur[0].start;
    if (cur.length >= maxWords || gap > maxGap || dur > maxDur) {
      cues.push(cur);
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length) cues.push(cur);

  return cues
    .map((cue, i) => {
      const start = srtTime(cue[0].start + offsetMs);
      const end = srtTime(cue[cue.length - 1].end + offsetMs);
      const text = cue.map((w) => w.text).join(" ").replace(/\s+([,.!?])/g, "$1");
      return `${i + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
}

/* ----------------------------- chapters -------------------------------- */

export interface ChapterSection {
  heading?: string;
  text?: string;
  narration?: string;
}

function chapterTime(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/**
 * Build a YouTube chapter block from script sections, apportioned across the
 * narration by word count and offset by the intro. YouTube rules enforced:
 * first chapter at 0:00, ascending, ≥10s apart, ≥3 chapters (else "" — chapters
 * are ignored by YouTube below 3). No API needed.
 */
export function buildChapters(
  sections: ChapterSection[],
  narrationSec: number,
  offsetSec = 0,
): string {
  if (!sections?.length || narrationSec <= 0) return "";
  const counts = sections.map((s) =>
    Math.max(1, (s.text ?? s.narration ?? s.heading ?? "").split(/\s+/).filter(Boolean).length),
  );
  const total = counts.reduce((a, b) => a + b, 0);

  const raw: Array<{ t: number; title: string }> = [{ t: 0, title: "Intro" }];
  let acc = 0;
  for (let i = 0; i < sections.length; i++) {
    const t = offsetSec + (acc / total) * narrationSec;
    acc += counts[i];
    const title = (sections[i].heading ?? `Part ${i + 1}`).trim() || `Part ${i + 1}`;
    raw.push({ t, title });
  }

  // Enforce ascending + ≥10s gaps (drop chapters too close to the previous).
  const kept: Array<{ t: number; title: string }> = [];
  for (const c of raw) {
    if (kept.length === 0 || c.t >= kept[kept.length - 1].t + 10) kept.push(c);
  }
  if (kept.length < 3) return "";
  return kept.map((c) => `${chapterTime(c.t)} ${c.title}`).join("\n");
}
