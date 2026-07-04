/**
 * Speech-source discovery for the motivational-speech module.
 *
 *   resolveSourceQueries(speaker, theme) → queries aimed at the ORIGINAL events
 *   dumpCandidates(queries)              → metadata-scored candidates (yt-dlp json)
 *   sampleFramesSpanning(cand)           → frames spread across the whole video
 *   ocrCaptionCheck(frames)              → cheap tesseract burned-caption detector
 *   visionCheckRaw(frames)               → Gemini vision: captions / effects / watermark
 *   findRawSource(opts)                  → orchestrates the above → ONE clean raw source
 *
 * "Raw" = a plain recording of a person speaking with NO baked-in captions, text
 * overlays, watermarks/logos, or graphic effects — so our own cinematic frame +
 * karaoke captions are the only treatment.
 *
 * THE SOURCING INSIGHT: famous motivational lines (Denzel "Fall Forward", Will
 * Smith on failure, …) are clipped from specific ORIGINAL events — commencement
 * addresses, full interviews, sermons, seminars. Those originals exist raw on
 * official/institutional channels. A naive "<speaker> motivation" search only
 * returns fan compilations (burned captions + watermark + music), which the gate
 * correctly rejects — leaving nothing. So we (1) resolve the original events with
 * an LLM, (2) rank candidates by metadata so originals float up and edits sink,
 * (3) cheaply OCR-screen for burned captions before the vision gate gives the
 * final verdict.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiJson, parseJsonLoose, hasGeminiKey } from "./gemini";
import { visionLocal, hasVisionKey } from "@/lib/vision";

export type SpeechTopic = {
  theme: string;
  speaker: string;
  /** legacy single query; the resolver now produces several. */
  query: string;
};

const THEMES = [
  "discipline beats motivation",
  "work harder on yourself",
  "take full responsibility",
  "the power of consistency",
  "overcoming the fear of failure",
  "delayed gratification & patience",
  "becoming who you must become",
  "value creation and self-worth",
  "persistence through setbacks",
  "ownership of your future",
];

// Speakers with abundant long, plain seminar/interview footage (gate still verifies).
const SPEAKERS = ["Jim Rohn", "Les Brown", "Earl Nightingale", "Zig Ziglar", "Brian Tracy", "Wayne Dyer"];

/** Pick a motivational topic + a query tuned for raw full-seminar uploads. */
export function pickMotivationalTopic(opts?: {
  seedIndex?: number;
  exclude?: string[];
}): SpeechTopic {
  const exclude = new Set((opts?.exclude ?? []).map((s) => s.toLowerCase()));
  const pool = THEMES.filter((t) => !exclude.has(t.toLowerCase()));
  const themes = pool.length ? pool : THEMES;
  const i = opts?.seedIndex ?? Math.floor((Date.now() / 1000) % themes.length);
  const theme = themes[i % themes.length];
  const speaker = SPEAKERS[i % SPEAKERS.length];
  return { theme, speaker, query: `${speaker} ${theme} full speech seminar` };
}

export type Candidate = {
  id: string;
  url: string;
  title: string;
  durationSec: number;
  channel?: string;
  description?: string;
  maxHeight?: number;
  score?: number;
  query?: string;
};

/** Minimum acceptable source resolution — below this the footage looks bad even
 * before our grade. Pushes selection toward official HD commencement/interview
 * uploads instead of low-res fan re-uploads. */
const MIN_HEIGHT = 720;

// obviously-edited / wrong-format titles, dropped outright
const REJECT_TITLE =
  /\b(sub(title)?s?|captioned|lyrics?|reaction|shorts?|status|whatsapp|edit|remix|amv|tiktok)\b/i;

// fan-compilation channels (name signals) — heavy penalty
const DENY_CHANNEL =
  /motivation|motiv\b|hustle|grind|inspir|mindset|fearless|warrior|\balpha\b|success\s?(stories|secrets|archive)|ben\s?lionel|mulligan|eddie\s?pinero|mateusz|your\s?world\s?within|absolute|madness|\bhub\b|daily\s?(dose|motivation)/i;

