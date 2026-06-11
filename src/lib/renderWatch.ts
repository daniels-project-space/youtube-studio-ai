/**
 * Holistic post-render review — WATCH the whole film, don't spot-check it.
 *
 * The old QA sampled 3 frames (20/50/80%) and trusted boolean flags for the title/
 * outro cards, so it was blind to the start, the end, and the timeline as a whole
 * (it passed a video with a missing title card, a mid-video outro card, a missing
 * chapter, and irrelevant inserts). This replaces that sprawl of narrow rules with
 * ONE intent-grounded reviewer: sample the FULL timeline (guaranteed first + last
 * frames), tell the model what the video is SUPPOSED to be, and let it report
 * concrete defects. Fewer rules, real watching — and reusable by any post-render check.
 */
import { grabFrame } from "@/lib/ffmpeg";
import { geminiVisionLocal, parseJsonLoose, hasGeminiKey, uploadGeminiVideo, geminiVideoUri } from "@/lib/gemini";
import { makeRunTempDir } from "@/lib/files";
import { join } from "node:path";

export type DefectSeverity = "critical" | "major" | "minor";
export interface RenderDefect {
  tSec?: number;
  severity: DefectSeverity;
  category?: string;
  issue: string;
}
export interface RenderWatchResult {
  /** false when vision was unavailable/failed — advisory, must NOT auto-fail a paid render. */
  ran: boolean;
  verdict: "pass" | "fail";
  defects: RenderDefect[];
  /** Frame paths captured — reusable by other checks (e.g. the validation-spec judge). */
  framePaths: string[];
  summary: string;
}
export interface RenderIntent {
  title: string;
  topic?: string;
  niche?: string;
  /** Override the default structural expectation. */
  expectedStructure?: string;
  expectTitleCard?: boolean;
  expectChapters?: boolean;
  /**
   * The channel's Style-DNA visual world (recurring subject/setting/motifs).
   * Without it the watcher flags ON-BRAND footage as irrelevant (it called the
   * espresso-cup brand motif "irrelevant to the finance topic").
   */
  channelWorld?: string;
}

const DEFAULT_STRUCTURE =
  "(1) an opening TITLE CARD that clearly shows the video's title text; (2) a body where on-screen footage is " +
  "relevant to the narration, with any quote/chapter overlays fully readable (never hidden behind images) and " +
  "correctly ordered/numbered; (3) a SINGLE closing OUTRO card near the very end with a sign-off. The outro must " +
  "NOT appear mid-video, and no chapter/segment may be missing or duplicated.";

/**
 * Full-timeline timestamps. CRITICAL: a title/outro card is short (~5s) and its
 * text is only visible for ~2s, so a coarse step would sample AROUND it and false-
 * flag it missing. We therefore sample the title-card window (first ~6s) and the
 * outro window (last ~5s) DENSELY, plus an even step through the middle, with a
 * guaranteed very-first and very-last frame.
 */
function sampleTimes(durationSec: number, stepSec: number, maxFrames: number): number[] {
  const first = Math.min(0.6, durationSec / 2);
  const last = Math.max(first, durationSec - 0.8);
  const dense = (from: number, to: number, n: number) =>
    Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / (n + 1));
  const titleWindow = dense(0.6, Math.min(6, durationSec * 0.4), 4); // ~1.5,2.5,3.5,4.5s
  const outroWindow = dense(Math.max(first, durationSec - 5), last, 3); // last ~5s
  const mid: number[] = [];
  for (let t = 6; t < durationSec - 5; t += stepSec) mid.push(t);
  let all = Array.from(new Set([first, ...titleWindow, ...mid, ...outroWindow, last].map((t) => Number(t.toFixed(1)))))
    .filter((t) => t >= 0 && t <= durationSec)
    .sort((a, b) => a - b);
  if (all.length > maxFrames) {
    // Thin the MIDDLE only; always keep the dense title + outro windows + endpoints.
    const headKeep = 1 + titleWindow.length;
    const tailKeep = outroWindow.length + 1;
    const head = all.slice(0, headKeep);
    const tail = all.slice(all.length - tailKeep);
    const innerN = Math.max(0, maxFrames - head.length - tail.length);
    const inner = all.slice(headKeep, all.length - tailKeep);
    const thinned = Array.from({ length: innerN }, (_, i) => inner[Math.floor((i * inner.length) / innerN)]).filter((x) => x != null);
    all = Array.from(new Set([...head, ...thinned, ...tail])).sort((a, b) => a - b);
  }
  return all;
}

