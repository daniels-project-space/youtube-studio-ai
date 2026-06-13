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
 * with whisper + numpy/scipy/scikit-image/Pillow on PATH (the renderer + aligner).
 * Pure of R2/Convex — the caller owns `runDir` and persistence.
 *
 *   import { castWhiteboardSync, hasWhiteboardSync } from "@/lib/whiteboardSync";
 *   const { outPath } = await castWhiteboardSync({
 *     brief: { topic: "Why Chiquita is the 'banana republic' company", facts, header: "CHIQUITA" },
 *     runDir, log,
 *   });
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { geminiJsonPro } from "@/lib/gemini";
import { synthNarration } from "@/lib/tts";

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
  /** Fish voice id (default "sleepless_historian"). */
  voiceId?: string;
  /** Panel count (default 6) and total spoken words (default 150). */
  panels?: number;
  targetWords?: number;
  /** Render resolution (default 1920x1080). Art is generated at 2K, so 2560x1440 stays crisp. */
  width?: number;
  height?: number;
}

export interface SyncLayer { kind: "art" | "label"; art?: string; text?: string; color?: string; box: number[]; cueStartMs: number }
export interface SyncPanel { idx: number; startMs: number; endMs: number; layers: SyncLayer[] }
export interface WhiteboardSyncResult { outPath: string; timelinePath: string; title: string; narrationText: string; panels: SyncPanel[]; durationMs: number }

const ART_MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");

export function hasWhiteboardSync(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.FISH_AUDIO_API_KEY);
}

/* ------------------------------ helpers -------------------------------- */

function clampBox(b: unknown): number[] {
  return Array.isArray(b) && b.length === 4 ? b.map(Number) : [0.1, 0.18, 0.8, 0.66];
}

async function styledScene(prompt: string, refB64: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  let lastErr = "";
  for (const model of ART_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: refB64 } }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]; error?: { message?: string } };
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((x) => x.inlineData?.data);
      if (part?.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
      lastErr = j.error?.message ?? "no image part";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`whiteboardSync art failed: ${lastErr}`);
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

function planContract(brief: WhiteboardSyncBrief, nPanels: number, words: number): string {
  const facts = brief.facts ? `GROUNDING FACTS (accurate, use only these):\n${brief.facts}\n\n` : "";
  const beats = brief.beats?.length
    ? `\nEXACTLY one panel per beat below — DO NOT STOP EARLY:\n${brief.beats.map((b, i) => `  P${i + 1}: ${b}`).join("\n")}`
    : "";
  return (
    `Design a punchy, INFORMATIVE ~60-second WHITEBOARD explainer. TOPIC: ${brief.topic}\n${facts}` +
    `Think like a motion-designer. Each panel is a STACK OF LAYERS drawn one at a time on a whiteboard, building an argument.\n` +
    `Output STRICT JSON: {"title":"...","panels":[ {"narration":"<~2 spoken sentences (~${Math.round(words / nPanels)} words), end with a small beat>",` +
    `"layers":[ {"kind":"art","draw":"<a COMPOSED, designed line-art SCENE — objects AND how they relate. NO text/words in the art.>",` +
    `"cue":"<verbatim phrase from THIS narration marking when to draw it>","box":[x,y,w,h]} , ` +
    `{"kind":"label","text":"<EXACT short words/number to hand-letter>","cue":"<verbatim phrase>","box":[x,y,w,h],"color":"black|red"} ]} ]}\n\n` +
    `RULES:\n- EXACTLY ${nPanels} panels. ~${words} words TOTAL. Plain spoken narration, NO audio tags. Never stop early.\n` +
    `- Each panel: 1-2 art layers + 1-2 label layers, listed IN THE ORDER their cue appears in the narration. Every label needs non-empty "text".\n` +
    `- Every "cue" MUST be an exact substring of that panel's narration. Don't put the last cue at the very end (leave a trailing clause).\n` +
    `- A persistent TITLE HEADER lives in the top strip: ALL boxes (art + labels) MUST have y >= 0.17 (nothing in the top 0.16).\n` +
    `- box=[x,y,w,h] in 0..1 on a 16:9 board. Art scenes are large (e.g. [0.07,0.18,0.86,0.64]); labels small, placed where they belong.\n` +
    `- ART HAS NO TEXT — all words/numbers are label layers. color:"red" for money/danger emphasis, else black. Be accurate.${beats}`
  );
}

function normalize(raw: RawPlan): NPanel[] {
  return (raw.panels ?? []).map((p, i) => ({
    idx: i,
    narration: String(p.narration ?? "").trim(),
    layers: (p.layers ?? [])
      .map((l) => ({
        kind: l.kind === "label" ? ("label" as const) : ("art" as const),
        draw: l.draw ? String(l.draw).trim() : undefined,
        text: l.text ? String(l.text).trim() : undefined,
        color: l.color === "red" ? "red" : "black",
        cue: String(l.cue ?? "").trim(),
        box: clampBox(l.box),
      }))
      .filter((l) => (l.kind === "art" && l.draw) || (l.kind === "label" && l.text)),
  }));
}

