/**
 * FOOTAGECRAFT — the stock-footage engine as ONE standalone module (same shape
 * as banana / scriptcraft / metacraft / topicraft / voicecraft): a channel +
 * topic brief in → a covered set of vetted, on-brand 4K clips out.
 *
 * INFRA RULE: footage is NEVER written to a dev machine or the VPS — only the
 * caller's ephemeral Trigger-worker temp dir (for ffmpeg) and R2. This module
 * takes `tmpDir` (the worker scratch dir) and returns local worker paths + the
 * stable clip ids the caller persists to its R2 cross-video ledger.
 *
 * The chain one castFootage() call runs, per the brief:
 *   1. QUERIES — buildFootageQueries(): Gemini turns the topic + the ACTUAL
 *      narration + the channel's locked visual world (Style-DNA setting / grade
 *      / motifs) and avoid-list into concrete, filmable, on-brand search terms
 *      (nature-locked when the channel demands it). Topic- AND channel-aware.
 *   2. SOURCE — federated 4K search across every configured provider (footage.ts);
 *      4K-only by default, Coverr-excluded under it.
 *   3. CAST — per query, CONCURRENTLY: download the top candidate(s) (streamed
 *      to disk, bounded by a global semaphore so 4K clips never blow memory),
 *      multi-frame relevance/watermark gate (start/middle/end), judged against
 *      THIS video's theme + the channel's visual world + grade + heal hints.
 *      Queries run in a worker pool; downloads + gates share global semaphores.
 *   4. COVER — keep casting (primary → evergreen fallback → ledger-relaxed →
 *      ranked spares) until the body length is covered, deduped within the
 *      video AND across past videos via the caller's ledger.
 *
 * Deps: GEMINI_API_KEY (queries + gate) + ≥1 footage provider key. Pure of R2/
 * Convex — the caller owns persistence (ledger ids in, picked ids out).
 *
 *   import { buildFootageQueries, castFootage, hasFootagecraft } from "@/lib/footagecraft";
 *   const queries = await buildFootageQueries(brief, nQueries);
 *   const cast = await castFootage({ brief, queries, targetSec, perClipSec,
 *     usedClipIds, tmpDir, log });
 *   // cast.clips[i].path (worker temp) · .clipId (for the ledger) · .score
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { downloadTo } from "@/lib/files";
import { grabFrame } from "@/lib/ffmpeg";
import { geminiJson, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { footageDoctrineFor, type FootageDoctrine } from "@/engine/golden";
import {
  searchFootage,
  searchFootageLegacy,
  hasAnyFootageProvider,
  activeProviders,
  is4k,
  scoreClip,
  type FootageClip,
} from "@/lib/footage";

export { searchFootage, is4k, scoreClip, activeProviders, hasAnyFootageProvider, type FootageClip } from "@/lib/footage";
export { footageDoctrineFor, FOOTAGE_DOCTRINE, type FootageDoctrine } from "@/engine/golden";

export function hasFootagecraft(): boolean {
  return hasGeminiKey() && hasAnyFootageProvider();
}

/** Strict relevance floor (clearly on-theme, not loosely related). */
const RELEVANCE_MIN = 7;

/** The channel + topic context that makes the picker and gate intelligent. */
export interface FootageBrief {
  topic: string;
  niche?: string;
  /** A slice of the real narration — both query-gen and the gate judge against it. */
  narrationExcerpt?: string;
  orientation: "landscape" | "portrait";
  /** Channel Style-DNA visual world (queries must live in it; the gate enforces it). */
  visualWorld?: { setting?: string; colorGrade?: string; motifs?: string[] };
  /** Things this channel must NEVER show. */
  visualAvoid?: string[];
  /** Serene-nature lock (no people / cities / objects / interiors). */
  natureMode?: boolean;
  /** Defect hints from a prior rejected attempt — the gate gets stricter on them. */
  healHints?: string[];
  /**
   * The channel's MOTION need (footage doctrine). Calm channels reject shaky /
   * drone / fast clips; dynamic channels welcome them. Omit → resolved from the
   * niche archetype. Set `{ character: "any" }` to disable the motion gate.
   */
  motion?: FootageDoctrine & { archetype?: string };
}

