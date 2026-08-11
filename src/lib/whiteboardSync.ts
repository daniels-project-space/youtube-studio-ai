/**
 * WHITEBOARDSYNC — the NARRATION-SYNCED whiteboard-scribe engine as ONE
 * standalone module (sibling to whiteboardcraft / documotion / footagecraft):
 * a topic in → a finished whiteboard explainer where a hand DRAWS each beat in
 * time with the narration, out. VISUAL+VOICE CRAFT for explainer content.
 *
 * The deterministic "write-on" reveal costs ZERO render credits (no video model):
 * it traces the real ink of each layer and reveals it under a moving hand. The
 * only spend is the per-layer Nano-Banana art (Gemini) + Fish TTS.
 *
 * Pipeline (one castWhiteboardSync() call):
 *   1. STORYBOARD — Gemini-Pro designs the topic as PANELS, each a STACK OF
 *      LAYERS: composed art SCENES (style-locked, NO baked text) + label layers
 *      (dates/figures/terms). Every layer carries a verbatim narration CUE + box.
 *   2. ART — each art layer renders as isolated line-art on pure white (no
 *      segmentation: each layer's pixels are exactly known → reliable timing).
 *   3. NARRATION — Fish TTS speaks the script; LOCAL Whisper force-aligns it to
 *      word timestamps; each cue → a millisecond start time.
 *   4. RENDER — scripts/wb_scribe_sync.py draws each layer at its cue, ONE hand
 *      at a time, paced to ink, with a minimum draw time + a guaranteed HOLD
 *      before each panel cuts; a persistent frame + topic header are drawn once;
 *      ffmpeg muxes the narration.
 *
 * Deps: GEMINI_API_KEY (storyboard + art), FISH_AUDIO_API_KEY (TTS), and python3
 * with faster-whisper + numpy/scipy/scikit-image/Pillow (the renderer + aligner).
 * A $0-spend preflight (src/lib/pydeps.ts) verifies python3 + the scripts +
 * pip deps BEFORE any paid generation, so a broken worker fails immediately.
 * Pure of R2/Convex — the caller owns `runDir` and persistence.
 *
 *   import { castWhiteboardSync, hasWhiteboardSync } from "@/lib/whiteboardSync";
 *   const { outPath } = await castWhiteboardSync({
 *     brief: { topic: "Why Chiquita is the 'banana republic' company", facts, header: "CHIQUITA" },
 *     runDir, log,
 *   });
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { geminiJsonPro } from "@/lib/gemini";
import { synthNarration } from "@/lib/tts";
import { preflightPythonRenderer } from "@/lib/pydeps";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";

type Logger = (msg: string) => void;

export interface WhiteboardSyncBrief {
  topic: string;
  /** Grounding facts the narration must stay accurate to (strongly recommended). */
  facts?: string;
  /** Explicit beat list (one per panel). Omit to let the model structure it. */
  beats?: string[];
  /** Persistent top header text (default: derived from the topic). */
  header?: string;
  /** Whiteboard style-lock ref id (src/assets/whiteboard/<id>_ref.png). Default "history". */
  styleId?: string;
  /** Channel Style-DNA rendering language, used as a text-native style lock. */
  artStyle?: string;
  /** Fish voice id (default "sleepless_historian") — used when provider is Fish. */
  voiceId?: string;
  /** TTS engine: "fish" (default) | "elevenlabs". Lets a cast ElevenLabs voice narrate. */
  ttsProvider?: string;
  /** ElevenLabs voice id (when ttsProvider === "elevenlabs"). */
  elevenVoiceId?: string;
  /**
   * Board surface: "white" (cream whiteboard, default) or "chalk" (dark
   * chalkboard — dark-academic channels whose DNA demands chalk-on-dark). Chalk
   * mode inverts the board to `palette[0]` and draws the same line-art in a
   * light chalk ink instead of black marker.
   */
  boardMode?: "white" | "chalk";
  /** Channel palette [bg, ink/light, accent, …] — drives chalk-mode colors. */
  palette?: string[];
  /** Panel count (default 6) and total spoken words (default 150). */
  panels?: number;
  targetWords?: number;
  /** Render resolution (default 1920x1080). Art is generated at 2K, so 2560x1440 stays crisp. */
  width?: number;
  height?: number;
}