export interface NativeWatchScores {
  moodMatch?: number;
  pacing?: number;
  musicFit?: number;
}

/**
 * NATIVE full-watch review — the reviewer that can HEAR. Uploads the rendered
 * video ONCE (Files API: 1fps frames + the audio track) and runs the two-pass
 * protocol the field converged on:
 *
 *   PASS 1 — BLIND index (no expectations given → no context-trap
 *   confabulation): segments with visual + audio/music mood + pacing notes,
 *   suspicious intervals, and the LAST timestamp actually seen.
 *   COVERAGE GUARD: if the model saw <92% of the real duration the pass is
 *   invalid (the silent-truncation failure mode) → caller falls back to the
 *   frame-sampling watcher.
 *   PASS 2 — COMPARE: pass-1 observations + the channel's intent (DNA world,
 *   structure, title) → concrete defects + mood/pacing/music-fit scores.
 *
 * This judges what frame sampling never could: music-vs-mood fit, cut rhythm,
 * narration energy, dead air — the "feel" dimension of staleness.
 */
export async function nativeWatchRender(
  videoPath: string,
  durationSec: number,
  intent: RenderIntent,
  opts: { log?: (m: string) => void },
): Promise<(RenderWatchResult & NativeWatchScores) | null> {
  const log = opts.log ?? (() => {});
  if (!hasGeminiKey() || durationSec < 5) return null;
  try {
    const file = await uploadGeminiVideo(videoPath);
    log(`nativeWatch: uploaded (${Math.round(durationSec)}s) — pass 1 blind index…`);

    // PASS 1 — BLIND. Deliberately given NO title/topic/expectations.
    const p1raw = await geminiVideoUri({
      ...file,
      json: true,
      maxTokens: 3000,
      temperature: 0.2,
      prompt:
        `Watch this ENTIRE video, including its AUDIO track. You know nothing about what it is supposed to be — ` +
        `report only what you actually observe.\n` +
        `Return STRICT JSON {"lastTimestampSec":number (the final moment you actually watched),` +
        `"segments":[{"startSec":number,"endSec":number,"visual":"<=20 words","audio":"<=20 words: music mood/energy, narration tone, silence","pacing":"<=10 words"}],` +
        `"suspicious":[{"startSec":number,"endSec":number,"why":"<=15 words: black/frozen frames, audio glitch, music clash, dead air, abrupt cut, unreadable text"}],` +
        `"overall":"<=60 words"}.`,
    });
    const p1 = parseJsonLoose<{
      lastTimestampSec?: number;
      segments?: { startSec?: number; endSec?: number; visual?: string; audio?: string; pacing?: string }[];
      suspicious?: { startSec?: number; endSec?: number; why?: string }[];
      overall?: string;
    }>(p1raw);
    const seen = Number(p1.lastTimestampSec ?? 0);
    if (seen < durationSec * 0.92) {
      log(`nativeWatch: COVERAGE FAIL — model saw ${seen.toFixed(0)}s of ${durationSec.toFixed(0)}s (silent truncation) — falling back to frame watcher`);
      return null;
    }
    log(`nativeWatch: pass 1 ok — ${p1.segments?.length ?? 0} segments, ${p1.suspicious?.length ?? 0} suspicious interval(s), coverage ${(100 * seen / durationSec).toFixed(0)}%`);

    // PASS 2 — COMPARE against intent (expectations only revealed now).
    const p2raw = await geminiVideoUri({
      ...file,
      json: true,
      maxTokens: 2500,
      temperature: 0.2,
      prompt:
        `You are the channel's QA director re-watching this video (you indexed it already — your notes:\n` +
        `${JSON.stringify({ segments: (p1.segments ?? []).slice(0, 30), suspicious: p1.suspicious ?? [], overall: p1.overall }).slice(0, 4500)}\n).\n\n` +
        `WHAT IT IS SUPPOSED TO BE: "${intent.title}"${intent.topic ? ` — ${intent.topic}` : ""}${intent.niche ? ` (${intent.niche})` : ""}.\n` +
        `Expected structure: ${intent.expectedStructure ?? DEFAULT_STRUCTURE}\n` +
        (intent.channelWorld ? `The channel's visual world (ON-brand, do not flag): ${intent.channelWorld}\n` : "") +
        `\nRe-examine the suspicious intervals CLOSELY (seek to them). Then judge:\n` +
        `1. defects: concrete problems a viewer would notice — {tSec, severity "critical"|"major"|"minor", category, issue}. ` +
        `critical = unwatchable/breaks trust (long black/frozen section, missing title card, garbled audio, outro mid-video). ` +
        `major = clearly wrong but watchable. Aesthetic taste = minor.\n` +
        `2. moodMatch 1-10: do visuals+music+narration tone form ONE coherent mood that fits the topic?\n` +
        `3. pacing 1-10: cut rhythm + narration speed + pause placement (penalize monotony AND chaos).\n` +
        `4. musicFit 1-10: does the score support the narration (level, energy, no clashes)?\n` +
        `Return STRICT JSON {"defects":[{"tSec","severity","category","issue"}],"moodMatch":n,"pacing":n,"musicFit":n,"summary":"<=80 words"}.`,
    });
    const p2 = parseJsonLoose<{
      defects?: { tSec?: number; severity?: string; category?: string; issue?: string }[];
      moodMatch?: number;
      pacing?: number;
      musicFit?: number;
      summary?: string;
    }>(p2raw);
    const defects: RenderDefect[] = (p2.defects ?? [])
      .filter((d) => d.issue)
      .map((d) => ({
        tSec: typeof d.tSec === "number" ? d.tSec : undefined,
        severity: (["critical", "major", "minor"].includes(String(d.severity)) ? d.severity : "minor") as DefectSeverity,
        category: d.category,
        issue: String(d.issue),
      }));
    const crit = defects.filter((d) => d.severity === "critical").length;
    log(
      `nativeWatch: verdict — ${defects.length} defect(s) (crit ${crit}) | mood ${p2.moodMatch ?? "?"}/10 | pacing ${p2.pacing ?? "?"}/10 | musicFit ${p2.musicFit ?? "?"}/10`,
    );
    return {
      ran: true,
      verdict: crit > 0 ? "fail" : "pass",
      defects,
      framePaths: [],
      summary: p2.summary ?? p1.overall ?? "",
      moodMatch: p2.moodMatch,
      pacing: p2.pacing,
      musicFit: p2.musicFit,
    };
  } catch (e) {
    log(`nativeWatch: failed (${e instanceof Error ? e.message : e}) — falling back to frame watcher`);
    return null;
  }
}

