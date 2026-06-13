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
import { geminiJsonPro, geminiVisionLocal, parseJsonLoose } from "@/lib/gemini";
import { generateBananaImage } from "@/lib/banana";
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
  map_zoom: { bg: [1, 1] },
  photo_slide: { bg: [1, 1], image: [2, 3] },
  matte_sequence: { image: [3, 4] },
  collage_pan: { bg: [0, 1], image: [6, 8] },
  evidence_board: { bg: [0, 1], image: [3, 6] },
  object_drop: { bg: [1, 1], fg: [0, 1], cutout: [1, 3] },
  quote_card: { bg: [0, 1] },
};

const CAMERA_MOVES = ["push_in", "pull_back", "pan_left", "pan_right", "drift"];
const CAMERA_INTENSITIES = ["subtle", "medium", "strong"];

function validatePlan(plan: DocuPlan, durationSec: number, style: DocuStyleDef): string[] {
  const problems: string[] = [];
  if (!plan.shots?.length || plan.shots.length < 5) problems.push("need 6-8 shots");
  const allowed = new Set(style.shotKinds);
  for (const [i, s] of (plan.shots ?? []).entries()) {
    if (!KIND_ASSETS[s.kind]) {
      problems.push(`shot ${i}: unknown kind "${s.kind}"`);
      continue;
    }
    if (!allowed.has(s.kind)) problems.push(`shot ${i}: kind "${s.kind}" not in this style (use ${style.shotKinds.join("|")})`);
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
  }
  const total = (plan.shots ?? []).reduce((a, s) => a + (s.durationSec || 0), 0);
  if (Math.abs(total - durationSec) > durationSec * 0.15) problems.push(`durations sum ${total}s, target ${durationSec}s (±15%)`);
  return problems;
}

function planContract(style: DocuStyleDef): string {
  return `Return STRICT JSON:
{
 "title": "video title",
 "styleId": "${style.id}",
 "shots": [
   {
     "kind": one of [${style.shotKinds.join(", ")}],
     "beat": "one sentence: what this shot communicates",
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
     "assets": [{"id":"bg","role":"bg|fg|image|cutout","brief":"vivid period/world-correct description, NO text in image","source":"generate|archival","query":"<entity name if source=archival>"}]
   }
 ]
}
ASSET CONTRACT per kind (exact roles): parallax_portrait: 1 bg (wide environment plate, calm centre for big type) + 1 fg (the protagonist ALONE, head/shoulders/arms inside frame, plain backdrop). map_zoom: 1 bg (aged map/chart of the region). photo_slide: 1 bg + 2-3 image. matte_sequence: 3-4 image (full-frame scenes). collage_pan: 1 bg + 6-8 image. evidence_board: optional 1 bg (cork/board) + 3-6 image (the pinned clues/suspects/photos). object_drop: 1 bg + 0-1 fg + 1-3 cutout (single object on white). quote_card: 0-1 bg.
SOURCE: use "archival" with a precise "query" ONLY for a real, famous, named person/place that Wikimedia certainly has (e.g. fg of "Henry Ford"); otherwise "generate".`;
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
  const base =
    `You are the showrunner + director of photography of ${style.worldDescription}\n` +
    `Design the first ${durationSec} seconds of a video about: ${topic}.\n` +
    (referenceNotes ? `REFERENCE (recreate this beat structure and visual grammar): ${referenceNotes}\n` : "") +
    `RULES: exactly ${shotsWanted} shots. Shot 1 = ${style.hookKind} HOOK. Last shot = ${style.closerKind} landing the ` +
    `point. Vary the kinds in between. CINEMATOGRAPHY: ${style.cinematography}\n` +
    `Asset briefs must be vivid, specific, world-correct, with strong tonal separation between subject and ` +
    `surroundings, and contain NO text/lettering in the image itself.\n${planContract(style)}`;

  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await geminiJsonPro<DocuPlan>({ prompt: base + feedback, maxTokens: 9000, temperature: 0.6, log });
    plan.styleId = style.id;
    lastProblems = validatePlan(plan, durationSec, style);
    if (!lastProblems.length) {
      log?.(`documotion plan [${style.id}]: "${plan.title}" — ${plan.shots.length} shots OK`);
      return plan;
    }
    log?.(`documotion plan attempt ${attempt + 1} rejected: ${lastProblems.join("; ")}`);
    feedback = `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly these: ${lastProblems.join("; ")}`;
  }
  throw new Error(`documotion: plan failed validation twice (${lastProblems.join("; ")})`);
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
      let fix = externalFix ?? "";
      let accepted = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt = `${framing.prefix}${a.brief}.${style.stillStyle}` + (fix ? ` CRITICAL FIX FROM THE LAST ATTEMPT: ${fix}.` : "");
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
  `its scrim). Titles are AUTO-FIT to the frame, so do not report truncation unless text is genuinely unreadable.\n` +
  `• evidence_board / collage_pan stills are a moving camera — a still may frame ONE pinned photo or part of the ` +
  `board; that is correct. Judge the photo + red-string + cutout quality, not "missing" other elements.`;