export interface SyncLayer { kind: "art" | "label"; art?: string; text?: string; color?: string; box: number[]; cueStartMs: number }
export interface SyncPanel { idx: number; startMs: number; endMs: number; layers: SyncLayer[] }
export interface WhiteboardSyncResult {
  outPath: string;
  timelinePath: string;
  title: string;
  narrationText: string;
  panels: SyncPanel[];
  durationMs: number;
  /** Characters sent to TTS during this invocation (zero when the cache hit). */
  ttsCharactersGenerated: number;
}

export interface WhiteboardArtRequest {
  id: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
}

export type WhiteboardImageGenerator = (request: WhiteboardArtRequest) => Promise<Buffer>;

export const WHITEBOARD_MAX_PANELS = 16;
export const WHITEBOARD_MAX_ART_IMAGES_PER_PANEL = 5;
export const WHITEBOARD_MAX_WORDS_PER_PANEL = 120;
export const WHITEBOARD_MAX_CHARS_PER_WORD = 12;
export const WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES = 3;

export function whiteboardPanelCount(value: unknown): number {
  const parsed = Number(value ?? 6);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(WHITEBOARD_MAX_PANELS, Math.floor(parsed)))
    : 6;
}

export function whiteboardImageCallCeiling(panelCount: unknown): number {
  return whiteboardPanelCount(panelCount) * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL;
}

export function whiteboardNarrationCharacterCeiling(panelCount: unknown, targetWords: unknown): number {
  const panels = whiteboardPanelCount(panelCount);
  const parsedWords = Number(targetWords ?? 150);
  const requestedWords = Number.isFinite(parsedWords) && parsedWords > 0 ? Math.ceil(parsedWords) : 150;
  const boundedWords = Math.max(
    panels * 8,
    Math.min(panels * WHITEBOARD_MAX_WORDS_PER_PANEL, requestedWords),
  );
  return boundedWords * WHITEBOARD_MAX_CHARS_PER_WORD;
}

export function whiteboardTtsBillableCharacterCeiling(
  panelCount: unknown,
  targetWords: unknown,
): number {
  return (
    whiteboardNarrationCharacterCeiling(panelCount, targetWords)
  );
}

export function whiteboardTtsProviderCallCeiling(): number {
  return WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES;
}

const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");

export function hasWhiteboardSync(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY
    && process.env.FISH_AUDIO_API_KEY
    && hasNovitaRenderFarmConfig(),
  );
}

/* ------------------------------ helpers -------------------------------- */

function clampBox(b: unknown): number[] {
  return Array.isArray(b) && b.length === 4 ? b.map(Number) : [0.1, 0.18, 0.8, 0.66];
}

function whiteboardSeed(styleId: string, artifactId: string): number {
  return createHash("sha256")
    .update(`whiteboard-v2\0${styleId}\0${artifactId}`)
    .digest()
    .readUInt32BE(0) & 0x7fffffff;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function runPy(args: string[], log: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    c.stdout.on("data", (d) => log(`py: ${d.toString().trim()}`));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`python ${args[0]} exited ${code}: ${err.slice(-400)}`))));
  });
}

/* ------------------------------ storyboard ----------------------------- */

interface RawLayer { kind?: string; draw?: string; text?: string; color?: string; cue?: string; box?: unknown }
interface RawPanel { narration?: string; layers?: RawLayer[] }
interface RawPlan { title?: string; panels?: RawPanel[] }
interface NLayer { kind: "art" | "label"; draw?: string; text?: string; color: string; cue: string; box: number[]; art?: string }
interface NPanel { idx: number; narration: string; layers: NLayer[] }

/**
 * THE PLAN/RENDER SEAM (pattern: documotion's `CraftDocuArgs.plan`).
 *
 * Everything in this storyboard section is CHEAP and text-only. Everything the
 * orchestrator does with the result below — per-layer Nano-Banana art, TTS,
 * the python scribe render — is PAID and irreversible.
 *
 * Exporting the storyboard as a first-class value is what lets a caller run a
 * produce→critique→regenerate loop at TEXT prices and then hand the ACCEPTED
 * plan to `castWhiteboardSync`, which renders it exactly once. Without this
 * seam the only way to get quality feedback was to critique a finished video,
 * i.e. to re-buy the whole render to fix one bad panel.
 */
export interface WhiteboardStoryboard {
  title: string;
  panels: NPanel[];
  /** Concatenated panel narration — the exact text that will be sent to TTS. */
  fullText: string;
}
export type WhiteboardStoryboardPanel = NPanel;
export type WhiteboardStoryboardLayer = NLayer;

