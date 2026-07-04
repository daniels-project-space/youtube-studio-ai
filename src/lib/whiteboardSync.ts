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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { geminiJsonPro } from "@/lib/gemini";
import { generateBananaImage } from "@/lib/banana";
import { synthNarration } from "@/lib/tts";
import { preflightPythonRenderer } from "@/lib/pydeps";

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

const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");

export function hasWhiteboardSync(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.FISH_AUDIO_API_KEY);
}

/* ------------------------------ helpers -------------------------------- */

function clampBox(b: unknown): number[] {
  return Array.isArray(b) && b.length === 4 ? b.map(Number) : [0.1, 0.18, 0.8, 0.66];
}

async function styledScene(prompt: string, refB64: string, refMime = "image/png"): Promise<Buffer> {
  // Line-art still conditioned on the channel's style-reference image (img2img).
  // An empty refB64 renders unconditioned — small keyword sketches skip the ref
  // (input images bill per call; the style prompt locks simple icons fine).
  return generateBananaImage({
    prompt,
    aspectRatio: "16:9",
    imageSize: "2K",
    images: refB64 ? [{ data: refB64, mimeType: refMime }] : undefined,
  });
}

/**
 * Self-anchor ref payload: a ≤1024px JPEG re-encode of an accepted scene PNG.
 * The ref is re-sent as an INPUT image on every subsequent scene call (billed
 * + uploaded per call) and only needs to carry STYLE, not 2K detail — a small
 * JPEG does that at ~1/10 the payload. Falls back to the raw PNG when ffmpeg
 * is unavailable (dev boxes without the baked binary).
 */
async function selfAnchorB64(pngPath: string): Promise<{ data: string; mime: string }> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const out = pngPath.replace(/\.png$/i, "_ref.jpg");
    if (!existsSync(out)) {
      await exec(process.env.FFMPEG_PATH || "ffmpeg", [
        "-y", "-i", pngPath,
        "-vf", "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease",
        "-q:v", "3", "-frames:v", "1", out,
      ]);
    }
    return { data: (await readFile(out)).toString("base64"), mime: "image/jpeg" };
  } catch {
    return { data: (await readFile(pngPath)).toString("base64"), mime: "image/png" };
  }
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

/** Generate ONE chunk of panels (retry on short/invalid output). */
async function genChunk(brief: WhiteboardSyncBrief, beats: string[], nP: number, words: number, cont: string, log: Logger): Promise<{ title: string; panels: NPanel[] }> {
  const sub: WhiteboardSyncBrief = { ...brief, beats, panels: nP, targetWords: words };
  for (let attempt = 0; attempt < 3; attempt++) {
    const extra =
      (cont ? `\n\nThis is PART of a longer video already in progress; the previous panel's narration ended: "${cont.slice(-160)}". Continue naturally — do NOT repeat the intro or title.` : "") +
      (attempt ? `\n\nFIX: output EXACTLY ${nP} panels as STRICTLY VALID minified JSON.` : "");
    try {
      const raw = await geminiJsonPro<RawPlan>({ prompt: planContract(sub, nP, words) + extra, maxTokens: 14000, temperature: 0.5 });
      const panels = normalize(raw);
      if (panels.length >= nP) return { title: String(raw.title ?? brief.topic), panels };
      log(`  chunk got ${panels.length}/${nP} panels — retry`);
      if (attempt === 2 && panels.length) return { title: String(raw.title ?? brief.topic), panels };
    } catch (e) {
      log(`  chunk failed (${(e instanceof Error ? e.message : String(e)).slice(0, 90)}) — retry`);
    }
  }
  return { title: brief.topic, panels: [] };
}

