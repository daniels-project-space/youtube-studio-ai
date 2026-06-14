/**
 * DOCUMOTION — the documentary-collage MOTION engine (banana/scriptcraft
 * integration shape): topic + channel STYLE in → polished motion-graphics body
 * out. VISUAL CRAFT ONLY (narration / music / SFX are separate modules).
 *
 * What the module knows — so a channel's pipeline just picks a style id:
 *   • WHAT IS POSSIBLE — the shot-kind grammar (parallax_portrait, map_zoom,
 *     photo_slide, matte_sequence, collage_pan, evidence_board, object_drop,
 *     quote_card) and the channel WORLDS in src/remotion/docuStyles.ts
 *     (archival_collage, detective_board, …). Each world carries its image-
 *     prompting intelligence (still-style + per-role framing) and its theme.
 *   • HOW TO GET THE IMAGE IT NEEDS — per asset, a source: "generate" (Nano
 *     Banana, the default) or "archival" (a real Wikimedia photograph of a
 *     named entity, then cut out). Every generated still passes a vision gate
 *     before it enters the film (better first tries).
 *   • HOW TO ASSEMBLE — a Gemini-Pro plan with a cinematography doctrine
 *     (motivated camera move + varied pacing per shot), rendered by the
 *     DocuMotion Remotion composition (eased camera + 2.5D parallax, stroked
 *     type on scrims, red-string evidence boards, torn mattes, film grade).
 *   • HOW TO JUDGE & FIX — a craft VERIFIER renders one STILL per shot (fast),
 *     scores type/cutout/composition/style/cohesion, and emits TYPED ACTIONS
 *     the engine APPLIES (regen_asset, emphasize_text, reposition_labels,
 *     retime, camera) before re-checking, then renders the 1080p master.
 *
 * Speed: assets generate+gate in a concurrency pool, verifier rounds use
 * stills (not full video), only the final pass renders the full timeline.
 *
 * Deps: GEMINI_API_KEY + FAL_KEY.
 *
 *   import { craftDocuMotion } from "@/lib/documotion";
 *   const { outPath, verdict } = await craftDocuMotion({ topic, style: "detective_board", runDir, log });
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { geminiJson, geminiJsonPro, geminiVisionLocal, parseJsonLoose } from "@/lib/gemini";
import { generateBananaImage, bananaTypeCard } from "@/lib/banana";
import { getDepthMap } from "@/lib/depth";
import { fetchCityGeo, type CityGeo } from "@/lib/geoMap";
import { searchWikimediaImageUrl } from "@/lib/wikimedia";
import { renderDocuMotion, renderDocuStills } from "@/lib/remotionRender";
import {
  getStyle,
  type DocuAssetRole,
  type DocuShotKind,
  type DocuStyleDef,
} from "@/remotion/docuStyles";
import type { DocuCamera, DocuLabel, DocuLabelPos, DocuShotSpec, DocuThread } from "@/remotion/DocuMotion";

type Logger = (msg: string) => void;

const FPS = 30;

/** Banana/Gemini-image concurrency — capped to stay under image rate limits. */
const ASSET_CONCURRENCY = Number(process.env.DOCU_ASSET_CONCURRENCY ?? 4);

export function hasDocumotion(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.FAL_KEY);
}

/* --------------------------------------------------------------- helpers -- */

/** Bounded-concurrency map preserving input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function run(cmd: string, cmdArgs: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`))));
    p.on("error", reject);
  });
}

const ffmpegBin = () => process.env.FFMPEG_BIN || "ffmpeg";

/* ------------------------------------------------------------------ plan -- */

export interface DocuAssetBrief {
  id: string;
  role: DocuAssetRole;
  brief: string;
  /** generate (default) | archival (real Wikimedia photo of `query`). */
  source?: "generate" | "archival";
  query?: string;
}

export interface DocuShotPlan {
  kind: DocuShotKind;
  /** The spoken VOICEOVER line for this shot — the narrative spine; the visual
   *  ILLUSTRATES it, and the deliverable's VO is these lines in order. */
  narration: string;
  /** Documentary shot SCALE — drives the framing of the asset brief and the
   *  scene-setting rhythm (establish wide → tighten to detail). */
  scale: "establishing" | "wide" | "medium" | "close";
  /** Short note on the visual intent (what to show). */
  beat: string;
  durationSec: number;
  camera: DocuCamera;
  title?: string;
  kicker?: string;
  labels?: DocuLabel[];
  annotations?: string[];
  circleLabel?: string;
  quote?: string;
  attribution?: string;
  accent?: string;
  threads?: DocuThread[];
  /** geo_map: the real place to render (e.g. "Antwerp, Belgium"). */
  geoQuery?: string;
  /** depth_parallax: a cinematic focus pull between near + far planes. */
  rackFocus?: "near_to_far" | "far_to_near";
  assets: DocuAssetBrief[];
}

export interface DocuPlan {
  title: string;
  styleId: string;
  shots: DocuShotPlan[];
}

/** Per-kind asset contract: role → [min, max] count. */
const KIND_ASSETS: Record<DocuShotKind, Partial<Record<DocuAssetRole, [number, number]>>> = {
  parallax_portrait: { bg: [1, 1], fg: [1, 1] },
  depth_parallax: { image: [1, 1] }, // one scene; near depth layers are DERIVED
  geo_map: {}, // no images — real street geometry is FETCHED from geoQuery
  map_zoom: { bg: [1, 1] },
  photo_slide: { bg: [1, 1], image: [2, 3] },
  matte_sequence: { image: [3, 4] },
  collage_pan: { bg: [0, 1], image: [6, 8] },
  evidence_board: { bg: [0, 1], image: [3, 6] },
  object_drop: { bg: [1, 1], fg: [0, 1], cutout: [1, 3] },
  quote_card: { bg: [0, 1] },
};