function planContract(brief: WhiteboardSyncBrief, nPanels: number, words: number): string {
  const facts = brief.facts ? `GROUNDING FACTS (accurate, use only these):\n${brief.facts}\n\n` : "";
  const beats = brief.beats?.length
    ? `\nEXACTLY one panel per beat below — DO NOT STOP EARLY:\n${brief.beats.map((b, i) => `  P${i + 1}: ${b}`).join("\n")}`
    : "";
  return (
    `Design a punchy, INFORMATIVE ~60-second WHITEBOARD explainer. TOPIC: ${brief.topic}\n${facts}` +
    `Think like a motion-designer. Each panel is a STACK OF LAYERS drawn one at a time on a whiteboard, building an argument.\n` +
    `Output STRICT JSON: {"title":"...","panels":[ {"narration":"<~2 spoken sentences (~${Math.round(words / nPanels)} words), end with a small beat>",` +
    `"layers":[ {"kind":"art","draw":"<EITHER the panel's larger composed SCENE (its main objects AND how they relate) OR a small iconic sketch of one concrete thing the narration names. NO text/words in the art.>",` +
    `"cue":"<verbatim phrase from THIS narration marking when to draw it>","box":[x,y,w,h]} , ` +
    `{"kind":"label","text":"<EXACT short words/number to hand-letter>","cue":"<verbatim phrase>","box":[x,y,w,h],"color":"black|red"} ]} ]}\n\n` +
    `RULES:\n- Output STRICTLY VALID minified JSON: double-quote every key and string, no comments, no trailing commas, escape any quotes inside strings.\n` +
    `- EXACTLY ${nPanels} panels. ~${words} words TOTAL. Plain spoken narration, NO audio tags. Never stop early.\n` +
    `- MIX OF SCALES (important): each panel has ONE larger composed SCENE — the hero visual for the beat (its main objects AND how they relate, designed and informative) — PLUS 2-4 SMALLER keyword sketches for other concrete things the narration names, each cued to its exact word and spread around the hero so the board keeps FILLING as the voice speaks (never leave it static). For a list ("railroads, government, taxes") make a separate small sketch for EACH item, cued to its word. Add label layers for dates + numbers. List layers IN THE ORDER their cue appears; every label needs non-empty "text".\n` +
    `- Every "cue" MUST be an exact substring of that panel's narration. Don't put the last cue at the very end (leave a trailing clause).\n` +
    `- A persistent TITLE HEADER lives in the top strip: ALL boxes (art + labels) MUST have y >= 0.17 (nothing in the top 0.16).\n` +
    `- box=[x,y,w,h] in 0..1 on a 16:9 board. The hero SCENE is LARGER (w ~ 0.34-0.52, center/left); the keyword SKETCHES are SMALL (w,h ~ 0.13-0.24) spread around it (vary x AND y) so they accumulate WITHOUT overlapping the scene. Labels smaller, beside the thing they name. y >= 0.17 for everything.\n` +
    `- ART HAS NO TEXT — all words/numbers are label layers. color:"red" for money/danger emphasis, else black. Be accurate.${beats}`
  );
}

function normalize(raw: RawPlan): NPanel[] {
  return (raw.panels ?? []).map((p, i) => {
    let artCount = 0;
    const layers = (p.layers ?? [])
      .map((l) => ({
        kind: l.kind === "label" ? ("label" as const) : ("art" as const),
        draw: l.draw ? String(l.draw).trim() : undefined,
        text: l.text ? String(l.text).trim() : undefined,
        color: l.color === "red" ? "red" : "black",
        cue: String(l.cue ?? "").trim(),
        box: clampBox(l.box),
      }))
      .filter((l) => (l.kind === "art" && l.draw) || (l.kind === "label" && l.text))
      // The prompt asks for one hero + 2–4 keyword sketches. A model that
      // over-returns must not create an unbounded paid image fan-out.
      .filter((l) => {
        if (l.kind !== "art") return true;
        if (artCount >= WHITEBOARD_MAX_ART_IMAGES_PER_PANEL) return false;
        artCount += 1;
        return true;
      });
    return { idx: i, narration: String(p.narration ?? "").trim(), layers };
  });
}