const VERIFIER_CHECKLIST =
  `THE CRAFT CHECKLIST:\n` +
  `1. TYPE: engine headlines HUGE (>=12% of frame height), readable at a glance, never lost in a busy plate; a ` +
  `headline's first characters may tuck behind a foreground cutout (the style) but stay recognisable. 2. CUTOUTS: ` +
  `hero/object cutouts read as INTENTIONAL die-cut pieces — clean edges, no half-dissolved subjects, clear ` +
  `separation from the plate. 3. COMPOSITION: one clear focal point, breathing room, nothing important buried, ` +
  `labels not colliding with faces/titles. 4. STYLE: cohesive world — same palette/grade/grain across shots. ` +
  `5. Each frame is labelled with shot index, kind and camera move.`;

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
      `Score 1-10: typeCraft, cutoutCraft, composition, styleMatch, cohesion. pass = every score >=7.\n` +
      `Then emit ACTIONS — only real problems, max 6, the MOST actionable fix per problem (obey the doctrine above):\n` +
      `- {"type":"regen_asset","shot":n,"asset":"<existing id: bg/fg/img1/cutout1>","fix":"<=14 words, PHOTO content/style/framing only, never text"}\n` +
      `- {"type":"emphasize_text","shot":n}  (type too small / weak contrast)\n` +
      `- {"type":"reposition_labels","shot":n,"to":"top_right|bottom_left|bottom_center"}\n` +
      `- {"type":"retime","shot":n,"durationSec":n}\n` +
      `- {"type":"camera","shot":n,"move":"push_in|pull_back|pan_left|pan_right|drift","intensity":"subtle|medium|strong"}\n` +
      `Return STRICT JSON {"typeCraft":n,"cutoutCraft":n,"composition":n,"styleMatch":n,"cohesion":n,"pass":bool,"actions":[...],"note":"<=25 words"}.`,
    imagePaths: args.framePaths,
    json: true,
    model: "gemini-3.1-pro-preview",
    maxTokens: 6000,
  }).catch(() => "");
  const v: DocuVerdict = raw ? parseJsonLoose<DocuVerdict>(raw) : {};
  args.log?.(
    `documotion verify: type=${v.typeCraft} cutout=${v.cutoutCraft} comp=${v.composition} style=${v.styleMatch} cohesion=${v.cohesion} pass=${v.pass} actions=${v.actions?.length ?? 0}${v.note ? ` — ${v.note}` : ""}`,
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
  const sampleFrac = (k: DocuShotKind): number => (k === "evidence_board" ? 0.16 : k === "collage_pan" ? 0.22 : 0.55);
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

  // 2. ASSETS (gated, pooled, cached)
  let assets = await generateDocuAssets(plan, style, join(runDir, "assets"), log);

  // 3. VERIFY & REFINE on fast stills
  const overridesPath = join(runDir, "overrides.json");
  let overrides: DocuOverrides = existsSync(overridesPath) ? (JSON.parse(await readFile(overridesPath, "utf8")) as DocuOverrides) : {};
  let verdict: DocuVerdict = {};
  let rounds = 0;
  for (let round = 1; round <= maxRounds + 1; round++) {
    const specs = await buildShotSpecs(plan, assets, durationSec, overrides);
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
  const specs = await buildShotSpecs(plan, assets, durationSec, overrides);
  const outPath = args.outPath ?? join(runDir, "final.mp4");
  await renderDocuMotion({
    shots: specs,
    outPath,
    width: 1920,
    height: 1080,
    theme: style.theme,
    fontCss: style.fontCss,
    fontProbe: style.fontProbe,
    concurrency: args.concurrency,
    log,
  });
  log(`documotion: final rendered ${outPath}`);
  return { outPath, plan, verdict, rounds };
}