/** What each capability does + when to use it — the planner's palette. */
const CAPABILITY_CATALOG =
  `CAPABILITY PALETTE (use any when it serves the story; the style says which to LEAN on):\n` +
  `- parallax_portrait: a die-cut person over a plate with a huge NAME title — introduce a person.\n` +
  `- depth_parallax: ONE cinematic scene given living 2.5D depth, camera drifts THROUGH it — the WORKHORSE for ` +
  `ESTABLISHING/WIDE scene-setting (a city skyline, a bank exterior at night, the insider standing across the street, ` +
  `the crew around a table) AND reconstructed moments (the safe being cracked). Render people IN the scene here, not ` +
  `as cutouts. (brief MUST describe a clear foreground subject and a separated background). Optional ` +
  `"rackFocus": a cinematic FOCUS PULL — "near_to_far" (start on the foreground subject, pull focus to the depths) or ` +
  `"far_to_near" (reveal the foreground). Use it when the line shifts attention between a close thing and a deeper ` +
  `one (e.g. "a gloved hand on the dial — then the vault yawning behind"); only on a brief with a STRONG close ` +
  `subject AND a clearly deeper, separated background.\n` +
  `- geo_map: a FULLY RENDERED animated map of a REAL place — streets draw on, buildings rise, a glowing geo-pin ` +
  `drops with radar pulses, camera pushes into the location. Needs a real "geoQuery" (e.g. "Antwerp, Belgium"). ` +
  `Use this to pin a story to a real location.\n` +
  `- map_zoom: a simpler aged map/chart with a ringed location word — geography when geo_map is overkill.\n` +
  `- photo_slide: 2-3 taped photographs sliding over a plate — a handful of evidence/photos.\n` +
  `- matte_sequence: 3-4 full-frame scenes with torn-paper cuts between them — a list of places/moments.\n` +
  `- collage_pan: 6-8 small photos on a board, slow rostrum pan — a broad sweep.\n` +
  `- evidence_board: cork board of pinned photos joined by RED STRING, camera prowls and HOLDS on each clue — ` +
  `investigations and webs of connection.\n` +
  `- object_drop: 1-3 objects drop onto a plate under a huge number/title — money, loot, a key object.\n` +
  `- quote_card: a single closing line — the landing.`;

const CAMERA_MOVES = ["push_in", "pull_back", "pan_left", "pan_right", "drift"];
const CAMERA_INTENSITIES = ["subtle", "medium", "strong"];

function validatePlan(plan: DocuPlan, durationSec: number, _style: DocuStyleDef): string[] {
  const problems: string[] = [];
  if (!plan.shots?.length || plan.shots.length < 5) problems.push("need 6-8 shots");
  // Any KNOWN capability is allowed — a style biases selection, it does not
  // restrict it (the planner composes freely).
  for (const [i, s] of (plan.shots ?? []).entries()) {
    if (!KIND_ASSETS[s.kind]) {
      problems.push(`shot ${i}: unknown kind "${s.kind}" (use one of: ${Object.keys(KIND_ASSETS).join(", ")})`);
      continue;
    }
    if (!s.narration?.trim()) problems.push(`shot ${i}: missing narration (the spoken VO line)`);
    if (!["establishing", "wide", "medium", "close"].includes(s.scale)) problems.push(`shot ${i}: scale must be establishing|wide|medium|close`);
    if (!s.beat?.trim()) problems.push(`shot ${i}: empty beat`);
    if (!(s.durationSec >= 3 && s.durationSec <= 10)) problems.push(`shot ${i}: durationSec must be 3-10`);
    if (!s.camera || !CAMERA_MOVES.includes(s.camera.move) || !CAMERA_INTENSITIES.includes(s.camera.intensity))
      problems.push(`shot ${i}: camera must be {move,intensity}`);
    const byRole: Record<string, number> = {};
    for (const a of s.assets ?? []) byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    for (const [role, [min, max]] of Object.entries(KIND_ASSETS[s.kind]) as [DocuAssetRole, [number, number]][]) {
      const n = byRole[role] ?? 0;
      if (n < min || n > max) problems.push(`shot ${i} (${s.kind}): needs ${min}-${max} ${role}, got ${n}`);
    }
    if (s.kind === "quote_card" && !s.quote?.trim()) problems.push(`shot ${i}: quote_card without quote`);
    if (s.kind === "geo_map" && !s.geoQuery?.trim()) problems.push(`shot ${i}: geo_map without geoQuery (a real place name)`);
  }
  const total = (plan.shots ?? []).reduce((a, s) => a + (s.durationSec || 0), 0);
  if (Math.abs(total - durationSec) > durationSec * 0.15) problems.push(`durations sum ${total}s, target ${durationSec}s (±15%)`);
  const words = (plan.shots ?? []).map((s) => s.narration ?? "").join(" ").split(/\s+/).filter(Boolean).length;
  const wTarget = Math.round(durationSec * 2.0);
  if (words < wTarget * 0.6 || words > wTarget * 1.4) problems.push(`narration ${words} words, target ~${wTarget} (≈2 words/sec of ${durationSec}s)`);
  // Documentary shot grammar: SET THE SCENE first, then have scale variety.
  const scales = (plan.shots ?? []).map((s) => s.scale);
  const opensWide = scales.slice(0, 2).some((sc) => sc === "establishing" || sc === "wide");
  if (!opensWide) problems.push("shots 1-2 must ESTABLISH the scene (scale establishing/wide) before any close detail");
  const wideCount = scales.filter((sc) => sc === "establishing" || sc === "wide").length;
  if (wideCount < 2) problems.push(`need >=2 establishing/wide scene-setting shots (got ${wideCount})`);
  if (new Set(scales).size < 2) problems.push("vary the shot scale (don't use one scale for everything)");
  return problems;
}