function boundNarration(panels: NPanel[], targetWords: unknown): NPanel[] {
  if (!panels.length) return panels;
  const charCeiling = whiteboardNarrationCharacterCeiling(panels.length, targetWords);
  const totalWordBudget = Math.floor(charCeiling / WHITEBOARD_MAX_CHARS_PER_WORD);
  const baseWords = Math.floor(totalWordBudget / panels.length);
  const remainder = totalWordBudget % panels.length;

  return panels.map((panel, index) => {
    const wordBudget = baseWords + (index < remainder ? 1 : 0);
    const words = panel.narration.split(/\s+/).filter(Boolean).slice(0, wordBudget);
    const rawNarration = words.join(" ");
    const charBudget = wordBudget * WHITEBOARD_MAX_CHARS_PER_WORD;
    const narration = rawNarration.length <= charBudget
      ? rawNarration
      : rawNarration.slice(0, charBudget).replace(/\s+\S*$/, "").trim();
    const lowerNarration = narration.toLowerCase();
    const layers = panel.layers.filter((layer) =>
      !layer.cue || lowerNarration.includes(layer.cue.toLowerCase()),
    );
    return { ...panel, narration, layers };
  });
}

/**
 * A rejected storyboard's issues, folded back into the writer's prompt. Empty
 * notes render "" so an un-critiqued call sends the byte-identical old prompt.
 */
function revisionClause(revisionNotes: readonly string[]): string {
  const notes = revisionNotes.map((note) => String(note ?? "").trim()).filter(Boolean).slice(0, 8);
  if (!notes.length) return "";
  return (
    `\n\nREVISION — a director REJECTED your previous storyboard before any art or voice was bought. ` +
    `Rewrite it so that EVERY issue below is fixed; do not repeat the rejected draft:\n` +
    notes.map((note, index) => `${index + 1}. ${note}`).join("\n")
  );
}

/** Generate ONE chunk of panels (retry on short/invalid output). */
async function genChunk(brief: WhiteboardSyncBrief, beats: string[], nP: number, words: number, cont: string, log: Logger, revisionNotes: readonly string[] = []): Promise<{ title: string; panels: NPanel[] }> {
  const sub: WhiteboardSyncBrief = { ...brief, beats, panels: nP, targetWords: words };
  for (let attempt = 0; attempt < 3; attempt++) {
    const extra =
      (cont ? `\n\nThis is PART of a longer video already in progress; the previous panel's narration ended: "${cont.slice(-160)}". Continue naturally — do NOT repeat the intro or title.` : "") +
      revisionClause(revisionNotes) +
      (attempt ? `\n\nFIX: output EXACTLY ${nP} panels as STRICTLY VALID minified JSON.` : "");
    try {
      const raw = await geminiJsonPro<RawPlan>({ prompt: planContract(sub, nP, words) + extra, maxTokens: 14000, temperature: 0.5 });
      const panels = normalize(raw).slice(0, nP);
      if (panels.length >= nP) return { title: String(raw.title ?? brief.topic), panels };
      log(`  chunk got ${panels.length}/${nP} panels — retry`);
      if (attempt === 2 && panels.length) return { title: String(raw.title ?? brief.topic), panels };
    } catch (e) {
      log(`  chunk failed (${(e instanceof Error ? e.message : String(e)).slice(0, 90)}) — retry`);
    }
  }
  return { title: brief.topic, panels: [] };
}

async function buildStoryboard(brief: WhiteboardSyncBrief, log: Logger, revisionNotes: readonly string[] = []): Promise<WhiteboardStoryboard> {
  const nPanels = whiteboardPanelCount(brief.panels);
  const words = brief.targetWords ?? 150;
  const beats = (brief.beats ?? []).slice(0, nPanels);
  const CHUNK = 4;
  let title = brief.topic;
  const all: NPanel[] = [];
  if (beats.length > 6) {
    // CHUNKED: one LLM call can't reliably emit many dense panels — build in groups.
    for (let i = 0; i < beats.length; i += CHUNK) {
      const grp = beats.slice(i, i + CHUNK);
      const cont = all.length ? all[all.length - 1].narration : "";
      const { title: t, panels } = await genChunk(brief, grp, grp.length, Math.round((words * grp.length) / beats.length), cont, log, revisionNotes);
      if (i === 0 && t) title = t;
      all.push(...panels);
      log(`storyboard chunk ${Math.floor(i / CHUNK) + 1}: +${panels.length} panels (total ${all.length})`);
    }
  } else {
    const { title: t, panels } = await genChunk(brief, beats, nPanels, words, "", log, revisionNotes);
    if (t) title = t;
    all.push(...panels);
    log(`storyboard: ${all.length} panels, ${all.reduce((n, p) => n + p.layers.length, 0)} layers`);
  }
  const bounded = boundNarration(all.slice(0, nPanels), brief.targetWords);
  bounded.forEach((p, i) => (p.idx = i));
  if (!bounded.length) throw new Error("whiteboardSync: storyboard produced no panels");
  return { title, panels: bounded, fullText: bounded.map((p) => p.narration).join(" ") };
}