export async function watchRender(
  videoPath: string,
  durationSec: number,
  intent: RenderIntent,
  opts: { runId: string; stepSec?: number; maxFrames?: number; log?: (m: string) => void },
): Promise<RenderWatchResult> {
  const log = opts.log ?? (() => {});
  const skipped: RenderWatchResult = { ran: false, verdict: "pass", defects: [], framePaths: [], summary: "vision unavailable — skipped (advisory)" };
  if (!hasGeminiKey() || durationSec < 2) return skipped;

  const times = sampleTimes(durationSec, opts.stepSec ?? 4, opts.maxFrames ?? 60);
  const tmp = await makeRunTempDir(opts.runId);
  const framePaths: string[] = [];
  const stamps: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const f = join(tmp, `watch_${String(i).padStart(3, "0")}.jpg`);
    try { await grabFrame(videoPath, times[i], f); framePaths.push(f); stamps.push(times[i]); } catch { /* skip */ }
  }
  if (framePaths.length < 3) return { ...skipped, framePaths };

  const prompt =
    `You are a meticulous video QA reviewer WATCHING a rendered video end-to-end to catch PRODUCTION defects ` +
    `(not content opinions).\n\nINTENT:\n- Title: "${intent.title}"\n` +
    (intent.topic ? `- Topic: "${intent.topic}"\n` : "") +
    (intent.niche ? `- Niche: ${intent.niche}\n` : "") +
    (intent.channelWorld
      ? `- CHANNEL VISUAL WORLD (these recurring subjects/motifs are the channel's BRAND and are ON-TOPIC by ` +
        `design — never flag them as irrelevant): ${intent.channelWorld}\n`
      : "") +
    (intent.expectTitleCard !== false
      ? `- A title card WAS intended at the start. CONVENTION: the card deliberately shows a SHORT topic phrase, ` +
        `NOT the full SEO title — a short card title is CORRECT, only flag a BLANK/garbled card.\n`
      : "") +
    `- ENDING CONVENTION: after the outro card the video fades to black over the final ~2s — near-black FINAL ` +
    `frames are correct; judge the outro by the frames a few seconds before the end.\n` +
    (intent.expectChapters ? `- Chapter cards are used — verify they are present, readable, and numbered in order.\n` : "") +
    `EXPECTED STRUCTURE: ${intent.expectedStructure ?? DEFAULT_STRUCTURE}\n\n` +
    `The images are frames sampled IN CHRONOLOGICAL ORDER at these timestamps (seconds): ${stamps.join(", ")}. ` +
    `The FIRST frame is ~the start (title card) and the LAST is ~the end (outro card). Watch the sequence as ONE ` +
    `film and report EVERY concrete defect: missing/blank title card; outro card appearing mid-video, missing, or ` +
    `empty/textless; black/gray/frozen/empty frames; footage clearly irrelevant to the topic; the SAME clip ` +
    `repeated back-to-back; random/jarring inserts that don't belong; overlays/captions cut off, hidden behind ` +
    `images, overlapping, unreadable, or mis-timed; missing/duplicated/mis-numbered chapters; broken/abrupt ` +
    `transitions; anything unfinished or wrong.\n\n` +
    `SEVERITY: critical = breaks the video or a core structural element (missing title card, mid-video or absent ` +
    `outro, missing chapter, black screen, wrong-topic footage throughout). major = clearly wrong but localized ` +
    `(one irrelevant insert, a duplicate clip, a broken overlay). minor = cosmetic. Be specific; cite timestamps. ` +
    `Return STRICT JSON {"defects":[{"tSec":number,"severity":"critical|major|minor","category":string,"issue":string}],"summary":string}.`;

  try {
    const raw = await geminiVisionLocal({ prompt, imagePaths: framePaths, json: true, maxTokens: 3000 });
    const parsed = parseJsonLoose(raw) as { defects?: RenderDefect[]; summary?: string } | null;
    const defects = Array.isArray(parsed?.defects)
      ? parsed!.defects.filter((d): d is RenderDefect => Boolean(d && d.severity && d.issue))
      : [];
    const crit = defects.filter((d) => d.severity === "critical").length;
    const major = defects.filter((d) => d.severity === "major").length;
    // Fail on any critical, or 2+ majors — one borderline insert won't nuke a paid render.
    const verdict: "pass" | "fail" = crit >= 1 || major >= 2 ? "fail" : "pass";
    log(`watchRender: ${framePaths.length} frames → ${defects.length} defects (crit ${crit}, major ${major}) → ${verdict.toUpperCase()}`);
    return { ran: true, verdict, defects, framePaths, summary: parsed?.summary ?? "" };
  } catch (e) {
    log(`watchRender: vision failed (advisory, not blocking): ${e instanceof Error ? e.message : e}`);
    return { ...skipped, framePaths };
  }
}