/** Resolve the brief's motion doctrine (explicit → niche archetype → default). */
function motionOf(brief: FootageBrief): FootageDoctrine & { archetype?: string } {
  return brief.motion ?? footageDoctrineFor(brief.niche);
}

export interface PickedClip {
  path: string;
  query: string;
  provider: string;
  clipId: string;
  score: number;
  durationSec: number;
}

export interface FootageCast {
  clips: PickedClip[];
  coveredSec: number;
  /** Stable ids of every clip actually used (caller persists to the ledger). */
  pickedIds: string[];
  /** Diagnostics. */
  stats: { gated: number; queriesRun: number; providers: string[] };
}

/* ----------------------------- concurrency ------------------------------ */

/** Counting semaphore — bounds in-flight downloads/gates regardless of pool. */
function semaphore(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  const release = () => {
    active--;
    waiters.shift()?.();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((res) => waiters.push(res));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** Run `fn` over items with a fixed worker pool (preserves order in results). */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/* ------------------------------- queries -------------------------------- */

const NATURE_POOL = [
  "forest pathway", "misty forest morning", "sunlight through trees", "dense pine forest",
  "autumn forest path", "forest stream slow motion", "fern forest floor", "tall redwood trees",
  "foggy woodland", "bamboo forest wind", "moss covered forest", "forest canopy looking up",
  "calm ocean waves", "waves crashing slow motion", "mountain river flowing", "waterfall slow motion",
  "still lake reflection", "rain falling slow motion", "raindrops on leaves", "river over rocks",
  "ocean horizon sunset", "lake mist morning", "stream through forest", "sea foam on shore",
  "underwater sunlight rays", "gentle waterfall pool", "coastal cliffs waves",
  "mountain peak clouds", "snowy mountain range", "rolling green hills", "valley fog sunrise",
  "alpine meadow flowers", "cliff overlooking sea", "desert dunes wind", "canyon landscape",
  "rolling fields wind", "lavender field breeze", "terraced rice fields", "highland moors",
  "sunrise over mountains", "sunset clouds timelapse", "starry night sky", "milky way night",
  "storm clouds rolling", "northern lights aurora", "golden hour clouds", "moon over clouds",
  "autumn leaves falling", "snow falling slow motion", "cherry blossoms falling", "frost on branches",
  "wheat field golden hour", "wildflower meadow wind", "dew on grass macro",
  "ancient greek ruins", "weathered stone temple", "marble columns ruins", "roman ruins sunset",
  "old stone archway", "ancient amphitheater", "crumbling stone pillars", "ruins in mist",
];

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/**
 * Channel + topic aware b-roll queries: abstract topics (philosophy, finance)
 * have no literal stock — Gemini turns them into concrete, filmable terms that
 * live inside the channel's locked visual world and never touch its avoid-list.
 */
export async function buildFootageQueries(brief: FootageBrief, count: number, extra: string[] = []): Promise<string[]> {
  let queries: string[] = [];
  if (hasGeminiKey()) {
    const nicheBit = brief.niche ? ` (${brief.niche})` : "";
    const narr = brief.narrationExcerpt ? `\n\nNarration excerpt:\n"${brief.narrationExcerpt.slice(0, 900)}"\n\n` : " ";
    const naturePrompt =
      `A calm narrated video about "${brief.topic}"${nicheBit}.${narr}` +
      `Give ${count} CONCRETE, VISUALLY DISTINCT stock-footage search queries (2-4 words each) ` +
      `that are STRICTLY serene NATURE / LANDSCAPE / WATER shots — many in SLOW MOTION. ` +
      `Allowed only: forests, trees, mountains, valleys, rivers, streams, waterfalls, ocean waves, lakes, ` +
      `rain, mist/fog, clouds, sky, sunrise, sunset, fields, meadows, snow, deserts, autumn leaves — AND ` +
      `ancient Greek/Roman ruins, weathered stone temples, columns. Add "slow motion"/"cinematic" to many. ` +
      `ABSOLUTELY NO people, faces, hands, modern cities, streets, buildings, interiors, rooms, objects, ` +
      `books, candles, vehicles, or text. Vary the scenes. Return STRICT JSON {"queries":string[]}.`;
    const w = brief.visualWorld;
    const worldClause = w?.setting
      ? `THE CHANNEL'S LOCKED VISUAL WORLD (queries must clearly belong to it): setting: ${w.setting}` +
        (w.colorGrade ? `; look/grade: ${w.colorGrade}` : "") +
        (w.motifs?.length ? `; recurring motifs: ${w.motifs.slice(0, 5).join("; ")}` : "") + `.\n`
      : "";
    const avoidClause = brief.visualAvoid?.length
      ? `NEVER suggest: ${brief.visualAvoid.slice(0, 8).join("; ")}.\n`
      : `CRITICAL: never suggest scenes that CONTRADICT the message or the channel's tone.\n`;
    // MOTION doctrine — the channel's pace must be in the QUERY, not just the
    // gate (4K stock skews to drone/aerial/fast; a calm channel must steer away
    // from it at search time). Weave the desired movement in, ban the wrong one.
    const m = motionOf(brief);
    const motionClause =
      m.motion === "calm"
        ? `MOVEMENT (non-negotiable): this is a CALM, SLOW channel. Every query must imply SLOW, STEADY, ` +
          `LOCKED-OFF or gently-drifting footage — weave in terms like ${m.prefer.slice(0, 5).join(", ")}. ` +
          `NEVER suggest drone, aerial, timelapse, hyperlapse, fast, action, racing, whip-pan or shaky handheld shots.\n`
        : m.motion === "dynamic"
          ? `MOVEMENT: this is an ENERGETIC channel — favor ${m.prefer.slice(0, 4).join(", ")} footage.\n`
          : `MOVEMENT: favor steady, cinematic footage (${m.prefer.slice(0, 3).join(", ")}); avoid shaky or frenetic shots.\n`;
    const defaultPrompt =
      `A narrated video about "${brief.topic}"${nicheBit}.${narr}${worldClause}${avoidClause}${motionClause}` +
      `Give ${count} CONCRETE, filmable, VISUALLY DISTINCT stock-footage search queries (2-4 words each, ` +
      `things a camera can literally show) whose MOOD, SUBJECT and MOVEMENT match THIS narration — not generic ` +
      `decorative b-roll. Every query must connect to the video's actual themes and fit the channel's ` +
      `visual world AND its movement above. Vary scenes so no two look alike. Avoid abstract words and filler. ` +
      `Return STRICT JSON {"queries":string[]}.`;
    try {
      const out = await geminiJson<{ queries?: string[] }>({
        prompt: brief.natureMode ? naturePrompt : defaultPrompt,
        maxTokens: 500,
        temperature: 0.7,
      });
      queries = (out.queries ?? []).filter((q): q is string => typeof q === "string" && q.trim().length > 0);
    } catch {
      /* fall through to the deterministic extras below */
    }
  }
  if (brief.natureMode) queries = [...queries, ...shuffle(NATURE_POOL)];
  queries = [...queries, ...extra.filter(Boolean)];
  return queries.map((q) => q.trim()).filter((q, i, a) => q && a.indexOf(q) === i).slice(0, count);
}

/** The deterministic evergreen pool to reach coverage when fresh queries thin. */
export function evergreenQueries(natureMode?: boolean): string[] {
  return natureMode
    ? shuffle(NATURE_POOL)
    : [
        "misty mountains dawn", "calm ocean waves", "ancient stone ruins", "candle flame darkness",
        "rain on window", "sunrise clouds timelapse", "forest light fog", "starry night sky",
        "lone figure silhouette dusk", "old book pages", "stormy sea", "snowy mountain peak",
        "desert dunes wind", "waterfall slow motion", "moonlit clouds",
      ];
}

/* ------------------------------- motion --------------------------------- */

/**
 * MOTION score — a cheap, deterministic measure of how much a clip MOVES, so a
 * calm channel can reject shaky / fast / drone footage that 4K stock is full
 * of. Runs ffmpeg on a low-res proxy: tblend(difference) makes each frame the
 * delta from the previous, signalstats reads its average luma — low = static /
 * calm, high = fast pan / shake / busy. Averaged over a 40s window. Returns
 * null when ffmpeg is unavailable (the gate then skips motion, never blocks).
 */
export async function motionScore(localPath: string, log: (m: string) => void = () => {}): Promise<number | null> {
  return new Promise((resolve) => {
    const args = [
      "-i", localPath, "-t", "40",
      "-vf", "scale=128:72,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-f", "null", "-",
    ];
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); }, 25_000);
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", () => { clearTimeout(t); resolve(null); });
    c.on("close", () => {
      clearTimeout(t);
      // ffmpeg metadata=print emits "lavfi.signalstats.YAVG=2.82" (equals).
      const vals = [...err.matchAll(/YAVG[=:]\s*([0-9.]+)/g)].map((mm) => Number(mm[1])).filter((n) => !Number.isNaN(n));
      if (vals.length === 0) { log("footagecraft: motion score unavailable (no YAVG)"); resolve(null); return; }
      resolve(vals.reduce((s, v) => s + v, 0) / vals.length);
    });
  });
}