// signals of an ORIGINAL/official source — reward
const ORIGINAL_SIGNAL =
  /universit|college|commencement|\bted\b|tedx|c-?span|\bnews\b|official|tonight\s?show|jimmy\s?(fallon|kimmel)|charlie\s?rose|breakfast\s?club|graham\s?bensinger|interview|keynote|lecture|sermon|conference|archive|talks?\s?at\s?google|oxford|cambridge|\bforum\b|summit|podcast|\bshow\b/i;

// genre-marker titles that scream fan-edit — penalty
const GENRE_NOISE =
  /motivational\s?(speech|video)|compilation|best\s?of|will\s?leave\s?you\s?speechless|eye[-\s]?opening|one\s?of\s?the\s?(greatest|best)|speech\s?that\s?will|change\s?your\s?life|listen\s?(every\s?day|daily|to\s?this)|watch\s?this|powerful\s?motivat|gym|workout/i;

// words that suggest a full, original upload — reward
const ORIGINAL_WORDS =
  /\bfull\s?(speech|video|interview|address|seminar|sermon|lecture|talk|keynote|episode|set)\b|\bcomplete\b|\bentire\b|\buncut\b|\bq&?a\b|\bin\s?full\b|\bextended\b/i;

/** All speaker name tokens present (word-start) anywhere in the text? Kills
 * same-channel / same-keyword decoys (Charlie Rose interviewing someone else,
 * "Will Ferrell" for "Will Smith") that metadata scoring alone lets float up. */
function mentionsSpeaker(text: string, speaker: string): boolean {
  const toks = speaker.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!toks.length) return true;
  const hay = text.toLowerCase();
  return toks.every((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay));
}

function scoreCandidate(c: { durationSec: number; title: string; channel: string; description: string }): number {
  let s = 0;
  const dur = c.durationSec;
  if (dur >= 1500) s += 3;
  else if (dur >= 600) s += 1;
  else if (dur < 300) s -= 3; // compilation territory
  const chan = c.channel ?? "";
  const td = `${c.title} ${c.description}`;
  if (DENY_CHANNEL.test(chan)) s -= 5;
  if (ORIGINAL_SIGNAL.test(`${chan} ${td}`)) s += 3;
  if (GENRE_NOISE.test(c.title)) s -= 3;
  if (ORIGINAL_WORDS.test(c.title)) s += 2;
  // strongly prefer solo, on-theme, inspiring formats (the gold standard: one
  // speaker the whole time, usually an official HD upload).
  if (/commencement|graduation|valedictor|keynote/i.test(c.title)) s += 4;
  // "X, Y and Z …" = a multi-guest panel/junket — other named people share the
  // screen and audio, so the target speaker isn't reliably on camera.
  if (/,.*\b(and|&)\b/i.test(c.title)) s -= 3;
  return s;
}

/**
 * LLM resolves the ORIGINAL events behind a speaker's famous lines on a theme and
 * returns YouTube queries biased to official/full uploads. Falls back to safe
 * templates if no key / failure.
 */