async function buildStoryboard(brief: WhiteboardSyncBrief, log: Logger): Promise<{ title: string; panels: NPanel[]; fullText: string }> {
  const nPanels = brief.panels ?? 6;
  const words = brief.targetWords ?? 150;
  const beats = brief.beats ?? [];
  const CHUNK = 4;
  let title = brief.topic;
  const all: NPanel[] = [];
  if (beats.length > 6) {
    // CHUNKED: one LLM call can't reliably emit many dense panels — build in groups.
    for (let i = 0; i < beats.length; i += CHUNK) {
      const grp = beats.slice(i, i + CHUNK);
      const cont = all.length ? all[all.length - 1].narration : "";
      const { title: t, panels } = await genChunk(brief, grp, grp.length, Math.round((words * grp.length) / beats.length), cont, log);
      if (i === 0 && t) title = t;
      all.push(...panels);
      log(`storyboard chunk ${Math.floor(i / CHUNK) + 1}: +${panels.length} panels (total ${all.length})`);
    }
  } else {
    const { title: t, panels } = await genChunk(brief, beats, nPanels, words, "", log);
    if (t) title = t;
    all.push(...panels);
    log(`storyboard: ${all.length} panels, ${all.reduce((n, p) => n + p.layers.length, 0)} layers`);
  }
  all.forEach((p, i) => (p.idx = i));
  if (!all.length) throw new Error("whiteboardSync: storyboard produced no panels");
  return { title, panels: all, fullText: all.map((p) => p.narration).join(" ") };
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

  // 1. storyboard (cached → resumable reruns)
  const planPath = join(args.runDir, "plan.json");
  let title: string, panels: NPanel[], fullText: string;
  if (existsSync(planPath)) {
    ({ title, panels, fullText } = JSON.parse(await readFile(planPath, "utf8")) as { title: string; panels: NPanel[]; fullText: string });
    log(`storyboard: loaded cached plan (${panels.length} panels)`);
  } else {
    ({ title, panels, fullText } = await buildStoryboard(brief, log));
    await writeFile(planPath, JSON.stringify({ title, panels, fullText }, null, 2), "utf8");
  }

  // 2. art layers (style-locked, no text, pure white)
  const refPath = join(ASSET_DIR, `${brief.styleId ?? "history"}_ref.png`);
  const curatedB64 = existsSync(refPath) ? (await readFile(refPath)).toString("base64") : "";
  // Mutable scene ref: starts as the curated style ref. Only "history" ships a
  // curated reference — for any OTHER styleId every scene used to free-interpret
  // the style prompt, drifting between simple-doodle and detailed-illustration
  // across panels. Fix: SELF-ANCHOR (below) — the first accepted scene becomes
  // the img2img style reference for all subsequent scenes.
  let sceneRefB64 = curatedB64;
  let sceneRefMime = "image/png";
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
      (isScene && sceneRefB64
        ? `CRITICAL: match the EXACT clean black marker line-art style and single stroke weight of the REFERENCE image (copy STYLE only). `
        : `CRITICAL: clean black marker line-art, a single consistent stroke weight throughout. `) +
      (isScene
        ? `Draw a COMPOSED, designed scene: ${l.draw} — show the objects AND how they relate, clear and informative. `
        : `Draw a single bold iconic sketch of: ${l.draw}, instantly readable. `) +
      `(Context for tone, do NOT write any text: "${p.narration}".) Simple line-art, NOT photorealistic, no shading. ` +
      `Use red for at most one or two accent marks. ABSOLUTELY NO text, words, numbers or letters anywhere. No watermark, NO whiteboard, NO frame, NO border, NO grey edges — pure white #ffffff background ONLY.`;
    try {
      // Style ref only for the hero SCENES — the 2-4 small sketches per panel
      // were re-sending the same ref PNG on every call (billed input images).
      await writeFile(out, await styledScene(prompt, isScene ? sceneRefB64 : "", sceneRefMime));
      l.art = fn;
      log(`art ${fn} ✓`);
    } catch (e) {
      log(`art ${fn} skipped (${(e instanceof Error ? e.message : String(e)).slice(0, 70)})`); // 1 bad gen must not kill the run
    }
  };
  // SELF-ANCHOR: no curated ref → render the FIRST hero scene alone, then feed
  // it back as the style reference for every remaining scene. Costs nothing
  // extra (that scene rendered anyway) beyond serialising one image; the
  // anchor's ≤1024px JPEG re-encode keeps the per-call ref payload small.
  let anchorJob: { p: NPanel; l: NLayer } | undefined;
  if (!curatedB64) {
    anchorJob = artJobs.find(isSceneJob);
    if (anchorJob) {
      await renderArt(anchorJob);
      if (anchorJob.l.art) {
        const a = await selfAnchorB64(join(args.runDir, anchorJob.l.art));
        sceneRefB64 = a.data;
        sceneRefMime = a.mime;
        log(`style: no curated ref for "${brief.styleId ?? "history"}" — self-anchoring scenes to ${anchorJob.l.art}`);
      }
    }
  }
  await pool(artJobs.filter((j) => j !== anchorJob), 3, renderArt);

  // 3. narration + alignment (cached → resumable)
  const mp3Path = join(args.runDir, "narration.mp3");
  const wpath = join(args.runDir, "wwords.json");
  if (!existsSync(mp3Path)) {
    log("TTS (Fish)…");
    const mp3 = await synthNarration({ text: fullText, voiceId: brief.voiceId ?? "sleepless_historian", speed: 0.95 });
    await writeFile(mp3Path, Buffer.from(mp3));
  } else log("TTS cached");
  if (!existsSync(wpath)) {
    log("aligning (Whisper)…");
    await runPy([join("scripts", "whisper_align.py"), mp3Path, wpath], log);
  } else log("alignment cached");
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
    width: brief.width ?? 1920, height: brief.height ?? Math.round((brief.width ?? 1920) * 9 / 16),
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