/* -------------------------------- gate ---------------------------------- */

/**
 * Multi-frame, channel + topic aware relevance gate. Samples start/middle/end
 * of ONE clip and judges them together so any bad frame (a watermark/logo
 * reveal, a burned-in caption, a hard cut to another scene, an off-theme
 * subject, or a grade clash) rejects the clip.
 */
export async function gateClip(
  localPath: string,
  durationSec: number,
  query: string,
  brief: FootageBrief,
  log: (m: string) => void = () => {},
  singleFrame = false,
): Promise<{ relevant: boolean; score: number }> {
  if (!hasGeminiKey()) return { relevant: true, score: 8 };
  const dur = durationSec || 8;
  const frames: string[] = [];
  // Legacy (old pipeline) judged ONE frame at ~1s; the new gate samples three.
  const fracs = singleFrame ? [0.08] : [0.12, 0.5, 0.82];
  for (const [i, frac] of fracs.entries()) {
    const f = `${localPath}.${i}.jpg`;
    try {
      await grabFrame(localPath, Math.max(0.5, dur * frac), f);
      frames.push(f);
    } catch {
      /* a missing frame is fine — judge on what we got */
    }
  }
  if (frames.length === 0) return { relevant: true, score: 5 };
  const w = brief.visualWorld;
  const prompt = brief.natureMode
    ? `These ${frames.length} frames are sampled across ONE candidate b-roll clip (start, middle, end). ACCEPT ` +
      `only if EVERY frame is a serene NATURE / LANDSCAPE / WATER scene (forest, trees, mountains, river, ` +
      `waterfall, ocean, lake, rain, mist, clouds, sky, sunrise/sunset, fields, snow, desert) OR ancient ` +
      `Greek/Roman stone ruins/temples/columns. REJECT anything with people, faces, figures, hands, modern ` +
      `cities, streets, buildings, interiors, rooms, objects, books, candles, vehicles, screens, or text — and ` +
      `REJECT if ANY frame shows a watermark, logo, or burned-in caption. ` +
      `Return STRICT JSON {"relevant":boolean,"score":0-10} (score = how cleanly it is pure nature/ruins).`
    : `A video about "${brief.topic}"${brief.niche ? ` (${brief.niche})` : ""}.` +
      (brief.narrationExcerpt ? ` Narration: "${brief.narrationExcerpt.slice(0, 400)}".` : "") +
      (w?.setting ? ` The channel's visual world: ${w.setting}.` : "") +
      (w?.colorGrade ? ` The channel's grade/look: ${w.colorGrade}.` : "") +
      (brief.visualAvoid?.length ? ` The channel NEVER shows: ${brief.visualAvoid.slice(0, 6).join("; ")}.` : "") +
      (brief.healHints?.length ? ` A previous attempt was REJECTED by QA for: ${brief.healHints.join("; ")} — be stricter about that.` : "") +
      (motionOf(brief).motion === "calm"
        ? ` This is a CALM, SLOW-MOVING channel: also REJECT footage that looks fast, shaky, frenetic, or like a ` +
          `sweeping drone/aerial shot — it must feel still or gently drifting.`
        : motionOf(brief).motion === "dynamic"
          ? ` This is an ENERGETIC channel: favor dynamic, lively footage.`
          : "") +
      ` These ${frames.length} frames are sampled across ONE candidate b-roll clip (start, middle, end; search ` +
      `query "${query}"). REJECT the clip if ANY frame shows a watermark, stock-site logo, or burned-in ` +
      `caption/text. Judge whether it CLEARLY fits the subject and emotional mood of THIS video AND does not ` +
      `contradict its message or the channel's visual world. CRITICALLY also judge the LIGHTING/GRADE: reject ` +
      `clips whose look clashes with the channel's grade (e.g. bright white studio/product shots in a dark, ` +
      `moody channel) even when the subject matches. Reject loosely-related, generic decorative filler, or ` +
      `anything on the never-show list. Return STRICT JSON {"relevant":boolean,"score":0-10}.`;
  try {
    const raw = await visionLocal({ prompt, imagePaths: frames, json: true, maxTokens: 200 });
    const v = parseJsonLoose<{ relevant?: boolean; score?: number }>(raw);
    return { relevant: v.relevant !== false, score: typeof v.score === "number" ? v.score : 5 };
  } catch (e) {
    // Vision failed → REJECT (accepting unseen clips is how off-topic ships).
    log(`footagecraft: gate vision failed for "${query}" — rejected: ${e instanceof Error ? e.message : e}`);
    return { relevant: false, score: 0 };
  }
}

