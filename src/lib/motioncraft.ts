/**
 * MOTIONCRAFT — a standalone motion-graphics engine that READS a script, decides
 * intelligently which moments deserve a motion graphic and what KIND, picks the
 * BEST free tool for each, generates it, and renders it. Visual-only.
 *
 *   analyzeForMotion(narration) → opportunities[]   (the "see intelligently" step)
 *   craftMotionGraphics(...)    → rendered clips, timed to the narration cues
 *
 * TOOLS (each is a different best-in-class free program, picked per graphic):
 *   • geo_map      → MapLibre   (real location revealed from above + target marker)
 *   • data_stats   → Remotion   (animated counting-number / bar infographic)
 *   • hero_title   → Remotion   (Nano Banana hero still + 2.5D parallax + kinetic title)
 *   • generative   → p5.js      (abstract animated background — intel network + title)
 *
 * The intelligence is the routing: the LLM never "draws" — it spots the
 * opportunities, classifies each to the right tool, and extracts the content.
 */
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { geminiJsonPro } from "@/lib/gemini";
import { generateBananaImage } from "@/lib/banana";
import { getDepthMap } from "@/lib/depth";

type Logger = (msg: string) => void;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(MODULE_DIR, "..", "motion");
const CAPTURE = join(MODULE_DIR, "..", "..", "scripts", "motion-capture.mjs");
const REMOTION_DIR = process.env.MOTIONCRAFT_REMOTION_DIR || join(TPL_DIR, "remotion");
const CHROME = process.env.CHROME_BIN || "/usr/bin/google-chrome-stable";
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

/* ------------------------------------------------------------------ *
 * TOOL CATALOG — fed to the LLM so it selects the BEST tool per beat.
 * ------------------------------------------------------------------ */
export const MOTION_TOOLS = `
MOTION-GRAPHICS TOOLS — pick the BEST one for each opportunity. A graphic must EARN its place; only flag moments
where a visual genuinely adds clarity or impact (a real place, a set of numbers, a hook/title, a concept to set).
Be selective — 3 to 6 across a whole video, never one per line.

• geo_map  (MapLibre, real dark map) — a cinematic top-down map pushing in to a glowing gold TARGET MARKER on a
  named real place. USE when the narration names a real LOCATION the viewer should place: a city, district, address,
  country, landmark or building. spec = { "query": geocodable real place e.g. "Hoveniersstraat, Antwerp, Belgium",
  "label": UPPERCASE place name, "kicker"?: short tag like "Target Located" }.

• data_stats  (Remotion infographic) — counting numbers + animated bars, staggered. USE when the narration has 2+
  NUMBERS / quantities / a "by the numbers" beat (money, counts, durations, %, comparisons). spec = { "kicker",
  "titlePre", "titleHi" (highlighted word), "stats": [ { "prefix"?:"$", "value": number, "suffix"?:"M+", "label":
  UPPERCASE, "frac": 0..1 bar fill (biggest≈0.9, others proportional, zero→0), "color"?:"#hex" } ] (2-4), "tagline",
  "taglineNote" }.

• hero_title  (Nano Banana + Remotion) — a DESIGNED, thumbnail-grade hero IMAGE (Nano Banana renders a cinematic scene)
  that COMES ALIVE: a Remotion camera PUSH-IN + 2.5D DEPTH PARALLAX (foreground cut out from the depth map drifts over
  the background) + film grade, with a kinetic designed title overlaid. The premium "title card that moves". USE for the
  HOOK/opener, a chapter title, a dramatic CLOSER, or any beat that deserves a striking visual title. spec = { "scene":
  a vivid cinematic description of the hero VISUAL (subject + mood + lighting) — NO text/words in it, with darker
  negative space on the LOWER-LEFT for the title, "kicker", "lines": [1-2 SHORT lines], "sub", "accent"?: "#hex" }.

• generative  (p5.js) — an abstract animated BACKGROUND: a drifting node/intel network + scan sweep + a kinetic title
  reveal. USE for an intro/atmosphere/CONCEPT ("the network/system/crew/operation"), a transition, or any moment with
  no concrete place or number but a THEME to set. spec = { "kicker", "titleLines": [1-2], "sub", "hudTop"?, "hudBottom"?
  (2 lines, "\\n"-joined) }.
`.trim();

export type MotionKind = "geo_map" | "data_stats" | "hero_title" | "generative";
export interface MotionOpportunity {
  id: string;
  kind: MotionKind;
  /** the narration phrase that triggers it (for timing/sync). */
  cue: string;
  reason: string;
  spec: Record<string, unknown>;
}
export interface MotionClip extends MotionOpportunity {
  outPath: string;
  tool: string;
  durationSec: number;
}

const TOOL_OF: Record<MotionKind, string> = { geo_map: "MapLibre", data_stats: "Remotion", hero_title: "Nano Banana + Remotion", generative: "p5.js" };

/* ------------------------------------------------------------------ *
 * 1. SEE INTELLIGENTLY — the LLM scans the script for opportunities.
 * ------------------------------------------------------------------ */