/**
 * Write the storyboard and NOTHING else — the CHEAP half of the engine.
 *
 * This makes ONLY Gemini text calls: no image generator is touched, no TTS
 * provider is called, no python renderer runs. It is therefore safe to call
 * repeatedly inside a produce→critique→regenerate loop; the resulting ACCEPTED
 * storyboard is then passed to `castWhiteboardSync({ plan })`, which spends
 * once. `revisionNotes` are a critic's prior issues; omit them and the prompt
 * is byte-identical to the storyboard `castWhiteboardSync` writes for itself.
 */
export async function planWhiteboardStoryboard(
  brief: WhiteboardSyncBrief,
  log: Logger = () => {},
  revisionNotes: readonly string[] = [],
): Promise<WhiteboardStoryboard> {
  if (!process.env.GEMINI_API_KEY) throw new Error("whiteboardSync: GEMINI_API_KEY missing");
  return buildStoryboard(brief, log, revisionNotes);
}

/* ------------------------------ timing --------------------------------- */

function alignCues(panels: NPanel[], fullText: string, words: { text: string; start: number; end: number }[], log: Logger = () => {}): { audioEnd: number } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const eq = (a: string, b: string) => Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  const mw = fullText.split(/\s+/).map(norm);
  const wn = words.map((w) => norm(w.text));
  const mwTime: (number | null)[] = new Array(mw.length).fill(null);
  let j = 0;
  for (let i = 0; i < mw.length; i++) for (let k = j; k < Math.min(j + 6, words.length); k++) if (eq(mw[i], wn[k])) { mwTime[i] = words[k].start; j = k + 1; break; }
  const known = mwTime.map((t, i) => ({ t, i })).filter((x) => x.t != null) as { t: number; i: number }[];
  for (let i = 0; i < mw.length; i++) {
    if (mwTime[i] != null) continue;
    const prev = [...known].reverse().find((x) => x.i < i), next = known.find((x) => x.i > i);
    mwTime[i] = prev && next ? prev.t + (next.t - prev.t) * ((i - prev.i) / (next.i - prev.i)) : (prev || next || { t: 0 }).t;
  }
  const audioEnd = words.length ? words[words.length - 1].end : 60000;
  // WINDOW MATCHER — the old greedy FIRST-word match desynced on any repeated
  // common word ("the", "a"): the pointer ran away, every later cue fell to the
  // +700ms stack, later panel windows collapsed, and the render FROZE on the
  // last drawn layer for the rest of the audio (seen live: 48% of a probe was
  // a static hold). Require 2 of the cue's first 3 words to match in sequence.
  let mp = 0;
  const cueTime = (cue: string): number | null => {
    const cw = cue.split(/\s+/).map(norm).filter(Boolean).slice(0, 3);
    if (!cw.length) return null;
    for (let i = mp; i < mw.length; i++) {
      let hits = 0;
      for (let k = 0; k < cw.length && i + k < mw.length; k++) if (eq(mw[i + k], cw[k])) hits++;
      if (hits >= Math.min(2, cw.length)) { mp = i + 1; return Math.round(mwTime[i] as number); }
    }
    return null;
  };
  let last = 0;
  let misses = 0;
  let totalCues = 0;
  for (const p of panels)
    for (const l of p.layers as (NLayer & { cueStartMs?: number })[]) {
      totalCues++;
      const t = cueTime(l.cue);
      if (t == null) misses++;
      l.cueStartMs = t != null ? t : last + 700;
      if (l.cueStartMs < last) l.cueStartMs = last + 250;
      last = l.cueStartMs;
    }
  // DETERMINISTIC BACKSTOP: if matching still degraded (many misses, or the
  // final panel starts in the last 8% of the audio), redistribute panel
  // windows proportionally to each panel's narration word count and space the
  // layers evenly inside. Slightly less word-exact, but it CANNOT freeze.
  const lastPanelFirst = Number((panels[panels.length - 1]?.layers[0] as (NLayer & { cueStartMs?: number }) | undefined)?.cueStartMs ?? 0);
  if (totalCues > 0 && (misses / totalCues > 0.3 || (panels.length > 1 && lastPanelFirst > audioEnd * 0.92))) {
    log(`alignCues: DEGRADED matching (${misses}/${totalCues} misses, last panel @${Math.round(lastPanelFirst / 1000)}s of ${Math.round(audioEnd / 1000)}s) — proportional redistribution`);
    const wordsPer = panels.map((p) => p.narration.split(/\s+/).filter(Boolean).length || 1);
    const totWords = wordsPer.reduce((a, b) => a + b, 0);
    let cum = 0;
    for (let i = 0; i < panels.length; i++) {
      const start = (cum / totWords) * audioEnd;
      cum += wordsPer[i];
      const end = (cum / totWords) * audioEnd;
      const ls = panels[i].layers as (NLayer & { cueStartMs?: number })[];
      ls.forEach((l, k) => {
        l.cueStartMs = Math.round(start + ((end - start) * k) / Math.max(1, ls.length + 1));
      });
    }
  }
  return { audioEnd };
}