export async function resolveSourceQueries(
  speaker: string,
  theme: string,
  log: (m: string) => void = () => {},
): Promise<string[]> {
  const fallback = [
    `${speaker} full speech`,
    `${speaker} full interview`,
    `${speaker} commencement address full`,
    `${speaker} keynote full ${theme}`,
  ];
  if (!hasGeminiKey()) return fallback;
  try {
    const prompt = `You source RAW, uncaptioned ORIGINAL video of a motivational speaker — NOT fan compilations (those have burned-in captions, watermarks, added music).
Speaker: ${speaker}
Theme: ${theme}
This speaker's famous lines on this theme come from specific real events (commencement addresses, full interviews, sermons, seminars, press conferences, talk-show appearances, lectures). Identify the most likely ORIGINAL events and give search queries that surface the ORIGINAL FULL upload from an official / institutional channel.
Return ONLY JSON: {"queries":["..."]} with 4-6 strings.
Each query SHOULD name the venue/host and year when known and include words like "full", "complete", "address", "interview", "keynote".
Each query MUST NOT contain: motivation, motivational, compilation, "best of", "speech that will", "eye opening".`;
    const res = await geminiJson<{ queries?: string[] }>({ prompt, maxTokens: 500 });
    const cleaned = (res.queries ?? [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .filter((q) => !/motivation|compilation|best\s?of/i.test(q));
    log(`resolver: ${cleaned.length} queries`);
    return cleaned.length ? cleaned.slice(0, 6) : fallback;
  } catch (e) {
    log(`resolver failed (${(e as Error).message}); fallback queries`);
    return fallback;
  }
}

/**
 * yt-dlp metadata (no download) for each query → require the speaker is actually
 * mentioned → metadata-scored, deduped, best-first. The speaker-presence filter
 * is what stops same-channel/keyword decoys from outranking the real source.
 */
export function dumpCandidates(queries: string[], speaker = "", perQuery = 5, log: (m: string) => void = () => {}): Candidate[] {
  const byId = new Map<string, Candidate>();
  let droppedSpeaker = 0;
  for (const q of queries) {
    const r = spawnSync(
      "yt-dlp",
      [`ytsearch${perQuery}:${q}`, "--dump-json", "--skip-download", "--no-warnings"],
      { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 27, timeout: 180000 },
    );
    const lines = (r.stdout?.toString() ?? "").trim().split("\n").filter(Boolean);
    let kept = 0;
    for (const ln of lines) {
      let j: { id?: string; title?: string; duration?: number; channel?: string; uploader?: string; description?: string };
      try {
        j = JSON.parse(ln);
      } catch {
        continue;
      }
      const id = j.id;
      if (!id || byId.has(id)) continue;
      const durationSec = Number(j.duration) || 0;
      if (durationSec < 300 || durationSec > 4 * 3600) continue;
      const title = String(j.title ?? "");
      if (REJECT_TITLE.test(title)) continue;
      const channel = String(j.channel ?? j.uploader ?? "");
      const description = String(j.description ?? "").slice(0, 400);
      // require the speaker's name in the TITLE (or channel) — NOT description.
      // A description that merely name-drops the speaker (e.g. an Oprah/DeVon
      // Franklin video that mentions "Will Smith") is a false match: he isn't in it.
      if (speaker && !mentionsSpeaker(`${title} ${channel}`, speaker)) {
        droppedSpeaker++;
        continue;
      }
      // NOTE: real resolution is NOT gated here — search dump-json is a cheap
      // extraction that caps formats at ~360p. The true max height is probed per
      // candidate in findRawSource (full extraction, POT-unlocked).
      const score = scoreCandidate({ durationSec, title, channel, description });
      byId.set(id, { id, url: `https://www.youtube.com/watch?v=${id}`, title, durationSec, channel, description, score, query: q });
      kept++;
    }
    log(`  q "${q.slice(0, 46)}" → ${lines.length} hits, ${kept} kept`);
  }
  if (speaker) log(`  (dropped ${droppedSpeaker} not mentioning "${speaker}")`);
  return [...byId.values()].sort((a, b) => (b.score! - a.score!) || (b.durationSec - a.durationSec));
}

/** Back-compat: old single-query search (still used by some callers). */
export function searchCandidates(query: string, n = 8, speaker = ""): Candidate[] {
  return dumpCandidates([query], speaker, n);
}

/** Real max downloadable height via FULL extraction. Search dump-json is a cheap
 * extraction that caps at ~360p, so the actual video must be probed. Needs the POT
 * provider (docker bgutil on :4416) running for HD on datacenter IPs. */
export function probeMaxHeight(url: string): number {
  const r = spawnSync("yt-dlp", [url, "--print", "%(height)s", "--no-warnings"],
    { stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
  const h = parseInt((r.stdout?.toString() ?? "").trim(), 10);
  return Number.isFinite(h) ? h : 0;
}

/** Download small sections spread across the video and grab frames spanning it. */
export function sampleFramesSpanning(cand: Candidate, positions = [0.22, 0.5, 0.78]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "rawcheck-"));
  const frames: string[] = [];
  positions.forEach((p, pi) => {
    const startSec = Math.max(20, Math.floor(cand.durationSec * p));
    const clip = join(dir, `seg${pi}.mp4`);
    const dl = spawnSync(
      "yt-dlp",
      [cand.url, "--download-sections", `*${startSec}-${startSec + 6}`,
        "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4", "-o", clip, "--no-warnings"],
      { stdio: "ignore", timeout: 150000 },
    );
    if (dl.status !== 0) return;
    for (let i = 0; i < 2; i++) {
      const t = 1.5 + i * 3;
      const png = join(dir, `f${pi}_${i}.jpg`);
      const ff = spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", clip, "-frames:v", "1", png], { stdio: "ignore" });
      if (ff.status === 0) frames.push(png);
    }
  });
  return frames;
}

/** Legacy single-window sampler (kept for callers / proofs). */
export function sampleFrames(cand: Candidate, count = 4): string[] {
  const dir = mkdtempSync(join(tmpdir(), "rawcheck-"));
  const startSec = Math.max(30, Math.floor(cand.durationSec * 0.35));
  const clip = join(dir, "sample.mp4");
  const dl = spawnSync(
    "yt-dlp",
    [cand.url, "--download-sections", `*${startSec}-${startSec + 16}`,
      "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4", "-o", clip, "--no-warnings"],
    { stdio: "ignore", timeout: 180000 },
  );
  if (dl.status !== 0) return [];
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const png = join(dir, `f${i}.jpg`);
    const ff = spawnSync("ffmpeg", ["-y", "-ss", String(2 + i * 3), "-i", clip, "-frames:v", "1", png], { stdio: "ignore" });
    if (ff.status === 0) frames.push(png);
  }
  return frames;
}

export type OcrResult = { available: boolean; captioned: boolean; lowerBandHits: number; frames: number };

function ocrAvailable(): boolean {
  return spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Cheap deterministic burned-caption detector: OCR the lower band of each frame;
 * persistent text across MOST frames spanning the video = baked captions. A one-off
 * title card or transient lower-third name won't reach the majority threshold.
 */
export function ocrCaptionCheck(frames: string[]): OcrResult {
  if (!frames.length) return { available: ocrAvailable(), captioned: false, lowerBandHits: 0, frames: 0 };
  if (!ocrAvailable()) return { available: false, captioned: false, lowerBandHits: 0, frames: frames.length };
  const norms: string[] = [];
  for (const f of frames) {
    const band = f.replace(/\.jpg$/, "_band.png");
    const crop = spawnSync("ffmpeg", ["-y", "-i", f, "-vf", "crop=iw:ih*0.42:0:ih*0.58", band], { stdio: "ignore" });
    if (crop.status !== 0) continue;
    const out = spawnSync("tesseract", [band, "stdout", "--psm", "6"], { stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }).stdout?.toString() ?? "";
    const norm = out.toLowerCase().replace(/[^a-z]/g, "");
    if (norm.length >= 14) norms.push(norm);
  }
  // Captions CHANGE across frames (new words as speech progresses). Static in-scene
  // signage (a podium seal, a banner) shows the SAME text every frame — must NOT be
  // flagged as captions. Only call it captions if the lower-band text actually varies.
  const sig = new Map<string, number>();
  for (const n of norms) { const s = n.slice(0, 18); sig.set(s, (sig.get(s) ?? 0) + 1); }
  const dominant = norms.length ? Math.max(...sig.values()) : 0;
  const changing = norms.length - dominant;
  const captioned = norms.length >= Math.ceil(frames.length * 0.5) && changing >= Math.ceil(norms.length * 0.7);
  return { available: true, captioned, lowerBandHits: norms.length, frames: frames.length };
}

export type RawVerdict = {
  clean: boolean;
  hasCaptions: boolean;
  hasOverlays: boolean;
  hasWatermark: boolean;
  isTalkingHead: boolean;
  isSpeaker: boolean;
  reason: string;
};

const VISION_PROMPT = `You are screening footage for a faceless motivational channel. We add our OWN cinematic look and captions. A LIGHT watermark (a small/subtle channel logo or corner "bug") is ACCEPTABLE. What we cannot use is footage already covered in CAPTIONS or heavy editing. These frames are sampled from different points of ONE video.

CRUCIAL distinction: separate things ADDED IN EDITING from things physically PRESENT in the real room. Test: "would this be visible if I walked into that room with a camera?" If yes, it is part of the scene and is FINE.

REJECT (clean=false) for these EDITOR-ADDED graphics:
- burned-in subtitles / captions (words timed to the speech) — the main thing to reject
- lower-third name/title banners or text straps added in post
- LARGE / intrusive watermarks or branding that dominate the frame (a small corner logo is fine, a big splashy logo is not)
- recurring on-screen text callouts, social handles, subscribe prompts, progress/timeline bars
- title cards / text slates
- applied effects: heavy color filters, glitch, added vignettes/frames

ACCEPT (clean=true) — these are FINE:
- a SMALL / subtle channel logo or corner watermark/bug (a light watermark is OK)
- REAL-WORLD signage physically in the scene: a lectern/podium school seal, network mic flags ("ROGERS","CNN"), event banners, stage backdrops, step-and-repeat
- a person speaking on a stage, in an interview, a podcast, or at a press conference

Return ONLY JSON:
{"clean":bool,"hasCaptions":bool,"hasOverlays":bool,"hasWatermark":bool,"isTalkingHead":bool,"reason":"short"}
hasWatermark = report a corner logo if present (does NOT by itself disqualify).
hasOverlays = heavy editor-added graphics only (captions / lower-thirds / big branding / effects — NOT real-world signage or a small corner bug).
clean = true if there are NO burned-in captions, NO lower-third text banners, NO dominant branding, and NO applied effects (a light corner watermark is allowed), and it is a real recording of a person speaking.`;

/** Routed-vision verdict: is this candidate raw (no captions/effects)? */
export async function visionCheckRaw(framePaths: string[], speaker = ""): Promise<RawVerdict> {
  if (!framePaths.length)
    return { clean: false, hasCaptions: false, hasOverlays: false, hasWatermark: false, isTalkingHead: false, isSpeaker: false, reason: "no frames" };
  // Provider-routed vision: any keyed provider (groq/fal/gemini) can run this gate.
  if (!hasVisionKey()) throw new Error("no vision provider keyed (GROQ_API_KEY / FAL_KEY / GEMINI_API_KEY) — vision frame-check requires one");
  // Identity check: confirm the named (vetted) personality is the one on camera.
  // Lenient — only reject on a CLEAR mismatch, so lesser-known faces aren't dropped.
  const idClause = speaker
    ? `\n\nIDENTITY: the target speaker is ${speaker}, a well-known public figure. Also return "isSpeaker" — set it FALSE only if you can clearly see the main person speaking is NOT ${speaker} (a recognizably different person, or an interviewer/host doing the talking, or you only see the audience/back of an unknown person). If you are unsure who it is, set isSpeaker TRUE. Include "isSpeaker":bool in the JSON.`
    : "";
  const raw = await visionLocal({ prompt: VISION_PROMPT + idClause, imagePaths: framePaths, json: true, maxTokens: 400 });
  const v = parseJsonLoose<Partial<RawVerdict>>(raw);
  return {
    clean: !!v.clean,
    hasCaptions: !!v.hasCaptions,
    hasOverlays: !!v.hasOverlays,
    hasWatermark: !!v.hasWatermark,
    isTalkingHead: !!v.isTalkingHead,
    isSpeaker: v.isSpeaker === undefined ? true : !!v.isSpeaker,
    reason: v.reason ?? "",
  };
}

export type RawSource = Candidate & { topic: SpeechTopic; frames: string[]; verdict: RawVerdict; ocr: OcrResult };

/**
 * Full discovery: resolve original-event queries → metadata-score candidates →
 * for each (best first): sample spanning frames → OCR pre-filter → vision gate →
 * return the FIRST raw one. Throws if none pass within `maxChecks`.
 */
/**
 * Collect up to `count` DISTINCT clean HD sources of the SAME speaker on the
 * topic — for single-person videos that cut across multiple of their speeches.
 */
export async function findRawSources(opts: {
  speaker: string;
  theme: string;
  count?: number;
  maxChecks?: number;
  perQuery?: number;
  /** resolution floor; default MIN_HEIGHT (720). Lower it to allow SD-era icons
   * (e.g. Steve Jobs) to yield MULTIPLE speeches. */
  minHeight?: number;
  log?: (m: string) => void;
}): Promise<RawSource[]> {
  const log = opts.log ?? (() => {});
  const topic: SpeechTopic = { theme: opts.theme, speaker: opts.speaker, query: "" };
  const want = opts.count ?? 3;
  const minH = opts.minHeight ?? MIN_HEIGHT;
  const queries = await resolveSourceQueries(opts.speaker, opts.theme, log);
  queries.forEach((q) => log(`  query: ${q}`));
  const candidates = dumpCandidates(queries, opts.speaker, opts.perQuery ?? 6, log);
  log(`scored ${candidates.length} candidates; collecting up to ${want} clean HD sources`);
  const found: RawSource[] = [];
  let checked = 0;
  const maxChecks = opts.maxChecks ?? 16;
  for (const c of candidates) {
    if (checked >= maxChecks || found.length >= want) break;
    checked++;
    const realH = probeMaxHeight(c.url);
    c.maxHeight = realH;
    log(`check [${checked}] ${realH}p ${Math.round(c.durationSec / 60)}m [${c.channel}] :: ${c.title.slice(0, 44)}`);
    if (realH < MIN_HEIGHT) { log(`  ↳ low-res ${realH}p — skip`); continue; }
    const frames = sampleFramesSpanning(c);
    if (!frames.length) { log("  ↳ no frames — skip"); continue; }
    const ocr = ocrCaptionCheck(frames);
    if (ocr.available && ocr.captioned) { log("  ↳ burned captions — skip"); continue; }
    const verdict = await visionCheckRaw(frames, opts.speaker);
    if (verdict.clean && verdict.isSpeaker) { found.push({ ...c, topic, frames, verdict, ocr }); log(`  ↳ CLEAN ✓ (source #${found.length})`); continue; }
    if (verdict.clean && !verdict.isSpeaker) { log(`  ↳ not ${opts.speaker} — skip`); continue; }
    log(`  ↳ reject: ${verdict.reason}`);
  }
  log(`found ${found.length} clean HD source(s)`);
  return found;
}

export async function findRawSource(opts?: {
  topic?: SpeechTopic;
  speaker?: string;
  theme?: string;
  maxChecks?: number;
  perQuery?: number;
  log?: (m: string) => void;
}): Promise<RawSource> {
  const log = opts?.log ?? (() => {});
  const topic: SpeechTopic =
    opts?.topic ??
    (opts?.speaker ? { theme: opts.theme ?? "", speaker: opts.speaker, query: "" } : pickMotivationalTopic());
  log(`topic: "${topic.theme}" · ${topic.speaker}`);
  const queries = await resolveSourceQueries(topic.speaker, topic.theme, log);
  queries.forEach((q) => log(`  query: ${q}`));
  const candidates = dumpCandidates(queries, topic.speaker, opts?.perQuery ?? 5, log);
  log(`scored candidates: ${candidates.length}${candidates[0] ? ` (top score ${candidates[0].score})` : ""}`);
  const maxChecks = opts?.maxChecks ?? 6;
  let checked = 0;
  for (const c of candidates) {
    if (checked >= maxChecks) break;
    checked++;
    const realH = probeMaxHeight(c.url);
    c.maxHeight = realH;
    log(`check [${checked}/${maxChecks}] score=${c.score} ${realH}p ${Math.round(c.durationSec / 60)}m [${c.channel}] :: ${c.title.slice(0, 50)}`);
    if (realH < MIN_HEIGHT) {
      log(`  ↳ low-res ${realH}p (<${MIN_HEIGHT}) — skip`);
      continue;
    }
    const frames = sampleFramesSpanning(c);
    if (!frames.length) {
      log("  ↳ could not sample frames, skip");
      continue;
    }
    const ocr = ocrCaptionCheck(frames);
    if (ocr.available && ocr.captioned) {
      log(`  ↳ OCR: burned captions (${ocr.lowerBandHits}/${ocr.frames} frames) — reject (no vision call)`);
      continue;
    }
    const verdict = await visionCheckRaw(frames, topic.speaker);
    if (verdict.clean && verdict.isSpeaker) {
      log(`  ↳ CLEAN ✓ (${verdict.reason})`);
      return { ...c, topic, frames, verdict, ocr };
    }
    if (verdict.clean && !verdict.isSpeaker) {
      log(`  ↳ reject: not ${topic.speaker} on screen (${verdict.reason})`);
      continue;
    }
    log(`  ↳ reject: ${verdict.reason} (cap=${verdict.hasCaptions} ov=${verdict.hasOverlays} wm=${verdict.hasWatermark})`);
  }
  throw new Error(`no raw source found in ${checked} checks for ${topic.speaker} / ${topic.theme}`);
}