export async function analyzeForMotion(args: { narration: string; topic?: string; max?: number; log?: Logger }): Promise<MotionOpportunity[]> {
  const prompt =
    `${MOTION_TOOLS}\n\n` +
    `You are the MOTION-GRAPHICS DIRECTOR. Read the narration and identify the moments that genuinely deserve a motion ` +
    `graphic. For each, CHOOSE THE BEST TOOL and EXTRACT the content into its spec. Skip lines that don't need a visual.\n\n` +
    (args.topic ? `TOPIC: ${args.topic}\n` : "") +
    `NARRATION:\n"""${args.narration.slice(0, 4000)}"""\n\n` +
    // "hero_title" — MUST match the renderer's MotionKind union; the prompt used
    // to say "kinetic_title", so every title pick was silently dropped downstream.
    `Return JSON: { "opportunities": [ { "id": short-slug, "kind": "geo_map|data_stats|hero_title|generative", ` +
    `"cue": the exact short narration phrase this lands on, "reason": one line (why a graphic here + why this tool), ` +
    `"spec": { ...the tool's spec, fully filled from the narration... } } ] }. Max ${args.max ?? 5} opportunities, ` +
    `ordered as they occur. Output ONLY the JSON.`;
  const r = await geminiJsonPro<{ opportunities: MotionOpportunity[] }>({ prompt, maxTokens: 4000, temperature: 0.4, log: args.log });
  const ops = (r.opportunities || [])
    .filter((o) => o && o.kind && o.spec)
    // Defensive back-map: models trained on the old enum still emit
    // "kinetic_title" — route it to the hero_title renderer instead of dropping it.
    .map((o) => (String(o.kind) === "kinetic_title" ? { ...o, kind: "hero_title" as MotionKind } : o))
    .slice(0, args.max ?? 5);
  args.log?.(`motioncraft: ${ops.length} opportunities — ${ops.map((o) => `${o.kind}(${o.id})`).join(", ")}`);
  return ops;
}

/* ------------------------------------------------------------------ *
 * 2. RENDER per tool
 * ------------------------------------------------------------------ */