function planContract(style: DocuStyleDef): string {
  return `Return STRICT JSON:
{
 "title": "video title",
 "styleId": "${style.id}",
 "shots": [
   {
     "narration": "the EXACT voiceover sentence spoken over this shot (present tense, concrete, cinematic) — the visual must SHOW what this says",
     "scale": "establishing|wide|medium|close — shot 1-2 establish the world; tighten over the video",
     "kind": one of [${Object.keys(KIND_ASSETS).join(", ")}] — LEAN ON [${style.preferredKinds.join(", ")}]; pick the one that best SHOWS this line at this scale,
     "beat": "<=8 words: the visual intent (what we literally see)",
     "durationSec": n (3-10),
     "camera": {"move": "push_in|pull_back|pan_left|pan_right|drift", "intensity": "subtle|medium|strong"},
     "title": "BIG headline <=3 words (parallax_portrait / object_drop / evidence_board)",
     "kicker": "tiny letterspaced line above the title (optional)",
     "labels": [{"text": "<=3 word callout / evidence tag", "sub": "optional handwritten note <=6 words"}],
     "annotations": ["optional handwritten margin note <=6 words"],
     "circleLabel": "map_zoom ring word (one word)",
     "quote": "quote_card only — THE line <=14 words",
     "attribution": "quote_card byline",
     "accent": "optional hex accent for this shot",
     "threads": [{"from": photoIndex, "to": photoIndex}]  (evidence_board only — connections between its images),
     "geoQuery": "Real place name, geo_map ONLY (e.g. \\"Antwerp, Belgium\\")",
     "rackFocus": "depth_parallax ONLY, optional: near_to_far | far_to_near (a cinematic focus pull)",
     "assets": [{"id":"bg","role":"bg|fg|image|cutout","brief":"vivid period/world-correct description, NO text in image","source":"generate|archival","query":"<entity name if source=archival>"}]
   }
 ]
}
ASSET CONTRACT per kind (exact roles): parallax_portrait: 1 bg (wide environment plate, calm centre for big type) + 1 fg (the protagonist ALONE, head/shoulders/arms inside frame, plain backdrop). depth_parallax: exactly 1 image (a cinematic scene with a CLEAR foreground subject and a separated background — the engine derives the 2.5D depth layers). geo_map: ZERO assets — supply "geoQuery" (a real place); the map is rendered from live street data. map_zoom: 1 bg (aged map/chart of the region). photo_slide: 1 bg + 2-3 image. matte_sequence: 3-4 image (full-frame scenes). collage_pan: 1 bg + 6-8 image. evidence_board: optional 1 bg (cork/board) + 3-6 image (the pinned clues/suspects/photos). object_drop: 1 bg + 0-1 fg + 1-3 cutout (single object on white). quote_card: 0-1 bg.
SOURCE: use "archival" with a precise "query" ONLY for a real, famous, named person/place that Wikimedia certainly has (e.g. fg of "Henry Ford"); otherwise "generate".
CUE-DRIVEN ASSETS: every asset brief must depict EXACTLY what its shot's narration line says — render the concrete image the words evoke. If the line names the crew → a scene of the crew (e.g. dark-clad figures in a dim vault corridor at night); a place from above → an aerial/overhead scene of that place; a person at a location → that person in front of that location; an object → that object. Do NOT use generic filler.
ON-SCREEN TEXT TONE: titles/kickers/labels/circleLabels must be SHORT, dramatic and tonally on-point for a premium documentary — evocative, never awkward, literal, redundant or accidentally COMICAL. (Bad: an evidence shot titled "THE TRASH". Good: "THE SLIP", "ONE MISTAKE", "THE INSIDER".) When unsure, omit the title and let the imagery speak.`;
}

/** Gemini Pro plans the shot list for the chosen style. One retry, then loud. */
export async function planDocu(args: {
  topic: string;
  style: DocuStyleDef;
  referenceNotes?: string;
  durationSec: number;
  log?: Logger;
}): Promise<DocuPlan> {
  const { topic, style, referenceNotes, durationSec, log } = args;
  const shotsWanted = Math.max(6, Math.min(8, Math.round(durationSec / 8)));
  const wordsTarget = Math.round(durationSec * 2.0);
  const base =
    `You are the writer + director of ${style.worldDescription}\n` +
    `CREATIVE DIRECTION: ${style.creativeDirection}\n` +
    `Make the first ${durationSec} seconds of a documentary about: ${topic}.\n` +
    (referenceNotes ? `REFERENCE (beats + visual grammar to honour): ${referenceNotes}\n` : "") +
    `WORK IN THIS ORDER:\n` +
    `STEP 1 — write the NARRATION: a gripping, FACTUAL voiceover that carries the viewer through the story as ONE ` +
    `coherent arc (hook → who/where → how it unfolds → the turn → the payoff), ~${wordsTarget} words total across ` +
    `exactly ${shotsWanted} beats (one beat = one shot, ~${Math.round(wordsTarget / shotsWanted)} words each). Present ` +
    `tense, concrete, cinematic, no filler. Each beat must flow from the last.\n` +
    `STEP 2 — SET THE SCENE FIRST (documentary shot grammar): a documentary ESTABLISHES the world before any detail. ` +
    `Shot 1 (and usually shot 2) must be ESTABLISHING/WIDE — place the viewer in the location: a wide aerial or ` +
    `exterior of the city/skyline/building, the atmosphere of the place. Introduce PEOPLE IN THEIR ENVIRONMENT as ` +
    `WIDE/MEDIUM scenes (the lone figure across the street from the bank at night; the crew gathered around a table in ` +
    `a dim room) — render them INSIDE the scene with depth_parallax, NOT as a floating cutout. Then move WIDE → MEDIUM ` +
    `→ CLOSE as the story tightens (establish the building → the vault door → the hand on the dial). Vary the scale; ` +
    `never string together only tight close-ups. Give each shot a "scale".\n` +
    `STEP 3 — VISUALISE each beat: choose the capability that best SHOWS that line + write asset brief(s) depicting ` +
    `EXACTLY that image at that SCALE (establishing/wide briefs = lots of environment + the whole place; close briefs ` +
    `= tight detail). Cue→capability: a real place / "the city" / "the building" / "from above" → geo_map (real ` +
    `streets) or a WIDE aerial depth_parallax; a person IN a place, the crew, a reconstructed MOMENT → depth_parallax ` +
    `of that exact wide/medium scene; a deliberate single face-forward REVEAL of a named person → parallax_portrait ` +
    `(archival photo if famous) — use this sparingly, NOT for every person; a web of clues → evidence_board; a ` +
    `sum/object → object_drop. The viewer must always SEE what they HEAR.\n` +
    `${CAPABILITY_CATALOG}\n` +
    `RULES: exactly ${shotsWanted} shots. Shot 1 = a strong HOOK (prefer ${style.hookKind}). Last shot = ` +
    `${style.closerKind}. Lean on this world's preferred capabilities but pick whatever SHOWS the line best; vary the ` +
    `kinds (no identical kind back-to-back unless it is the world's spine). Only choose a visual you can render ` +
    `CONVINCINGLY — if a beat is abstract, reframe its narration to a concrete, showable image. CINEMATOGRAPHY: ` +
    `${style.cinematography}\n` +
    `Asset briefs: vivid, specific, world-correct, strong subject/background separation, NO text/lettering in the ` +
    `image.\n${planContract(style)}`;

  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await geminiJsonPro<DocuPlan>({ prompt: base + feedback, maxTokens: 9000, temperature: 0.6, log });
    plan.styleId = style.id;
    lastProblems = validatePlan(plan, durationSec, style);
    if (!lastProblems.length) {
      await lintLabels(plan, style, log);
      log?.(`documotion plan [${style.id}]: "${plan.title}" — ${plan.shots.length} shots, narration-driven`);
      return plan;
    }
    log?.(`documotion plan attempt ${attempt + 1} rejected: ${lastProblems.join("; ")}`);
    feedback = `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly these: ${lastProblems.join("; ")}`;
  }
  throw new Error(`documotion: plan failed validation twice (${lastProblems.join("; ")})`);
}