/* ------------------------------- casting -------------------------------- */

/** Stable cross-video id: Pexels numeric video id; else the full URL. */
function clipId(url: string, provider: string): string {
  if (provider.startsWith("pexels")) return url.match(/video-files\/(\d+)/)?.[1] ?? url;
  return url;
}

export interface CastFootageArgs {
  brief: FootageBrief;
  queries: string[];
  /** Body length to cover (sec). */
  targetSec: number;
  /** Screen time credited per clip (matches the assembler's cut cadence). */
  perClipSec: number;
  /** Clip ids already used in PAST videos (caller's R2 ledger) — skipped. */
  usedClipIds: Set<string>;
  /** The Trigger-worker scratch dir (NEVER a dev box / VPS). */
  tmpDir: string;
  downloadConcurrency?: number;
  gateConcurrency?: number;
  /** Add the evergreen + ledger-relaxed fallback passes (default true). */
  fallbacks?: boolean;
  /** Emulate the OLD pipeline: Pexels-only 1080p, single-frame gate, sequential. */
  legacy?: boolean;
  log?: (m: string) => void;
}

/**
 * Cast a covered set of vetted clips. CONCURRENT: queries run in a worker pool;
 * downloads (streamed to disk) and gates each bounded by a global semaphore so
 * 4K clips overlap without exhausting memory or bandwidth. Within a query,
 * candidates escalate (download 1 → gate → next only on reject) so we never
 * pull three 4K files to use one.
 */