function run(cmd: string, cmdArgs: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    p.stderr.on("data", (d) => (e += String(d)));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}: ${e.slice(-400)}`))));
    p.on("error", reject);
  });
}

/** curl Nominatim (undici is WAF-blocked) → [lon,lat]. */
function geocode(query: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const p = spawn("curl", ["-s", "--max-time", "20", "-A", "motioncraft/1.0", `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`]);
    let o = "";
    p.stdout.on("data", (d) => (o += String(d)));
    p.on("close", () => {
      try {
        const j = JSON.parse(o) as { lat: string; lon: string }[];
        resolve(j?.length ? [parseFloat(j[0].lon), parseFloat(j[0].lat)] : null);
      } catch {
        resolve(null);
      }
    });
    p.on("error", () => resolve(null));
  });
}

async function captureHtml(tpl: string, spec: Record<string, unknown>, clipDir: string, log?: Logger): Promise<{ frames: string; dur: number }> {
  await mkdir(clipDir, { recursive: true });
  const html = (await readFile(join(TPL_DIR, tpl), "utf8")).replace("__SPEC__", JSON.stringify(spec));
  const page = join(clipDir, "index.html");
  await writeFile(page, html, "utf8");
  const frames = join(clipDir, "frames");
  await run("node", [CAPTURE], { env: { ...process.env, PAGE: page, OUTDIR: frames, CHROME_BIN: CHROME } });
  return { frames, dur: 6.5 };
}

async function encode(frames: string, out: string, fps = 30): Promise<void> {
  await run(FFMPEG, ["-y", "-framerate", String(fps), "-i", join(frames, "f_%04d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "medium", out, "-loglevel", "error"]);
}

/** Banana still → Marigold depth → feathered NEAR alpha cutout (the detective-engine
 *  2.5D layer). Returns the near.png path, or null → falls back to a Ken Burns push. */
async function deriveNearLayer(baseImg: string, outDir: string, id: string, log?: Logger): Promise<string | null> {
  if (!process.env.FAL_KEY) return null;
  try {
    const { readFile: rf } = await import("node:fs/promises");
    const dataUri = `data:image/png;base64,${(await rf(baseImg)).toString("base64")}`;
    const depthPath = join(outDir, `depth_${id}.png`);
    await getDepthMap(dataUri, depthPath, log ?? (() => {}));
    const nearPng = join(outDir, `near_${id}.png`);
    await run(FFMPEG, ["-y", "-i", baseImg, "-i", depthPath, "-filter_complex",
      "[1:v]format=gray,lutyuv=y='if(gt(val,130),255,0)',gblur=sigma=14[mtmp];[mtmp][0:v]scale2ref=flags=bilinear[m][base];[base][m]alphamerge,format=rgba[o]",
      "-map", "[o]", nearPng]);
    return nearPng;
  } catch (e) {
    log?.(`motioncraft: depth layer failed (${e instanceof Error ? e.message : e}) — Ken Burns fallback`);
    return null;
  }
}

/** Render one opportunity with its chosen tool → mp4 path. */
export async function renderOpportunity(op: MotionOpportunity, runDir: string, log?: Logger): Promise<MotionClip> {
  const clipDir = join(runDir, `clip_${op.id}`);
  await mkdir(clipDir, { recursive: true });
  const out = join(clipDir, "clip.mp4");
  log?.(`motioncraft: rendering ${op.id} via ${TOOL_OF[op.kind]} (${op.kind})…`);

  if (op.kind === "geo_map") {
    const spec = { ...op.spec } as Record<string, unknown>;
    if (!spec.center && spec.query) {
      const c = await geocode(String(spec.query));
      if (!c) throw new Error(`motioncraft: could not geocode "${spec.query}"`);
      spec.center = c;
      if (!spec.coords) spec.coords = `${c[1].toFixed(2)}° ${c[1] >= 0 ? "N" : "S"}  ${Math.abs(c[0]).toFixed(2)}° ${c[0] >= 0 ? "E" : "W"}`;
    }
    const { frames } = await captureHtml("maplibre.tpl.html", spec, clipDir, log);
    await encode(frames, out);
  } else if (op.kind === "generative") {
    const { frames } = await captureHtml("p5gen.tpl.html", op.spec, clipDir, log);
    await encode(frames, out);
  } else if (op.kind === "data_stats") {
    if (!existsSync(join(REMOTION_DIR, "node_modules"))) throw new Error(`motioncraft: remotion deps not installed in ${REMOTION_DIR} (run npm install)`);
    await run("npx", ["remotion", "render", "src/index.ts", "DataStats", out, `--props=${JSON.stringify(op.spec)}`, `--browser-executable=${CHROME}`, "--concurrency=2", "--log=error"], { cwd: REMOTION_DIR });
  } else if (op.kind === "hero_title") {
    if (!existsSync(join(REMOTION_DIR, "node_modules"))) throw new Error(`motioncraft: remotion deps not installed in ${REMOTION_DIR} (run npm install)`);
    const spec = op.spec as Record<string, unknown>;
    // 1. Nano Banana hero render — thumbnail-grade, no baked text, negative space lower-left
    const prompt = `${String(spec.scene || "a dramatic cinematic scene")}. Cinematic movie-poster / premium YouTube-thumbnail quality, dramatic directional lighting, deep rich shadows, shallow depth of field, volumetric atmosphere, high detail, 35mm film grain, 16:9. Strong clear DARKER negative space in the LOWER-LEFT third for a title. Absolutely NO text, words, letters, captions, watermarks or logos anywhere in the image.`;
    log?.(`motioncraft: ${op.id} — Nano Banana hero render…`);
    const buf = await generateBananaImage({ prompt, aspectRatio: "16:9" });
    const pub = join(REMOTION_DIR, "public");
    await mkdir(pub, { recursive: true });
    const baseName = `hero_${op.id}.png`;
    await writeFile(join(pub, baseName), buf);
    // 2. depth → near cutout for 2.5D parallax (the detective-engine camera capability)
    const near = await deriveNearLayer(join(pub, baseName), pub, op.id, log);
    const nearName = near ? basename(near) : "";
    log?.(`motioncraft: ${op.id} — ${nearName ? "2.5D depth parallax" : "Ken Burns push"} + Remotion camera`);
    // 3. Remotion camera move + kinetic title overlay
    const props = { base: baseName, near: nearName, kicker: spec.kicker || "", lines: (spec.lines as string[]) || [String(spec.title || "")], sub: spec.sub || "", accent: spec.accent || "#e8b23a" };
    await run("npx", ["remotion", "render", "src/index.ts", "HeroTitle", out, `--props=${JSON.stringify(props)}`, `--browser-executable=${CHROME}`, "--concurrency=2", "--log=error"], { cwd: REMOTION_DIR });
  } else {
    throw new Error(`motioncraft: unknown kind ${op.kind}`);
  }
  return { ...op, outPath: out, tool: TOOL_OF[op.kind], durationSec: op.kind === "data_stats" ? 8 : op.kind === "hero_title" ? 7 : 6.5 };
}

/* ------------------------------------------------------------------ *
 * 3. ORCHESTRATOR — analyse → render each with its best tool.
 * ------------------------------------------------------------------ */
export async function craftMotionGraphics(args: {
  narration: string;
  topic?: string;
  runDir: string;
  max?: number;
  log?: Logger;
}): Promise<{ clips: MotionClip[]; opportunities: MotionOpportunity[] }> {
  const log = args.log || (() => {});
  await mkdir(args.runDir, { recursive: true });
  const opportunities = await analyzeForMotion({ narration: args.narration, topic: args.topic, max: args.max, log });
  const clips: MotionClip[] = [];
  for (const op of opportunities) {
    try {
      clips.push(await renderOpportunity(op, args.runDir, log));
    } catch (e) {
      log(`motioncraft: ${op.id} (${op.kind}) failed — ${e instanceof Error ? e.message : e}`);
    }
  }
  log(`motioncraft: rendered ${clips.length}/${opportunities.length} clips`);
  return { clips, opportunities };
}