/**
 * On-screen TEXT tonal lint — review every title/kicker/label/circleLabel in
 * the context of its shot's narration and rewrite anything awkward, literal,
 * redundant or accidentally comical (the "THE TRASH" problem). Mutates the plan
 * in place; never throws (the plan is already valid).
 */
async function lintLabels(plan: DocuPlan, style: DocuStyleDef, log?: Logger): Promise<void> {
  const items = plan.shots.map((s, i) => ({
    i,
    kind: s.kind,
    narration: s.narration,
    title: s.title ?? "",
    kicker: s.kicker ?? "",
    circleLabel: s.circleLabel ?? "",
    labels: (s.labels ?? []).map((l) => l.text),
  }));
  const hasText = items.some((it) => it.title || it.kicker || it.circleLabel || it.labels.length);
  if (!hasText) return;
  try {
    const res = await geminiJson<{ fixes?: { i: number; title?: string; kicker?: string; circleLabel?: string; labels?: string[] }[] }>({
      prompt:
        `You are the typography editor of a premium ${style.label} documentary. Below is the on-screen TEXT for each ` +
        `shot with its voiceover. A title/label is a DRAMATIC card — it must name the SIGNIFICANCE or stakes, never a ` +
        `mundane object literally. HARD RULE: if a title literally names something ordinary (trash, sandwich, bag, ` +
        `crumbs, food), it reads as accidentally COMICAL at huge scale — you MUST replace it with the dramatic meaning ` +
        `(e.g. title "THE TRASH" over a discarded-evidence shot → "ONE MISTAKE" or "THE SLIP"; "THE SANDWICH" → ` +
        `"THE EVIDENCE"). Also fix anything clunky, redundant or off-tone. Keep genuinely strong text unchanged. Set a ` +
        `field to "" to drop it and let the image speak. Titles <=3 words, labels <=3 words, circleLabel one word.\n` +
        `SHOTS:\n${JSON.stringify(items)}\n` +
        `Return STRICT JSON {"fixes":[{"i":n,"title":"...","kicker":"...","circleLabel":"...","labels":["..."]}]} — ` +
        `include EVERY shot you changed; you MUST change any literal mundane-object title.`,
      maxTokens: 1500,
      temperature: 0.2,
    });
    let n = 0;
    for (const f of res.fixes ?? []) {
      const s = plan.shots[f.i];
      if (!s) continue;
      if (f.title !== undefined) { s.title = f.title || undefined; n++; }
      if (f.kicker !== undefined) { s.kicker = f.kicker || undefined; n++; }
      if (f.circleLabel !== undefined) { s.circleLabel = f.circleLabel || undefined; n++; }
      if (f.labels !== undefined && s.labels) { s.labels = f.labels.map((t, k) => ({ ...s.labels![k], text: t })).filter((l) => l.text); n++; }
    }
    if (n) log?.(`documotion label lint: rewrote ${n} on-screen text item(s)`);
  } catch (e) {
    log?.(`documotion label lint skipped (${e instanceof Error ? e.message : e})`);
  }
}

/* ---------------------------------------------------------------- assets -- */

/** Downscale + recompress for sane inputProps size (keeps alpha for png). */
async function normalizeAsset(rawPath: string, outPath: string, maxW: number): Promise<string> {
  const vf = `scale='min(${maxW},iw)':-2`;
  if (outPath.endsWith(".png")) await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", vf, outPath]);
  else await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", vf, "-q:v", "4", outPath]);
  return outPath;
}

async function downloadTo(url: string, outPath: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
}

/** BiRefNet background removal via fal.ai → alpha PNG. v2 first, then v1. */
async function removeBackground(imgPath: string, outPng: string, log?: Logger): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("documotion: FAL_KEY missing (vault service 'fal')");
  const dataUri = `data:image/jpeg;base64,${(await readFile(imgPath)).toString("base64")}`;
  let lastErr = "";
  for (const ep of ["fal-ai/birefnet/v2", "fal-ai/birefnet"]) {
    try {
      const res = await fetch(`https://fal.run/${ep}`, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ image_url: dataUri }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = (await res.json()) as { image?: { url?: string } };
      if (!res.ok) { lastErr = `${ep} HTTP ${res.status}`; continue; }
      const url = j?.image?.url;
      if (!url) { lastErr = `${ep}: no url`; continue; }
      await downloadTo(url, outPng);
      return outPng;
    } catch (e) {
      lastErr = `${ep}: ${e instanceof Error ? e.message : e}`;
    }
  }
  throw new Error(`documotion: background removal failed (${lastErr})`);
}

/**
 * Turn ONE still into 2.5D: get its depth map, then cut a feathered NEAR layer
 * (alpha PNG) from the brightest (nearest) depth band over the full base. The
 * renderer parallaxes near-over-base for a camera-through-photo move. Best
 * effort — returns [] on any failure so the shot degrades to a Ken Burns push.
 */
async function deriveDepthLayers(baseImg: string, outDir: string, shotIdx: number, log?: Logger): Promise<string[]> {
  if (!process.env.FAL_KEY) return [];
  try {
    const dataUri = `data:image/jpeg;base64,${(await readFile(baseImg)).toString("base64")}`;
    const depthPath = join(outDir, `s${shotIdx}_depth.png`);
    await getDepthMap(dataUri, depthPath, log ?? (() => {}));
    const nearPng = join(outDir, `s${shotIdx}_near.png`);
    // depth.ts convention: BRIGHTER = NEARER. Threshold the near band, feather,
    // scale the mask to the base, alpha-merge onto the base.
    await run(ffmpegBin(), [
      "-y",
      "-i",
      baseImg,
      "-i",
      depthPath,
      "-filter_complex",
      // Soft, wide feather on the near/far boundary so the depth cut never
      // reads as a hard seam; scale the mask to the base, then alpha-merge.
      "[1:v]format=gray,lutyuv=y='if(gt(val,130),255,0)',gblur=sigma=14[mtmp];" +
        "[mtmp][0:v]scale2ref=flags=bilinear[m][base];" +
        "[base][m]alphamerge,format=rgba[o]",
      "-map",
      "[o]",
      nearPng,
    ]);
    log?.(`documotion depth: near layer for shot ${shotIdx}`);
    return [nearPng];
  } catch (e) {
    log?.(`documotion depth: shot ${shotIdx} fell back to Ken Burns (${e instanceof Error ? e.message : e})`);
    return [];
  }
}

interface AssetGate {
  styleOk?: boolean;
  briefOk?: boolean;
  noText?: boolean;
  framingOk?: boolean;
  fix?: string;
}