async function buildStoryboard(brief: WhiteboardSyncBrief, log: Logger): Promise<{ title: string; panels: NPanel[]; fullText: string }> {
  const nPanels = brief.panels ?? 6;
  const words = brief.targetWords ?? 150;
  let title = brief.topic, panels: NPanel[] = [], fullText = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const extra = attempt ? `\n\nYOUR PREVIOUS ATTEMPT WAS TOO SHORT. Output EXACTLY ${nPanels} panels and ~${words} words covering every beat. Do not stop early.` : "";
    const raw = await geminiJsonPro<RawPlan>({ prompt: planContract(brief, nPanels, words) + extra, maxTokens: 8000, temperature: 0.55 });
    title = String(raw.title ?? brief.topic);
    panels = normalize(raw);
    panels.forEach((p, i) => (p.idx = i));
    fullText = panels.map((p) => p.narration).join(" ");
    const wc = fullText.split(/\s+/).filter(Boolean).length;
    log(`storyboard attempt ${attempt + 1}: ${panels.length} panels, ${wc} words, ${panels.reduce((n, p) => n + p.layers.length, 0)} layers`);
    if (panels.length >= nPanels && wc >= words * 0.8) break;
  }
  if (!panels.length) throw new Error("whiteboardSync: storyboard produced no panels");
  return { title, panels, fullText };
}

/* ------------------------------ timing --------------------------------- */

function alignCues(panels: NPanel[], fullText: string, words: { text: string; start: number; end: number }[]): { audioEnd: number } {
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
  let mp = 0;
  const cueTime = (cue: string): number | null => {
    const cw = cue.split(/\s+/).map(norm).filter(Boolean);
    if (!cw.length) return null;
    for (let i = mp; i < mw.length; i++) if (eq(mw[i], cw[0])) { mp = i + 1; return Math.round(mwTime[i] as number); }
    return null;
  };
  let last = 0;
  for (const p of panels)
    for (const l of p.layers as (NLayer & { cueStartMs?: number })[]) {
      const t = cueTime(l.cue);
      l.cueStartMs = t != null ? t : last + 700;
      if (l.cueStartMs < last) l.cueStartMs = last + 250;
      last = l.cueStartMs;
    }
  return { audioEnd };
}

/* ------------------------------ orchestrator --------------------------- */

export async function castWhiteboardSync(args: { brief: WhiteboardSyncBrief; runDir: string; outPath?: string; log?: Logger }): Promise<WhiteboardSyncResult> {
  const log = args.log ?? (() => {});
  const brief = args.brief;
  if (!process.env.GEMINI_API_KEY) throw new Error("whiteboardSync: GEMINI_API_KEY missing");
  if (!process.env.FISH_AUDIO_API_KEY) throw new Error("whiteboardSync: FISH_AUDIO_API_KEY missing");
  await mkdir(args.runDir, { recursive: true });

  // 1. storyboard
  const { title, panels, fullText } = await buildStoryboard(brief, log);
  await writeFile(join(args.runDir, "plan.json"), JSON.stringify({ title, panels, fullText }, null, 2), "utf8");

  // 2. art layers (style-locked, no text, pure white)
  const refPath = join(ASSET_DIR, `${brief.styleId ?? "history"}_ref.png`);
  const refB64 = existsSync(refPath) ? (await readFile(refPath)).toString("base64") : "";
  const artJobs: { p: NPanel; l: NLayer }[] = [];
  for (const p of panels) for (const l of p.layers) if (l.kind === "art") artJobs.push({ p, l });
  await pool(artJobs, 3, async ({ p, l }) => {
    const prompt =
      `A single COMPOSED whiteboard marker line-art SCENE on a PURE WHITE (#ffffff) background, nothing else, filling the frame with a small margin. ` +
      (refB64 ? `CRITICAL: match the EXACT clean black marker line-art style and single stroke weight of the REFERENCE image (copy STYLE only). ` : "") +
      `Draw this designed scene: ${l.draw}. It illustrates: "${p.narration}". Simple iconic line-art, clear and informative, NOT photorealistic, no shading. ` +
      `Use red for at most one or two accent marks. ABSOLUTELY NO text, words, numbers or letters anywhere. No watermark, pure white background.`;
    const fn = `art_${p.idx}_${p.layers.indexOf(l)}.png`;
    await writeFile(join(args.runDir, fn), refB64 ? await styledScene(prompt, refB64) : await styledScene(prompt, ""));
    l.art = fn;
    log(`art ${fn} ✓`);
  });

  // 3. narration + alignment
  log("TTS (Fish)…");
  const mp3 = await synthNarration({ text: fullText, voiceId: brief.voiceId ?? "sleepless_historian", speed: 0.95 });
  await writeFile(join(args.runDir, "narration.mp3"), Buffer.from(mp3));
  log("aligning (Whisper)…");
  const wpath = join(args.runDir, "wwords.json");
  await runPy([join("scripts", "whisper_align.py"), join(args.runDir, "narration.mp3"), wpath], log);
  const words = JSON.parse(await readFile(wpath, "utf8")) as { text: string; start: number; end: number }[];
  const { audioEnd } = alignCues(panels, fullText, words);

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
  const timeline = {
    title, header, headerBox: [0.14, 0.035, 0.72, 0.092], dir: args.runDir, audio: "narration.mp3",
    width: brief.width ?? 1920, height: brief.height ?? 1080,
    prerollSec: 2.6, fps: 25, audioEndMs: audioEnd, tailMs: 1800, panels: tlPanels,
  };
  const timelinePath = join(args.runDir, "timeline.json");
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2), "utf8");

  // 5. render (deterministic scribe + audio mux)
  const outPath = args.outPath ?? join(args.runDir, "whiteboard-sync.mp4");
  const hand = join(ASSET_DIR, "hand.png");
  log("rendering synced scribe…");
  await runPy([join("scripts", "wb_scribe_sync.py"), timelinePath, outPath, hand], log);
  log(`whiteboardSync done → ${outPath}`);
  return { outPath, timelinePath, title, narrationText: fullText, panels: tlPanels, durationMs: 2600 + audioEnd + 1800 };
}