export async function castFootage(a: CastFootageArgs): Promise<FootageCast> {
  const log = a.log ?? (() => {});
  // Legacy emulation runs strictly sequential (concurrency 1) like the old path.
  const dl = semaphore(a.legacy ? 1 : a.downloadConcurrency ?? 6);
  const gate = semaphore(a.legacy ? 1 : a.gateConcurrency ?? 6);
  const clips: PickedClip[] = [];
  const pickedIds = new Set<string>();
  const usedUrls = new Set<string>();
  const spares: { path: string; dur: number; score: number }[] = [];
  let coveredSec = 0;
  let gated = 0;
  let dlCounter = 0;
  let queriesRun = 0;
  const mot = motionOf(a.brief);
  const motionLogged: number[] = [];

  const need = () => coveredSec < a.targetSec;

  // Cast ONE query: rank candidates, then escalate through them (download +
  // multi-frame gate) until one passes; rejects go to the spare pool.
  const castQuery = async (q: string, allowReuse: boolean): Promise<void> => {
    if (!need()) return;
    queriesRun++;
    const found = a.legacy
      ? await searchFootageLegacy(q, 8, a.brief.orientation).catch(() => [] as FootageClip[])
      : await searchFootage(q, 6, a.brief.orientation).catch(() => [] as FootageClip[]);
    const cands = found
      .filter((c) => !usedUrls.has(c.url) && !pickedIds.has(clipId(c.url, c.provider)) && (allowReuse || !a.usedClipIds.has(clipId(c.url, c.provider))))
      .sort((x, y) => scoreClip(y) - scoreClip(x))
      .slice(0, 3);
    for (const cand of cands) {
      if (!need()) return;
      const id = clipId(cand.url, cand.provider);
      if (pickedIds.has(id)) continue;
      pickedIds.add(id);
      usedUrls.add(cand.url);
      const local = join(a.tmpDir, `footage_${dlCounter++}.mp4`);
      const ok = await dl(() => downloadTo(cand.url, local).then(() => true).catch((e) => {
        log(`footagecraft: download failed (${cand.provider}) "${q}": ${e instanceof Error ? e.message : e}`);
        return false;
      }));
      if (!ok) continue;
      const verdict = await gate(() => gateClip(local, cand.durationSec, q, a.brief, log, a.legacy));
      const dur = cand.durationSec || a.perClipSec;
      if (verdict.relevant && verdict.score >= RELEVANCE_MIN) {
        // MOTION gate — only on a subject-passing clip (don't analyze rejects).
        // A shaky/fast/drone clip is wrong for a calm channel even when the
        // subject fits; reject it to the spare pool (used only if coverage
        // starves). Skipped for legacy/dynamic/any and when ffmpeg is absent.
        if (!a.legacy && mot.motion !== "dynamic") {
          const ms = await motionScore(local, log);
          if (ms !== null && ms > mot.maxMotion) {
            log(`footagecraft: motion reject "${q}" — ${ms.toFixed(1)} > ${mot.maxMotion} (${mot.motion} channel, too dynamic/shaky)`);
            spares.push({ path: local, dur, score: verdict.score });
            continue;
          }
          if (ms !== null) motionLogged.push(ms);
        }
        clips.push({ path: local, query: q, provider: cand.provider, clipId: id, score: verdict.score, durationSec: dur });
        coveredSec += Math.min(dur, a.perClipSec);
        gated++;
        return;
      }
      spares.push({ path: local, dur, score: verdict.score });
    }
  };

  if (!hasAnyFootageProvider()) throw new Error("footagecraft: no footage provider configured");
  log(
    a.legacy
      ? `footagecraft: LEGACY mode (Pexels 1080p · single-frame gate · sequential) — ${a.queries.length} queries → target ${a.targetSec.toFixed(0)}s`
      : `footagecraft: casting ${a.queries.length} queries across [${activeProviders().join(", ")}] (4K-only, concurrent, motion=${mot.motion} ≤${mot.maxMotion}) → target ${a.targetSec.toFixed(0)}s`,
  );

  // Primary pass — queries in a worker pool; downloads/gates share semaphores.
  await mapPool(a.queries, 8, (q) => castQuery(q, false));

  if (a.fallbacks !== false && need()) {
    log(`footagecraft: ${coveredSec.toFixed(0)}/${a.targetSec.toFixed(0)}s after primary → evergreen fallback`);
    await mapPool(evergreenQueries(a.brief.natureMode), 8, (q) => castQuery(q, false));
  }
  if (a.fallbacks !== false && need()) {
    log(`footagecraft: ${coveredSec.toFixed(0)}/${a.targetSec.toFixed(0)}s → relaxing cross-video dedup`);
    await mapPool([...a.queries, ...evergreenQueries(a.brief.natureMode)], 8, (q) => castQuery(q, true));
  }
  // Last resort: best-scored rejected spares (rare; keeps a video from looping).
  if (need() && spares.length) {
    spares.sort((x, y) => y.score - x.score);
    const used = new Set(clips.map((c) => c.path));
    for (const s of spares) {
      if (!need()) break;
      if (used.has(s.path)) continue;
      clips.push({ path: s.path, query: "(spare)", provider: "spare", clipId: s.path, score: s.score, durationSec: s.dur });
      coveredSec += Math.min(s.dur, a.perClipSec);
    }
    log(`footagecraft: last-resort spare fill → ${coveredSec.toFixed(0)}s`);
  }

  const motAvg = motionLogged.length ? (motionLogged.reduce((s, v) => s + v, 0) / motionLogged.length).toFixed(1) : "n/a";
  log(`footagecraft: ${clips.length} clips covering ~${coveredSec.toFixed(0)}/${a.targetSec.toFixed(0)}s (${gated} passed the gate, ${queriesRun} queries run, avg motion ${motAvg}/${mot.maxMotion})`);
  return {
    clips,
    coveredSec,
    pickedIds: clips.map((c) => c.clipId).filter((id) => id && id !== "(spare)"),
    stats: { gated, queriesRun, providers: activeProviders() },
  };
}