/** Per-still vision gate — catches weird crops/text/style drift before assembly. */
async function gateAsset(path: string, role: DocuAssetRole, brief: string, worldHint: string): Promise<AssetGate> {
  const framingAsk =
    role === "fg"
      ? "framingOk: ONE subject, head/shoulders/arms inside frame (only bottom may crop), plain backdrop, not weirdly cropped?"
      : role === "cutout"
        ? "framingOk: single object fully inside frame on a plain background?"
        : "framingOk: clear focal hierarchy, no awkward crops of faces/subjects at the frame edge?";
  // objects legitimately carry markings (banknotes, signage) — exempt cutouts from noText
  const textAsk = role === "cutout" ? "noText: no large caption/watermark added over the object?" : "noText: ZERO letters/numbers/captions/borders baked in?";
  const raw = await geminiVisionLocal({
    prompt:
      `ASSET GATE for ${worldHint}. Brief: "${brief.slice(0, 280)}". ` +
      `Judge: 1. styleOk: matches that world's look (not generic/glossy)? 2. briefOk: depicts the brief? ` +
      `3. ${textAsk} 4. ${framingAsk} ` +
      `Return STRICT JSON {"styleOk":bool,"briefOk":bool,"noText":bool,"framingOk":bool,"fix":"<=14 words"}.`,
    imagePaths: [path],
    json: true,
    maxTokens: 250,
  }).catch(() => "");
  return raw ? parseJsonLoose<AssetGate>(raw) : {};
}

export interface DocuAssetFile {
  shotIdx: number;
  id: string;
  role: DocuAssetRole;
  path: string;
}

interface AssetJob {
  shotIdx: number;
  brief: DocuAssetBrief;
}

/**
 * Generate every still — gated, in a concurrency pool. Cached: existing files
 * are kept (delete a file, or pass a fixNote "shotIdx:id", to regenerate).
 */
export async function generateDocuAssets(
  plan: DocuPlan,
  style: DocuStyleDef,
  assetsDir: string,
  log?: Logger,
  fixNotes?: Record<string, string>,
): Promise<DocuAssetFile[]> {
  await mkdir(assetsDir, { recursive: true });
  const jobs: AssetJob[] = [];
  for (const [i, shot] of plan.shots.entries()) for (const a of shot.assets ?? []) jobs.push({ shotIdx: i, brief: a });

  const out = await pool(jobs, ASSET_CONCURRENCY, async ({ shotIdx: i, brief: a }) => {
    const keyId = `${i}:${a.id}`;
    const needsAlpha = a.role === "fg" || a.role === "cutout";
    const finalPath = join(assetsDir, `s${i}_${a.id}${needsAlpha ? ".png" : ".jpg"}`);
    const externalFix = fixNotes?.[keyId];
    if (existsSync(finalPath) && !externalFix) return { shotIdx: i, id: a.id, role: a.role, path: finalPath };

    const framing = style.roleFraming[a.role];
    const rawPath = join(assetsDir, `s${i}_${a.id}_raw.jpg`);
    let got = false;

    // ARCHIVAL source: a real Wikimedia photograph of a named entity.
    if (a.source === "archival" && a.query && !externalFix) {
      try {
        const url = await searchWikimediaImageUrl(a.query);
        if (url) {
          await downloadTo(url, rawPath);
          got = true;
          log?.(`documotion asset s${i}/${a.id}: archival "${a.query}" via Wikimedia`);
        }
      } catch {
        /* fall through to generate */
      }
    }

    // GENERATE source (default + archival fallback): Banana behind the gate.
    if (!got) {
      // Crisp by default; depth_parallax plates must be FULLY in focus so the
      // engine's 2.5D parallax supplies the depth (baked bokeh fights it +
      // leaves focus-edge artefacts when the layers move).
      const QUALITY = " Ultra-sharp, crisp, high detail, no motion blur.";
      const focus =
        plan.shots[i].kind === "depth_parallax"
          ? " CRITICAL: the ENTIRE frame is in SHARP focus front-to-back (deep depth of field) — NO bokeh, NO background blur, NO lens blur; the depth must read from layout/scale, never from focus."
          : "";
      let fix = externalFix ?? "";
      let accepted = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt = `${framing.prefix}${a.brief}.${style.stillStyle}${QUALITY}${focus}` + (fix ? ` CRITICAL FIX FROM THE LAST ATTEMPT: ${fix}.` : "");
        log?.(`documotion asset s${i}/${a.id} (${a.role})${fix ? ` [retry]` : ""}…`);
        const bytes = await generateBananaImage({ prompt, aspectRatio: framing.ar });
        await writeFile(rawPath, bytes);
        const gate = await gateAsset(rawPath, a.role, a.brief, style.label);
        if (gate.styleOk !== false && gate.briefOk !== false && gate.noText !== false && gate.framingOk !== false) {
          accepted = true;
          break;
        }
        fix = gate.fix || "cleaner framing, authentic style, absolutely no text";
        log?.(`documotion asset s${i}/${a.id} gate REJECTED (style=${gate.styleOk} brief=${gate.briefOk} noText=${gate.noText} framing=${gate.framingOk})`);
      }
      if (!accepted) log?.(`documotion asset s${i}/${a.id}: shipping last attempt (logged, not silent)`);
    }

    if (needsAlpha) {
      const cutRaw = join(assetsDir, `s${i}_${a.id}_cut.png`);
      await removeBackground(rawPath, cutRaw, log);
      await normalizeAsset(cutRaw, finalPath, 1100);
    } else {
      await normalizeAsset(rawPath, finalPath, 1280);
    }
    return { shotIdx: i, id: a.id, role: a.role, path: finalPath };
  });

  // depth_parallax: derive the near 2.5D layer from each scene's base image and
  // append it (after the base) so buildShotSpecs orders [base, near]. Cached.
  for (const [i, shot] of plan.shots.entries()) {
    if (shot.kind !== "depth_parallax") continue;
    const baseFile = out.find((a) => a.shotIdx === i && a.role === "image");
    if (!baseFile) continue;
    const nearPath = join(assetsDir, `s${i}_near.png`);
    if (existsSync(nearPath) && !fixNotes?.[`${i}:${baseFile.id}`]) {
      out.push({ shotIdx: i, id: `${baseFile.id}_near`, role: "image", path: nearPath });
      continue;
    }
    const layers = await deriveDepthLayers(baseFile.path, assetsDir, i, log);
    for (const p of layers) out.push({ shotIdx: i, id: `${baseFile.id}_near`, role: "image", path: p });
  }

  log?.(`documotion assets: ${out.length} ready`);
  return out;
}