/* ------------------------------ orchestrator --------------------------- */

export async function castWhiteboardSync(args: {
  brief: WhiteboardSyncBrief;
  runDir: string;
  outPath?: string;
  generateImage: WhiteboardImageGenerator;
  log?: Logger;
  /**
   * A caller-approved storyboard from `planWhiteboardStoryboard` (typically the
   * winner of a produce→critique loop). When supplied the engine does ZERO
   * planning calls and renders exactly this plan; omit it and the engine plans
   * for itself exactly as it always has.
   */
  plan?: WhiteboardStoryboard;
}): Promise<WhiteboardSyncResult> {
  const log = args.log ?? (() => {});
  const brief = args.brief;
  const requestedPanels = whiteboardPanelCount(brief.panels);
  if (!process.env.GEMINI_API_KEY) throw new Error("whiteboardSync: GEMINI_API_KEY missing");
  if (!process.env.FISH_AUDIO_API_KEY) throw new Error("whiteboardSync: FISH_AUDIO_API_KEY missing");
  if (typeof args.generateImage !== "function") {
    throw new Error("whiteboardSync: an explicit attested image generator is required");
  }
  // $0-spend gate: verify python3 + the baked renderer/aligner scripts + pip
  // deps BEFORE the storyboard/art/TTS spend. The render is the LAST step —
  // without this, a worker missing the scripts burned the whole budget first.
  await preflightPythonRenderer({
    scripts: [join("scripts", "wb_scribe_sync.py"), join("scripts", "whisper_align.py")],
    packages: ["numpy", "pillow", "scikit-image", "scipy", "faster-whisper"],
    marker: ".ysa_wb_pydeps_ready",
    log,
  });
  await mkdir(args.runDir, { recursive: true });

  // 1. storyboard — SUPPLIED (already critiqued) → cached → planned here.
  const planPath = join(args.runDir, "plan.json");
  let title: string, panels: NPanel[], fullText: string;
  if (args.plan) {
    // Deep clone: the render mutates panel layers in place (`l.art`, cue
    // timings), and the caller keeps this object for its frozen checkpoint.
    ({ title, panels, fullText } = JSON.parse(JSON.stringify(args.plan)) as WhiteboardStoryboard);
    const serialized = JSON.stringify({ title, panels, fullText }, null, 2);
    // This engine's art cache is INDEX-keyed (art_<panel>_<layer>.png), so art
    // bought for a different storyboard would be silently reused for the wrong
    // layer. A resume that supplies the same frozen plan hits the equal branch
    // and re-buys nothing; only a genuinely different plan drops the art.
    const onDisk = existsSync(planPath) ? await readFile(planPath, "utf8") : null;
    if (onDisk !== null && onDisk !== serialized) {
      const stale = (await readdir(args.runDir)).filter((name) =>
        /^(?:art_\d+_\d+\.png|narration\.mp3|wwords\.json)$/.test(name),
      );
      await Promise.all(stale.map((name) => unlink(join(args.runDir, name)).catch(() => {})));
      log(`storyboard: supplied plan differs from this runDir's cached plan — dropped ${stale.length} index-keyed art/audio cache file(s)`);
    }
    await writeFile(planPath, serialized, "utf8");
    log(`storyboard: using the supplied approved plan (${panels.length} panels) — zero planning calls`);
  } else if (existsSync(planPath)) {
    ({ title, panels, fullText } = JSON.parse(await readFile(planPath, "utf8")) as WhiteboardStoryboard);
    log(`storyboard: loaded cached plan (${panels.length} panels)`);
  } else {
    ({ title, panels, fullText } = await buildStoryboard(brief, log));
    await writeFile(planPath, JSON.stringify({ title, panels, fullText }, null, 2), "utf8");
  }
  // Old cached plans and model output both pass through the same spend bound.
  // Rebuild the narration from the accepted panels so discarded over-returned
  // panels cannot still incur TTS or appear in downstream metadata.
  const boundedPanels = boundNarration(panels.slice(0, requestedPanels), brief.targetWords);
  const boundedFullText = boundedPanels.map((panel) => panel.narration).join(" ");
  const cachedNarrationChanged =
    boundedPanels.length !== panels.length || boundedFullText !== fullText;
  panels = boundedPanels;
  panels.forEach((panel, index) => { panel.idx = index; });
  fullText = boundedFullText;
  if (cachedNarrationChanged) {
    await writeFile(planPath, JSON.stringify({ title, panels, fullText }, null, 2), "utf8");
  }

  // 2. art layers (text-native style lock, no hidden img2img/provider route).
  // Every request repeats one canonical channel style clause and a stable seed;
  // this is cheaper and more deterministic than re-uploading a generated image
  // as a paid input on every panel.
  const styleId = brief.styleId?.trim() || "history";
  const styleLock = brief.artStyle?.trim()
    ? `CHANNEL STYLE-DNA (${styleId}): ${brief.artStyle.trim()}`
    : `CHANNEL STYLE (${styleId}): clean editorial black-marker line art, bold simple silhouettes, uniform stroke weight, sparse red accents`;
  const artJobs: { p: NPanel; l: NLayer }[] = [];
  for (const p of panels) for (const l of p.layers) if (l.kind === "art") artJobs.push({ p, l });
  const isSceneJob = (j: { l: NLayer }) => Number(j.l.box?.[2] ?? 0) >= 0.32;
  const renderArt = async ({ p, l }: { p: NPanel; l: NLayer }) => {
    const fn = `art_${p.idx}_${p.layers.indexOf(l)}.png`;
    const out = join(args.runDir, fn);
    if (existsSync(out)) { l.art = fn; return; }            // cached (resumable)
    const isScene = isSceneJob({ l });
    const prompt =
      `A whiteboard marker line-art ${isScene ? "SCENE" : "SKETCH"} on a PURE WHITE (#ffffff) background, nothing else, filling the frame with a small margin. ` +
      `${styleLock}. CRITICAL: use this exact style and one consistent stroke weight throughout every asset. ` +
      (isScene
        ? `Draw a COMPOSED, designed scene: ${l.draw} — show the objects AND how they relate, clear and informative. `
        : `Draw a single bold iconic sketch of: ${l.draw}, instantly readable. `) +
      `(Context for tone, do NOT write any text: "${p.narration}".) Simple line-art, NOT photorealistic, no shading. ` +
      `Use red for at most one or two accent marks. ` +
      `STRICTLY NO text of any kind: no words, no letters, no numbers, no labels, no captions, no signage, no book titles, no logos, no watermarks, no handwriting, no gibberish glyphs. Leave every sign, book, screen, banner and label BLANK. ` +
      `NO whiteboard, NO frame, NO border, NO grey edges — pure white #ffffff background ONLY.`;
    let image: Buffer;
    try {
      image = await args.generateImage({
        id: fn.replace(/\.png$/i, ""),
        prompt,
        negativePrompt: "text, letters, numbers, labels, logos, watermark, frame, border, grey background, photorealism, shading",
        seed: whiteboardSeed(styleId, fn),
      });
    } catch (e) {
      if (e && typeof e === "object" && (e as { retryable?: unknown }).retryable === false) throw e;
      log(`art ${fn} skipped (${(e instanceof Error ? e.message : String(e)).slice(0, 70)})`); // 1 bad gen must not kill the run
      return;
    }
    // Local cache I/O is outside the provider catch. A successful paid render
    // must never be repurchased because its subsequent disk write failed.
    await writeFile(out, image);
    l.art = fn;
    log(`art ${fn} ✓`);
  };
  await pool(artJobs, 3, renderArt);

  // 3. narration + alignment (cached → resumable)
  const mp3Path = join(args.runDir, "narration.mp3");
  const wpath = join(args.runDir, "wwords.json");
  if (cachedNarrationChanged) {
    await Promise.all([unlink(mp3Path).catch(() => {}), unlink(wpath).catch(() => {})]);
    log("storyboard: bounded cached plan changed narration — invalidated stale TTS/alignment cache");
  }
  let ttsCharactersGenerated = 0;
  if (!existsSync(mp3Path)) {
    // Honor a cast ElevenLabs voice when the channel was cast one; else Fish.
    // (The cast winner used to be dropped here — every scribe spoke the Fish
    // default no matter the channel's audition result.)
    const useEleven = brief.ttsProvider === "elevenlabs" && !!brief.elevenVoiceId;
    log(useEleven ? `TTS (ElevenLabs ${brief.elevenVoiceId})…` : "TTS (Fish)…");
    const mp3 = await synthNarration(
      useEleven
        ? {
            text: fullText,
            provider: "elevenlabs",
            elevenVoiceId: brief.elevenVoiceId,
            onBillableCharacters: (characters: number) => { ttsCharactersGenerated += characters; },
          }
        : {
            text: fullText,
            voiceId: brief.voiceId ?? "sleepless_historian",
            speed: 0.95,
            onBillableCharacters: (characters: number) => { ttsCharactersGenerated += characters; },
          },
    );
    await writeFile(mp3Path, Buffer.from(mp3));
  } else log("TTS cached");
  if (!existsSync(wpath)) {
    log("aligning (Whisper)…");
    await runPy([join("scripts", "whisper_align.py"), mp3Path, wpath], log);
  } else log("alignment cached");
  const words = JSON.parse(await readFile(wpath, "utf8")) as { text: string; start: number; end: number }[];
  const { audioEnd } = alignCues(panels, fullText, words, log);

  // 4. timeline
  const panelStart: Record<number, number> = {};
  for (const p of panels) {
    const first = p.layers[0] as NLayer & { cueStartMs: number };
    panelStart[p.idx] = first ? Math.max(0, first.cueStartMs - 250) : 0;
  }
  const tlPanels: SyncPanel[] = panels.map((p, i) => ({
    idx: p.idx,
    startMs: panelStart[p.idx],
    endMs: i + 1 < panels.length ? panelStart[panels[i + 1].idx] : audioEnd + 1800,
    layers: p.layers.map((l) => ({ kind: l.kind, art: l.art, text: l.text, color: l.color, box: l.box, cueStartMs: (l as NLayer & { cueStartMs: number }).cueStartMs })),
  }));
  const header = brief.header ?? title.toUpperCase().slice(0, 40);
  // CHALK MODE: dark-academic channels (styleGrammar chalkboard/dark) render the
  // same line-art as light chalk on a dark board instead of black marker on
  // cream. palette = [bg, ink/light, accent]. The python renderer reads these
  // hex fields; absent/white mode keeps the legacy cream board untouched.
  const chalk = brief.boardMode === "chalk";
  const pal = brief.palette ?? [];
  const board = chalk ? (pal[0] ?? "#1a1c23") : "#f3f1eb";
  const ink = chalk ? (pal[1] ?? "#f0f0f0") : "#000000";
  const accent = pal[2] ?? "#c0392b";
  const timeline = {
    title, header, headerBox: [0.14, 0.035, 0.72, 0.092], dir: args.runDir, audio: "narration.mp3",
    width: brief.width ?? 1920, height: brief.height ?? Math.round((brief.width ?? 1920) * 9 / 16),
    prerollSec: 2.6, fps: 25, audioEndMs: audioEnd, tailMs: 1800, panels: tlPanels,
    boardMode: chalk ? "chalk" : "white", board, ink, accent,
  };
  const timelinePath = join(args.runDir, "timeline.json");
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2), "utf8");

  // 5. render (deterministic scribe + audio mux)
  const outPath = args.outPath ?? join(args.runDir, "whiteboard-sync.mp4");
  const hand = join(ASSET_DIR, "hand.png");
  log("rendering synced scribe…");
  await runPy([join("scripts", "wb_scribe_sync.py"), timelinePath, outPath, hand], log);
  log(`whiteboardSync done → ${outPath}`);
  return {
    outPath,
    timelinePath,
    title,
    narrationText: fullText,
    panels: tlPanels,
    durationMs: 2600 + audioEnd + 1800,
    ttsCharactersGenerated,
  };
}
