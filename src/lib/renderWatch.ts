/**
 * NATIVE full-watch render review — the reviewer that can HEAR.
 *
 * The mandatory, gating holistic visual check is `reviewRender()` in
 * `@/lib/visualReview.ts` (evidence-driven frame extraction + multimodal
 * judge); every archetype's `qa_visual` step calls it unconditionally and
 * fails closed on its verdict. `nativeWatchRender` below is a DIFFERENT,
 * deliberately advisory-only capability: it uploads the full rendered video
 * (with audio) to Gemini and judges mood/pacing/music-fit — the "feel"
 * dimension frame sampling can never see. It is opt-in (`nativeWatch` param)
 * and its findings are logged as supplementary evidence, never a second gate
 * on top of `reviewRender()`. See `nativeWatchRender`'s own docstring below.
 *
 * (The former frame-sampling `watchRender` — an earlier, coarser predecessor
 * to `reviewRender()` — was removed 2026-08 as dead code with zero callers.)
 */
import { parseJsonLoose, hasGeminiKey, uploadGeminiVideo, geminiVideoUri } from "@/lib/gemini";

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
 *
 * ADVISORY BY DESIGN — this does NOT gate a render. The mandatory, fail-closed
 * holistic check is `reviewRender()` in `@/lib/visualReview.ts`, called
 * unconditionally by every archetype's `qa_visual` step. This function is
 * opt-in (`ctx.params.nativeWatch === true`) and its verdict/defects/scores
 * are logged as supplementary evidence alongside `reviewRender()`'s result —
 * never as a second pass/fail gate. See the call site in
 * `src/trigger/blocks/narratedBlocks.ts` (search `nativeWatch`).
 */
export async function nativeWatchRender(
  videoPath: string,
  durationSec: number,
  intent: RenderIntent,
  opts: { log?: (m: string) => void },
): Promise<(RenderWatchResult & NativeWatchScores) | null> {
  const log = opts.log ?? (() => {});
  // The native (video-upload) reviewer is Gemini-only. When the operator has
  // hard-forbidden Google vision (VISION_DISABLE_GEMINI=1) — or there is no key —
  // skip straight to the provider-routed frame watcher (callers handle null).
  if (process.env.VISION_DISABLE_GEMINI === "1" || !hasGeminiKey()) {
    log(
      `nativeWatch: skipped (${process.env.VISION_DISABLE_GEMINI === "1" ? "VISION_DISABLE_GEMINI=1" : "no GEMINI_API_KEY"}) — falling back to frame watcher`,
    );
    return null;
  }
  if (durationSec < 5) return null;
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