/* ------------------------------------------------------- specs + overrides -- */

export interface ShotOverride {
  titleBoost?: number;
  labelPos?: DocuLabelPos;
  camera?: DocuCamera;
  durationSec?: number;
}
export type DocuOverrides = Record<number, ShotOverride>;

function dataUri(path: string, bytes: Buffer): string {
  return `data:${path.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`;
}

/** Assemble renderer props: plan + assets + overrides → DocuShotSpec[].
 * Durations are normalised so the timeline sums exactly to durationSec. */
export async function buildShotSpecs(
  plan: DocuPlan,
  assets: DocuAssetFile[],
  durationSec: number,
  overrides: DocuOverrides = {},
  geoByShot: Record<number, CityGeo> = {},
  typeByShot: Record<number, string> = {},
): Promise<DocuShotSpec[]> {
  const cache = new Map<string, string>();
  const uri = async (p: string) => {
    if (!cache.has(p)) cache.set(p, dataUri(p, await readFile(p)));
    return cache.get(p)!;
  };
  const durs = plan.shots.map((s, i) => Math.max(3, Math.min(10, overrides[i]?.durationSec ?? s.durationSec ?? 7)));
  const norm = durationSec / durs.reduce((a, b) => a + b, 0);
  const specs: DocuShotSpec[] = [];
  for (const [i, s] of plan.shots.entries()) {
    const mine = assets.filter((a) => a.shotIdx === i);
    const byRole = async (role: DocuAssetRole) => Promise.all(mine.filter((a) => a.role === role).map((a) => uri(a.path)));
    const [bgs, fgs, images, cutouts] = await Promise.all([byRole("bg"), byRole("fg"), byRole("image"), byRole("cutout")]);
    const o = overrides[i] ?? {};
    specs.push({
      kind: s.kind,
      durationInFrames: Math.max(36, Math.round(durs[i] * norm * FPS)),
      camera: o.camera ?? s.camera,
      bg: bgs[0],
      fg: fgs[0],
      images: images.length ? images : undefined,
      cutouts: cutouts.length ? cutouts : undefined,
      title: s.title,
      kicker: s.kicker,
      labels: s.labels,
      labelPos: o.labelPos,
      annotations: s.annotations,
      circleLabel: s.circleLabel,
      quote: s.quote,
      attribution: s.attribution,
      accent: s.accent,
      titleBoost: o.titleBoost,
      threads: s.threads,
      geo: geoByShot[i],
      typeImage: typeByShot[i] ? await uri(typeByShot[i]) : undefined,
      rackFocus: s.rackFocus,
    });
  }
  return specs;
}

/* --------------------------------------------------------------- verifier -- */

export interface RefineAction {
  type: "regen_asset" | "emphasize_text" | "reposition_labels" | "retime" | "camera";
  shot: number;
  asset?: string;
  fix?: string;
  to?: DocuLabelPos;
  durationSec?: number;
  move?: DocuCamera["move"];
  intensity?: DocuCamera["intensity"];
}

export interface DocuVerdict {
  typeCraft?: number;
  cutoutCraft?: number;
  composition?: number;
  legibility?: number;
  styleMatch?: number;
  cohesion?: number;
  pass?: boolean;
  actions?: RefineAction[];
  note?: string;
}

const VERIFIER_DOCTRINE =
  `HOW THIS ENGINE WORKS (critical): the ONLY assets are PHOTOGRAPHS and background PLATES. ALL text — titles, ` +
  `kickers, labels, evidence tags, quotes, attributions — and the red string, pushpins, highlight boxes, dividers, ` +
  `torn edges and tape are rendered by the ENGINE on TOP of the images. They are NEVER part of any image. So:\n` +
  `• NEVER use regen_asset to add, fix, spell or change TEXT — no image should ever contain text.\n` +
  `• regen_asset is ONLY for a PHOTOGRAPH/PLATE whose subject, style or framing is wrong (wrong content, glossy/` +
  `modern look, a person awkwardly cropped, a half-dissolved/ragged cutout edge). Reference only asset ids that ` +
  `exist for that shot (bg, fg, img1, img2…, cutout1…). Do not invent ids.\n` +
  `• If a TITLE/LABEL/QUOTE is too small or low-contrast, use emphasize_text (the engine enlarges it + strengthens ` +
  `its scrim). Titles are AUTO-FIT to the frame. A hero cutout that tucks the FIRST 1-3 characters of a name/title ` +
  `behind it is the INTENDED style — never call that truncation or a type defect; only flag if the PAYOFF (last) ` +
  `word is cut off at the frame edge.\n` +
  `• evidence_board / collage_pan stills are a moving camera — a still may frame ONE pinned photo or part of the ` +
  `board; that is correct. Judge the photo + red-string + cutout quality, not "missing" other elements.\n` +
  `• Do NOT nitpick photographic taste. regen_asset ONLY for a CLEAR defect: wrong subject, a ragged/half-cut ` +
  `cutout edge, baked-in text on a PHOTO/PLATE, or a plate that is essentially black/empty. A merely "stylised" or ` +
  `"staged" photo is fine.\n` +
  `• EXCEPTION — a quote_card / closing card MAY be a fully DESIGNED TYPOGRAPHIC image (the closing line rendered as ` +
  `bespoke lettering). Baked lettering is INTENTIONAL there — judge it as typography (legible? on-style?), NEVER flag ` +
  `it as a baked-text violation and never try to regen it.`;

const VERIFIER_CHECKLIST =
  `THE CRAFT CHECKLIST:\n` +
  `1. TYPE: engine headlines HUGE (>=12% of frame height), readable at a glance, never lost in a busy plate; a ` +
  `headline's first characters may tuck behind a foreground cutout (the style) but stay recognisable. 2. CUTOUTS: ` +
  `hero/object cutouts read as INTENTIONAL die-cut pieces — clean edges, no half-dissolved subjects, clear ` +
  `separation from the plate. 3. COMPOSITION: one clear focal point, breathing room, nothing important buried, ` +
  `labels not colliding with faces/titles. 4. STYLE: cohesive world — same palette/grade/grain across shots. ` +
  `5. TEXT LAYOUT (legibility): NO two text blocks may overlap, touch or stack on top of one another — the engine ` +
  `headline/title, the kicker, every label and annotation, the quote and its attribution each sit in their OWN clear ` +
  `space with a visible gap. The lower-third title must never run into the label rail or bury a cutout's readable ` +
  `face; stacked labels must not overprint. ANY overlap, touching or unreadable pile-up of text = legibility <=4 + a ` +
  `reposition_labels action. (A headline whose first 1-3 characters tuck behind a hero cutout is the intended style, ` +
  `NOT an overlap.) ` +
  `6. Each frame is labelled with shot index, kind and camera move.`;

/** Score one still per shot and emit typed, actionable critique. */
export async function verifyDocu(args: {
  framePaths: string[];
  labels: string[];
  worldHint: string;
  log?: Logger;
}): Promise<DocuVerdict> {
  const raw = await geminiVisionLocal({
    prompt:
      `You are the FILM VERIFIER for a ${args.worldHint} motion engine. One frame per shot, in order:\n` +
      `${args.labels.join("\n")}\n${VERIFIER_DOCTRINE}\n${VERIFIER_CHECKLIST}\n` +
      `Score 1-10: typeCraft, cutoutCraft, composition, legibility, styleMatch, cohesion. pass = every score >=7 ` +
      `(legibility drops below 7 whenever any two text blocks overlap or touch).\n` +
      `Then emit ACTIONS — only real problems, max 6, the MOST actionable fix per problem (obey the doctrine above):\n` +
      `- {"type":"regen_asset","shot":n,"asset":"<existing id: bg/fg/img1/cutout1>","fix":"<=14 words, PHOTO content/style/framing only, never text"}\n` +
      `- {"type":"emphasize_text","shot":n}  (type too small / weak contrast)\n` +
      `- {"type":"reposition_labels","shot":n,"to":"top_right|bottom_left|bottom_center"}  (text overlap / colliding labels — move the rail to clear space)\n` +
      `- {"type":"retime","shot":n,"durationSec":n}\n` +
      `- {"type":"camera","shot":n,"move":"push_in|pull_back|pan_left|pan_right|drift","intensity":"subtle|medium|strong"}\n` +
      `Return STRICT JSON {"typeCraft":n,"cutoutCraft":n,"composition":n,"legibility":n,"styleMatch":n,"cohesion":n,"pass":bool,"actions":[...],"note":"<=25 words"}.`,
    imagePaths: args.framePaths,
    json: true,
    model: "gemini-3.1-pro-preview",
    maxTokens: 6000,
  }).catch(() => "");
  const v: DocuVerdict = raw ? parseJsonLoose<DocuVerdict>(raw) : {};
  // HARD legibility gate — overlapping text must never ship silently. Recompute
  // pass from all six craft scores so a generous model-assigned pass can't mask
  // a text collision (the failure mode that let a stale render go out).
  const scores = [v.typeCraft, v.cutoutCraft, v.composition, v.legibility, v.styleMatch, v.cohesion];
  if (scores.every((s) => typeof s === "number")) v.pass = (scores as number[]).every((s) => s >= 7);
  args.log?.(
    `documotion verify: type=${v.typeCraft} cutout=${v.cutoutCraft} comp=${v.composition} legib=${v.legibility} style=${v.styleMatch} cohesion=${v.cohesion} pass=${v.pass} actions=${v.actions?.length ?? 0}${v.note ? ` — ${v.note}` : ""}`,
  );
  return v;
}

/** Apply verifier actions: mutate overrides + collect asset regen notes. */
export function applyActions(actions: RefineAction[], overrides: DocuOverrides, log?: Logger): { overrides: DocuOverrides; assetFixes: Record<string, string> } {
  const assetFixes: Record<string, string> = {};
  // Hard guard: text lives in engine overlays, never in images. A regen whose
  // fix is about text would make Banana bake letters into a plate — convert it
  // to a text emphasis instead.
  const TEXT_FIX = /\b(text|title|label|caption|word|words|spell|spelling|letter|heading|headline|quote|name|legible|readable|truncat)/i;
  for (const a of actions ?? []) {
    if (typeof a.shot !== "number") continue;
    const o = (overrides[a.shot] ??= {});
    let type = a.type;
    if (type === "regen_asset" && (!a.asset || (a.fix && TEXT_FIX.test(a.fix)))) {
      type = "emphasize_text";
      log?.(`documotion refine: regen_asset on shot ${a.shot} rewritten to emphasize_text (text is an overlay, not an image)`);
    }
    switch (type) {
      case "regen_asset":
        if (a.asset && a.fix) assetFixes[`${a.shot}:${a.asset}`] = a.fix;
        break;
      case "emphasize_text":
        o.titleBoost = Math.min(1.35, (o.titleBoost ?? 1) * 1.16);
        break;
      case "reposition_labels":
        if (a.to) o.labelPos = a.to;
        break;
      case "retime":
        if (a.durationSec) o.durationSec = Math.max(3, Math.min(10, a.durationSec));
        break;
      case "camera":
        if (a.move && a.intensity) o.camera = { move: a.move, intensity: a.intensity };
        break;
    }
    log?.(`documotion refine: ${type} shot ${a.shot}${type === "regen_asset" && a.asset ? `/${a.asset}` : ""}${type === "regen_asset" && a.fix ? ` (${a.fix})` : ""}`);
  }
  return { overrides, assetFixes };
}

/** Render one verifier still per shot (fast — no full video) + build labels. */
async function renderVerifySet(args: {
  plan: DocuPlan;
  specs: DocuShotSpec[];
  style: DocuStyleDef;
  framesDir: string;
  log?: Logger;
}): Promise<{ framePaths: string[]; labels: string[] }> {
  const { plan, specs, style, framesDir, log } = args;
  await mkdir(framesDir, { recursive: true });
  const frames: number[] = [];
  const outPaths: string[] = [];
  const labels: string[] = [];
  // Sample at the most REPRESENTATIVE moment per kind: panning/board shots are
  // sampled early (wide establishing — title + whole composition visible),
  // others mid-shot once everything has animated in.
  const sampleFrac = (k: DocuShotKind): number =>
    k === "evidence_board" ? 0.16 : k === "collage_pan" ? 0.22 : k === "geo_map" ? 0.78 : 0.55;
  let cursor = 0;
  for (const [i, spec] of specs.entries()) {
    frames.push(Math.round(cursor + spec.durationInFrames * sampleFrac(plan.shots[i].kind)));
    cursor += spec.durationInFrames;
    outPaths.push(join(framesDir, `s${i}.jpg`));
    const s = plan.shots[i];
    labels.push(
      `[shot ${i}] ${s.kind}, ${Math.round(spec.durationInFrames / FPS)}s, camera ${spec.camera?.move}/${spec.camera?.intensity}` +
        (s.title ? `, title "${s.title}"` : "") +
        (s.labels?.length ? `, labels ${s.labels.map((l) => `"${l.text}"`).join("+")}` : ""),
    );
  }
  await renderDocuStills({
    shots: specs,
    frames,
    outPaths,
    width: 960,
    height: 540,
    theme: style.theme,
    fontCss: style.fontCss,
    fontProbe: style.fontProbe,
    log,
  });
  return { framePaths: outPaths, labels };
}

/* ------------------------------------------------------------ orchestrate -- */

export interface CraftDocuArgs {
  topic: string;
  /** Channel world id (src/remotion/docuStyles.ts). Default archival_collage. */
  style?: string;
  referenceNotes?: string;
  durationSec?: number;
  runDir: string;
  outPath?: string;
  /** Verifier refine rounds before the final render (default 2). */
  maxRefineRounds?: number;
  /** Final render parallelism (default cores-2 on the host). */
  concurrency?: number;
  log?: Logger;
}

export interface CraftDocuResult {
  outPath: string;
  plan: DocuPlan;
  verdict: DocuVerdict;
  rounds: number;
}

/** The full visual engine — see module header. */
export async function craftDocuMotion(args: CraftDocuArgs): Promise<CraftDocuResult> {
  const log = args.log ?? (() => {});
  const durationSec = args.durationSec ?? 60;
  const runDir = args.runDir;
  const maxRounds = args.maxRefineRounds ?? 2;
  const style = getStyle(args.style);
  await mkdir(runDir, { recursive: true });

  // 1. PLAN (cached)
  const planPath = join(runDir, "plan.json");
  let plan: DocuPlan;
  if (existsSync(planPath)) {
    plan = JSON.parse(await readFile(planPath, "utf8")) as DocuPlan;
    log(`documotion: plan loaded from cache (${plan.shots.length} shots, style ${plan.styleId})`);
  } else {
    plan = await planDocu({ topic: args.topic, style, referenceNotes: args.referenceNotes, durationSec, log });
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  }

  // 2. ASSETS (gated, pooled, cached) + GEO geometry for any geo_map shots
  let assets = await generateDocuAssets(plan, style, join(runDir, "assets"), log);
  const geoByShot: Record<number, CityGeo> = {};
  for (const [i, s] of plan.shots.entries()) {
    if (s.kind === "geo_map" && s.geoQuery) geoByShot[i] = await fetchCityGeo(s.geoQuery, join(runDir, "geo"), log);
  }
  // Bespoke Banana-designed typography for the hero end card(s) — unique
  // lettering instead of a web font; gated for spelling, CSS fallback.
  const typeByShot: Record<number, string> = {};
  for (const [i, s] of plan.shots.entries()) {
    if (s.kind !== "quote_card" || !s.quote) continue;
    const out = join(runDir, "assets", `type_${i}.jpg`);
    if (existsSync(out)) {
      typeByShot[i] = out;
      continue;
    }
    // REASONABILITY PASS — choose emphasis + framing so the card lands with the
    // right TONE: a mundane/comical detail must not become the epic gold payoff;
    // emphasise the words carrying the irony or stakes, frame the rest deadpan.
    const reason = await geminiJson<{ emphasis?: string[]; framing?: string }>({
      prompt:
        `A documentary CLOSING TYPE CARD will render this exact line as bold designed typography (style: ${style.typeStyle}): ` +
        `"${s.quote}". Decide how to frame it TASTEFULLY. Pick EMPHASIS = the 1-3 words that should be largest/accented — ` +
        `the words carrying the IRONY, STAKES or turn — NOT a mundane or comical noun blown up comically. Write a FRAMING ` +
        `note (<=22 words) so the tone is right: if part of the line is deliberately mundane/absurd, render it deadpan and ` +
        `smaller so the CONTRAST lands instead of reading as slapstick. ` +
        `Return STRICT JSON {"emphasis":["..."],"framing":"..."}.`,
      maxTokens: 300,
      temperature: 0.3,
    }).catch(() => ({ emphasis: undefined, framing: undefined }) as { emphasis?: string[]; framing?: string });
    const emphasis = reason.emphasis?.length ? reason.emphasis : s.quote.split(/\s+/).filter(Boolean).slice(0, 2);
    log(`documotion type card: emphasis [${emphasis.join(", ")}]${reason.framing ? ` — ${reason.framing}` : ""}`);
    const made = await bananaTypeCard({
      text: s.quote,
      emphasis,
      framing: reason.framing,
      styleDesc: style.typeStyle,
      accent: s.accent ?? style.theme.accent,
      outJpg: out,
      log,
    });
    if (made) typeByShot[i] = made;
  }

  // 3. VERIFY & REFINE on fast stills
  const overridesPath = join(runDir, "overrides.json");
  let overrides: DocuOverrides = existsSync(overridesPath) ? (JSON.parse(await readFile(overridesPath, "utf8")) as DocuOverrides) : {};
  let verdict: DocuVerdict = {};
  let rounds = 0;
  for (let round = 1; round <= maxRounds + 1; round++) {
    const specs = await buildShotSpecs(plan, assets, durationSec, overrides, geoByShot, typeByShot);
    const { framePaths, labels } = await renderVerifySet({ plan, specs, style, framesDir: join(runDir, `verify_r${round}`), log });
    verdict = await verifyDocu({ framePaths, labels, worldHint: style.label, log });
    rounds = round;
    if (verdict.pass || round > maxRounds || !verdict.actions?.length) break;
    const applied = applyActions(verdict.actions, overrides, log);
    overrides = applied.overrides;
    await writeFile(overridesPath, JSON.stringify(overrides, null, 2), "utf8");
    if (Object.keys(applied.assetFixes).length) assets = await generateDocuAssets(plan, style, join(runDir, "assets"), log, applied.assetFixes);
  }
  if (!verdict.pass) log(`documotion: verifier unsatisfied after ${rounds} rounds — shipping with honest verdict`);

  // 4. FINAL 1080p master
  const specs = await buildShotSpecs(plan, assets, durationSec, overrides, geoByShot, typeByShot);
  const outPath = args.outPath ?? join(runDir, "final.mp4");
  await renderDocuMotion({
    shots: specs,
    outPath,
    width: 1920,
    height: 1080,
    theme: style.theme,
    fontCss: style.fontCss,
    fontProbe: style.fontProbe,
    // Cap concurrency (env override) — geo_map/parallax frames are RAM-heavy at
    // 1080p and the default (half-cores) can OOM a shared box.
    concurrency: args.concurrency ?? (process.env.DOCU_RENDER_CONCURRENCY ? Number(process.env.DOCU_RENDER_CONCURRENCY) : 3),
    log,
  });
  log(`documotion: final rendered ${outPath}`);
  return { outPath, plan, verdict, rounds };
}
