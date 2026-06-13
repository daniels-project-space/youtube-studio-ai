/**
 * CINECRAFT — the cinematic engine as ONE standalone module (golden-shaped,
 * like banana / scriptcraft / metacraft / topicraft / voicecraft / footagecraft).
 * It does ONE thing: turn a story into CONSISTENT cinematic VIDEO SHOTS. No
 * narration, no music, no SFX, no assembly — purely the generated visuals; a
 * pipeline layers audio + Remotion assembly on top later.
 *
 * GENERAL by design — it caters to the full range of generated-cinematic video,
 * not just photoreal period-drama:
 *   - SUBJECTS, not just people: a recurring CHARACTER, LOCATION, OBJECT or
 *     CREATURE is all "a consistent reference" and anchored the same way.
 *   - ANY STYLE: photoreal / anime / 3D / graphic-novel / painterly — resolved
 *     per niche from the CINEMATIC_DOCTRINE (golden.ts); the brief overrides.
 *   - ESTABLISHING / atmosphere shots with NO subject, and MULTI-subject shots.
 *
 * What it unlocks (each callable on its own):
 *   1. extractSubjects()  — the people + recurring places + key objects the
 *                           story needs (extractCast = the characters of those).
 *   2. designSubject()    — a hero + reference sheet (the ONE canonical anchor;
 *                           operator approves the hero). designCharacter alias.
 *   3. trainSoul()        — optional Higgsfield Soul ID; caller persists it.
 *   4. buildShotScript()  — per beat: subjects, setting, action, camera move,
 *                           lens, mood, transition + keyframe & i2v prompts.
 *   5. renderShot()       — the CONSISTENCY LAW: keyframe = the subject's hero
 *                           image as a DIRECT reference (NOT the soul — hero-
 *                           anchor scored 9/10 vs 2-6), prompt LEADS with the
 *                           identity lock + names distinctive features, a vision
 *                           gate re-rolls drift, then Seedance/Kling i2v.
 *   craftCinematicShots() — orchestrates 5 over a story's shots + subjects.
 *
 * Deps: Higgsfield CLI (HIGGSFIELD_LIVE=1) + GEMINI_API_KEY. PURE of Convex/R2 —
 * job ids / urls / paths in/out, injected worker `tmpDir` (never a dev box);
 * the caller owns the subject/soul registry + R2. Built on higgsfield.ts.
 *
 *   import { extractSubjects, designSubject, buildShotScript, renderShot,
 *            craftCinematicShots, hasCinecraft } from "@/lib/cinecraft";
 */
import { join } from "node:path";
import { runCli, HiggsfieldError } from "@/lib/higgsfield";
import { downloadTo } from "@/lib/files";
import { geminiJsonPro, geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { cinematicDoctrineFor, type CinematicDoctrine } from "@/engine/golden";

export { cinematicDoctrineFor, type CinematicDoctrine } from "@/engine/golden";

export function hasCinecraft(): boolean {
  return process.env.HIGGSFIELD_LIVE === "1" && hasGeminiKey();
}

/* ------------------------------- models -------------------------------- */

export const CINE_MODELS = {
  /** Hero + keyframes (subject-anchored via --image). */
  image: "nano_banana_2",
  /** Cheap i2v (camera via prompt). */
  i2v: "seedance1_5",
  /** i2v that takes start+end images (endframe chaining / continuity). */
  i2vChain: "kling3_0",
} as const;

export type SubjectKind = "character" | "location" | "object" | "creature";

/* ------------------------------- brief --------------------------------- */

export interface CinematicBrief {
  /** The story/topic (for subject + shot extraction). */
  story: string;
  /** Niche/genre, e.g. "true crime", "history", "fantasy", "tech explainer". */
  niche?: string;
  /** Period + place, e.g. "1925 Paris" (optional — modern/timeless are fine). */
  period?: string;
  /** Visual STYLE/medium override, e.g. "2D anime", "3D animated". Default = doctrine. */
  style?: string;
  /** Look/grade override. Default = doctrine. */
  look?: string;
  /** 16:9 (default) | 9:16. */
  aspect?: "16:9" | "9:16";
}

/** Resolve style + look + camera grammar (brief override → niche doctrine). */
export function resolveLook(brief: CinematicBrief): CinematicDoctrine & { archetype: string } {
  const d = cinematicDoctrineFor(brief.niche);
  return { ...d, style: brief.style ?? d.style, look: brief.look ?? d.look };
}

/* ------------------------------- subjects ------------------------------ */

/** A thing essential to the story, before any render. */
export interface SubjectSpec {
  name: string;
  kind: SubjectKind;
  /** Role in the story (protagonist, the bank, the murder weapon…). */
  role: string;
  /** How central — recurring leads/sets get designed + reused; one-offs may not. */
  importance: "lead" | "supporting" | "extra";
  /** A vivid, style-aware visual description used to render it consistently. */
  look: string;
}
/** @deprecated use SubjectSpec. */
export type CastMember = SubjectSpec;

/** A designed subject: the canonical reference every shot anchors to. */
export interface CinematicSubject extends SubjectSpec {
  /** The canonical HERO render's Higgsfield job id — the consistency anchor. */
  heroJobId: string;
  heroUrl: string;
  /** Extra angle/view job ids (sheet) — for approval + Soul training. */
  sheetJobIds: string[];
  /** Trained Soul ID (optional; characters/creatures only). */
  soulId?: string;
  /** The distinctive features every anchored prompt must name to lock identity. */
  anchorMarkers: string;
}
/** @deprecated use CinematicSubject. */
export type CinematicCharacter = CinematicSubject;

/** One cinematic shot the renderer obeys. */
export interface ShotSpec {
  id: number;
  beat: string;
  /** Subject name(s) present in the shot (must exist in the designed set; may be empty = establishing). */
  subjects: string[];
  setting: string;
  action: string;
  /** START-frame prompt (scene + pose + framing; identity is anchored separately). */
  keyframePrompt: string;
  cameraMove: string;
  lens: string;
  mood: string;
  /** Image-to-video motion prompt (camera move + action). */
  i2vPrompt: string;
  transition: string;
  durationSec: number;
  /** Optional per-shot i2v model override (e.g. kling for complex motion). */
  i2vModel?: string;
}

export interface RenderedShot {
  spec: ShotSpec;
  keyframeJobId: string;
  keyframeUrl: string;
  /** Vision consistency of the keyframe vs the anchor subject (0-10; 10 if no anchor). */
  consistencyScore: number;
  clipJobId: string;
  clipUrl: string;
}

/* ------------------------------ CLI helper ------------------------------ */

interface Job { id: string; result_url?: string; status?: string }

function firstJob(raw: unknown): Job {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw as Job] : [];
  const j = arr.find((x) => x && (x.result_url || x.id));
  if (!j) throw new HiggsfieldError(`no job in response: ${JSON.stringify(raw).slice(0, 160)}`);
  return j as Job;
}

async function hfGenerate(model: string, prompt: string, extra: string[], timeout = "12m"): Promise<Job> {
  const raw = await runCli(["generate", "create", model, ...extra, "--prompt", prompt, "--wait", "--wait-timeout", timeout, "--wait-interval", "5s"]);
  return firstJob(raw);
}

/** One image render, optionally anchored to a reference job id. */
async function image(prompt: string, brief: CinematicBrief, refJobId?: string): Promise<Job> {
  const extra = ["--aspect_ratio", brief.aspect ?? "16:9", ...(refJobId ? ["--image", refJobId] : [])];
  return hfGenerate(CINE_MODELS.image, prompt, extra, "6m");
}

/* ----------------------------- extraction ------------------------------ */

/**
 * Identify the SUBJECTS the story needs visually: the essential PEOPLE, the
 * recurring LOCATIONS/sets, and any key OBJECTS. Kind-tagged so the engine can
 * design + anchor each. Returns descriptions only — no renders yet.
 */
export async function extractSubjects(
  brief: CinematicBrief,
  opts?: { maxCharacters?: number; maxLocations?: number; log?: (m: string) => void },
): Promise<SubjectSpec[]> {
  if (!hasGeminiKey()) throw new Error("cinecraft.extractSubjects: GEMINI_API_KEY missing");
  const look = resolveLook(brief);
  const out = await geminiJsonPro<{ subjects?: SubjectSpec[] }>({
    prompt: [
      `You are casting a ${look.style} ${brief.niche ?? "documentary"} reconstruction${brief.period ? ` set in ${brief.period}` : ""}.`,
      `STORY:\n${brief.story.slice(0, 6000)}`,
      `Identify the SUBJECTS needed to tell this story visually:`,
      `- up to ${opts?.maxCharacters ?? 5} PEOPLE (kind "character"): the essential characters. A recurring central person = "lead" (gets a reusable reference); a one-or-two-scene person = "supporting"/"extra".`,
      `- up to ${opts?.maxLocations ?? 3} recurring LOCATIONS/sets (kind "location") that appear in multiple shots and must stay consistent.`,
      `- any KEY OBJECTS (kind "object") central to the story that recur.`,
      `For each: name, kind (character|location|object), role, importance (lead|supporting|extra), and a VIVID ${look.style} visual description a director would use to render it CONSISTENTLY (for people: age/build/face/hair/distinctive features/wardrobe; for places: architecture/era/layout/mood; for objects: form/material/markings). Honor the channel look: ${look.look}.`,
      `Return STRICT JSON {"subjects":[{"name","kind","role","importance","look"}]}.`,
    ].join("\n\n"),
    maxTokens: 2200,
    temperature: 0.5,
    log: opts?.log,
  });
  const subjects = (out.subjects ?? []).filter((c) => c?.name && c?.look && c?.kind).map((c) => ({ ...c, importance: c.importance ?? "supporting" }));
  opts?.log?.(`cinecraft: subjects = ${subjects.map((c) => `${c.name}[${c.kind}/${c.importance}]`).join(", ")}`);
  return subjects;
}

/** Characters only (back-compat convenience). */
export async function extractCast(brief: CinematicBrief, opts?: { max?: number; log?: (m: string) => void }): Promise<SubjectSpec[]> {
  return (await extractSubjects(brief, { maxCharacters: opts?.max, maxLocations: 0, log: opts?.log })).filter((s) => s.kind === "character");
}

/* ----------------------------- design ---------------------------------- */

/** The consistency-lock preamble every anchored keyframe prompt LEADS with. */
function consistencyLock(subject: { kind: SubjectKind; anchorMarkers: string }): string {
  const m = subject.anchorMarkers;
  switch (subject.kind) {
    case "location": return `This is the EXACT SAME place — identical architecture, layout and ${m}. Do NOT change the location. `;
    case "object": return `This is the EXACT SAME object — identical ${m}. Do NOT change it. `;
    default: return `This is the EXACT SAME ${subject.kind === "creature" ? "creature" : "person"} — identical form, ${m}. Do NOT change their identity. `;
  }
}

/** The hero-reference prompt seed by kind + style. */
function heroPrompt(spec: SubjectSpec, look: CinematicDoctrine): string {
  const s = `${look.style}, ${look.look}`;
  switch (spec.kind) {
    case "location":
      return `Cinematic establishing reference of a place/set: ${spec.look}. ${s}. Wide angle, clear architecture and layout, no people, even reference lighting, sharp focus.`;
    case "object":
      return `Cinematic reference of an object/prop: ${spec.look}. ${s}. Neutral backdrop, three-quarter view, clear material and detail, even lighting.`;
    default:
      return `Cinematic character reference portrait: ${spec.look}. ${s}, soft studio key light, plain neutral backdrop, head and shoulders, looking at camera, sharp focus, shallow depth of field.`;
  }
}

/** Sheet poses/views by kind (anchored to the hero so they stay consistent). */
function sheetViews(kind: SubjectKind, n: number): string[] {
  const character = [
    "Three-quarter view, confident, looking slightly off-camera.",
    "FULL-HEIGHT standing pose, entire body head to feet, hands relaxed.",
    "Strict side profile of head and shoulders.",
    "Serious, neutral expression, soft frontal light (clean reference).",
    "Subtle low angle, commanding.",
    "Looking down, focused.",
  ];
  const location = [
    "A different angle of the same place, wider.",
    "An interior/detail view of the same place.",
    "The same place in different light (dusk/overcast).",
    "A reverse angle of the same place.",
    "A high/overhead angle of the same place.",
  ];
  const object = [
    "A different angle (rotated) of the same object.",
    "A close-up detail of the same object.",
    "The same object held/in context.",
    "The same object from above.",
  ];
  const pool = kind === "location" ? location : kind === "object" ? object : character;
  return pool.slice(0, n);
}

async function distillMarkers(look: string, kind: SubjectKind): Promise<string> {
  const what = kind === "location" ? "place" : kind === "object" ? "object" : "person/creature";
  const out = await geminiJsonPro<{ markers?: string }>({
    prompt: `From this ${what} description, list the 3-5 MOST distinctive, identity-defining visual features as a short comma phrase a prompt can repeat to lock consistency (people: "thin mustache, slicked dark hair, charcoal suit"; places: "vaulted ceiling, green marble columns, brass sconces"; objects: "engraved silver lid, cracked leather strap"). Description: "${look}". Return STRICT JSON {"markers":string}.`,
    maxTokens: 200,
    temperature: 0.2,
  });
  return (out.markers ?? "").trim() || "the same distinctive features";
}

/**
 * Design a subject: render the canonical HERO, then N reference views anchored
 * to the hero (so it stays locked). Returns the subject for OPERATOR APPROVAL
 * before any Soul. Works for characters, locations and objects.
 */
export async function designSubject(
  spec: SubjectSpec,
  brief: CinematicBrief,
  opts?: { views?: number; log?: (m: string) => void },
): Promise<CinematicSubject> {
  if (!hasCinecraft()) throw new Error("cinecraft.designSubject: HIGGSFIELD_LIVE=1 + GEMINI required");
  const log = opts?.log ?? (() => {});
  const look = resolveLook(brief);
  const hero = await image(heroPrompt(spec, look), brief);
  log(`cinecraft: ${spec.name} [${spec.kind}] hero = ${hero.id}`);
  const markers = await distillMarkers(spec.look, spec.kind).catch(() => "the same distinctive features");
  const lock = consistencyLock({ kind: spec.kind, anchorMarkers: markers });
  const sheetJobIds: string[] = [];
  for (const view of sheetViews(spec.kind, opts?.views ?? 4)) {
    try {
      const j = await image(`${lock}${view} ${look.style}, ${look.look}.`, brief, hero.id);
      sheetJobIds.push(j.id);
    } catch (e) {
      log(`cinecraft: ${spec.name} sheet view failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
  }
  log(`cinecraft: ${spec.name} sheet = ${sheetJobIds.length} views`);
  return { ...spec, heroJobId: hero.id, heroUrl: hero.result_url ?? "", sheetJobIds, anchorMarkers: markers };
}

/** Design a character (back-compat alias for designSubject of kind character). */
export async function designCharacter(spec: SubjectSpec, brief: CinematicBrief, opts?: { angles?: number; log?: (m: string) => void }): Promise<CinematicSubject> {
  return designSubject({ ...spec, kind: spec.kind ?? "character" }, brief, { views: opts?.angles, log: opts?.log });
}

/* ------------------------------- soul ---------------------------------- */

/**
 * Train a Higgsfield Soul ID on a character/creature's sheet (download → upload
 * → soul-id create → wait). Optional — the hero-image anchor is what enforces
 * keyframe consistency; the Soul adds flexibility. Caller persists the id.
 */
export async function trainSoul(subject: CinematicSubject, o: { tmpDir: string; log?: (m: string) => void }): Promise<string> {
  if (!hasCinecraft()) throw new Error("cinecraft.trainSoul: HIGGSFIELD_LIVE=1 required");
  if (subject.kind !== "character" && subject.kind !== "creature") throw new Error("cinecraft.trainSoul: only characters/creatures get a Soul");
  const log = o.log ?? (() => {});
  const jobIds = [subject.heroJobId, ...subject.sheetJobIds];
  const list = (await runCli(["generate", "list", "--size", "60"])) as Job[];
  const url = new Map((Array.isArray(list) ? list : []).map((j) => [j.id, j.result_url]));
  const uploadIds: string[] = [];
  for (let i = 0; i < jobIds.length; i++) {
    const u = url.get(jobIds[i]);
    if (!u) continue;
    try {
      const local = join(o.tmpDir, `soul_${subject.name.replace(/\W+/g, "_")}_${i}.png`);
      await downloadTo(u, local);
      uploadIds.push(firstJob(await runCli(["upload", "create", local])).id);
    } catch (e) {
      log(`cinecraft: soul upload ${i} failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
  }
  if (uploadIds.length < 4) throw new Error(`cinecraft.trainSoul: only ${uploadIds.length} usable images (need ≥4)`);
  const soulId = firstJob(await runCli(["soul-id", "create", "--name", subject.name, "--soul-2", ...uploadIds.flatMap((u) => ["--image", u])])).id;
  log(`cinecraft: soul ${soulId} queued (${uploadIds.length} images) — training…`);
  await runCli(["soul-id", "wait", soulId, "--wait-timeout", "30m"]).catch(() => {});
  log(`cinecraft: soul ${soulId} trained for ${subject.name}`);
  return soulId;
}

/* ---------------------------- shot script ------------------------------ */

/**
 * Turn the story into a cinematic SHOT LIST with camera grammar (Gemini Pro
 * director), in the channel's style. Shots name their subjects (from the cast +
 * locations) and MAY be establishing shots with no subject.
 */
export async function buildShotScript(
  brief: CinematicBrief,
  subjects: SubjectSpec[],
  opts?: { shots?: number; log?: (m: string) => void },
): Promise<ShotSpec[]> {
  if (!hasGeminiKey()) throw new Error("cinecraft.buildShotScript: GEMINI_API_KEY missing");
  const n = opts?.shots ?? 8;
  const look = resolveLook(brief);
  const chars = subjects.filter((s) => s.kind === "character");
  const places = subjects.filter((s) => s.kind === "location");
  const out = await geminiJsonPro<{ shots?: ShotSpec[] }>({
    prompt: [
      `You are the DIRECTOR of a ${look.style} ${brief.niche ?? "documentary"} reconstruction${brief.period ? ` (${brief.period})` : ""}.`,
      `STYLE: ${look.style}. LOOK: ${look.look}. CAMERA GRAMMAR: ${look.cameraGrammar}. PACE: ${look.pace}.`,
      `STORY:\n${brief.story.slice(0, 6000)}`,
      chars.length ? `CHARACTERS (use exact names; consistent references exist — keep each identical every shot):\n${chars.map((c) => `- ${c.name}: ${c.look}`).join("\n")}` : "",
      places.length ? `RECURRING LOCATIONS (use exact names; keep consistent):\n${places.map((c) => `- ${c.name}: ${c.look}`).join("\n")}` : "",
      `Produce EXACTLY ${n} cinematic shots telling the story in order. Vary shot scale; include ESTABLISHING shots (a location/atmosphere with no character) where they help. Each shot = one continuous ~4-5s beat. For each: id, beat, subjects (the exact names present, characters and/or a location; EMPTY array for a pure atmosphere shot), setting, action, keyframePrompt (the START-FRAME scene + any subject's pose + framing + lighting in the channel style — do NOT redescribe a subject's identity; it is anchored elsewhere), cameraMove, lens (e.g. 35mm/50mm/85mm) + mood, i2vPrompt (motion: camera move + action), transition (cut/match-cut/whip/dip-to-black/continuous), durationSec (4-5).`,
      `Return STRICT JSON {"shots":[{id,beat,subjects,setting,action,keyframePrompt,cameraMove,lens,mood,i2vPrompt,transition,durationSec}]}.`,
    ].filter(Boolean).join("\n\n"),
    maxTokens: 6500,
    temperature: 0.7,
    log: opts?.log,
  });
  const shots = (out.shots ?? []).filter((s) => s?.keyframePrompt && s?.i2vPrompt).map((s, i) => ({ ...s, id: s.id ?? i + 1, durationSec: s.durationSec || 4, subjects: s.subjects ?? [] }));
  opts?.log?.(`cinecraft: ${shots.length} shots scripted (${shots.filter((s) => !s.subjects.length).length} establishing)`);
  return shots;
}

/* ------------------------------- render -------------------------------- */

/** Vision consistency gate: how well a keyframe matches the anchor's hero (0-10). */
async function consistencyScore(keyframeUrl: string, heroUrl: string, kind: SubjectKind, tmpDir: string, tag: string): Promise<number> {
  if (!hasGeminiKey() || !keyframeUrl || !heroUrl) return 10;
  try {
    const a = join(tmpDir, `anchor_${tag}.png`);
    const b = join(tmpDir, `kf_${tag}.png`);
    await Promise.all([downloadTo(heroUrl, a), downloadTo(keyframeUrl, b)]);
    const what = kind === "location" ? "the SAME place (same architecture/layout)" : kind === "object" ? "the SAME object" : "the SAME person (same face + distinctive features)";
    const raw = await geminiVisionLocal({
      prompt: `Image 1 is the canonical reference. Image 2 is a keyframe that must show ${what}. Return STRICT JSON {"match":0-10}.`,
      imagePaths: [a, b], json: true, maxTokens: 80,
    });
    const v = parseJsonLoose<{ match?: number }>(raw);
    return typeof v.match === "number" ? v.match : 8;
  } catch {
    return 8;
  }
}

/**
 * Render ONE shot under the consistency law. PRIMARY anchor = the first
 * character present (else the first location, else none → pure establishing).
 * The keyframe is the anchor's hero image as a DIRECT reference; the prompt
 * LEADS with the anchor's consistency lock, NAMES any other subjects + their
 * markers, applies the channel style, then the scene. A vision gate re-rolls on
 * drift. Seedance/Kling i2v then animates the locked keyframe. `tmpDir` = worker
 * scratch. `subjects` maps name → designed subject.
 */
export async function renderShot(
  shot: ShotSpec,
  subjects: Record<string, CinematicSubject>,
  o: { brief: CinematicBrief; tmpDir: string; i2vModel?: string; minConsistency?: number; maxRetries?: number; log?: (m: string) => void },
): Promise<RenderedShot> {
  if (!hasCinecraft()) throw new Error("cinecraft.renderShot: HIGGSFIELD_LIVE=1 + GEMINI required");
  const log = o.log ?? (() => {});
  const look = resolveLook(o.brief);
  const aspect = o.brief.aspect ?? "16:9";
  const present = (shot.subjects ?? []).map((n) => subjects[n]).filter(Boolean) as CinematicSubject[];
  const anchor = present.find((s) => s.kind === "character" || s.kind === "creature") ?? present[0];
  const others = present.filter((s) => s !== anchor);
  const stylePrefix = `${look.style}, ${look.look}. `;
  const otherClause = others.map((s) => `Also present: ${s.name} (${s.kind}) — ${s.anchorMarkers}. `).join("");
  const prompt = anchor
    ? `${consistencyLock(anchor)}${otherClause}${stylePrefix}${shot.keyframePrompt}`
    : `${stylePrefix}${shot.keyframePrompt}`; // pure establishing / atmosphere

  // 1) keyframe — anchored to the subject hero when there is one; vision-gated.
  const minC = o.minConsistency ?? 8;
  let best: Job | null = null;
  let bestScore = -1;
  for (let attempt = 0; attempt <= (o.maxRetries ?? (anchor ? 1 : 0)); attempt++) {
    const kf = await image(prompt, o.brief, anchor?.heroJobId);
    const score = anchor ? await consistencyScore(kf.result_url ?? "", anchor.heroUrl, anchor.kind, o.tmpDir, `${shot.id}_${attempt}`) : 10;
    log(`cinecraft: shot ${shot.id} keyframe ${kf.id}${anchor ? ` ${anchor.name} ${score}/10` : " (establishing)"}${attempt ? " (retry)" : ""}`);
    if (score > bestScore) { best = kf; bestScore = score; }
    if (score >= minC) break;
  }
  if (!best) throw new Error(`cinecraft.renderShot: keyframe failed for shot ${shot.id}`);
  if (anchor && bestScore < minC) log(`cinecraft: shot ${shot.id} SHIPPING at ${bestScore}/10 (below ${minC}) — flag for review`);

  // 2) i2v — animate the LOCKED keyframe with the camera move.
  const model = shot.i2vModel ?? o.i2vModel ?? CINE_MODELS.i2v;
  const clip = await hfGenerate(
    model, shot.i2vPrompt,
    ["--image", best.id, "--aspect_ratio", aspect, "--resolution", "1080p", "--duration", String(Math.min(8, Math.max(4, shot.durationSec)))],
    "15m",
  );
  log(`cinecraft: shot ${shot.id} clip ${clip.id}`);
  return { spec: shot, keyframeJobId: best.id, keyframeUrl: best.result_url ?? "", consistencyScore: bestScore, clipJobId: clip.id, clipUrl: clip.result_url ?? "" };
}

/**
 * Orchestrator: render every shot for a designed subject set (keyed by name),
 * IN ORDER. Establishing (subject-less) shots render too. Returns the rendered
 * shots — the caller assembles them (Remotion) and adds audio. NO narration /
 * music / SFX here by design.
 */
export async function craftCinematicShots(o: {
  brief: CinematicBrief;
  subjects: Record<string, CinematicSubject>;
  shots: ShotSpec[];
  tmpDir: string;
  i2vModel?: string;
  log?: (m: string) => void;
}): Promise<RenderedShot[]> {
  const log = o.log ?? (() => {});
  const out: RenderedShot[] = [];
  for (const shot of o.shots) {
    try {
      out.push(await renderShot(shot, o.subjects, { brief: o.brief, tmpDir: o.tmpDir, i2vModel: o.i2vModel, log }));
    } catch (e) {
      log(`cinecraft: shot ${shot.id} render failed (${e instanceof Error ? e.message.slice(0, 120) : e})`);
    }
  }
  const anchored = out.filter((r) => (r.spec.subjects ?? []).length);
  log(`cinecraft: rendered ${out.length}/${o.shots.length} shots (avg subject consistency ${anchored.length ? (anchored.reduce((s, r) => s + r.consistencyScore, 0) / anchored.length).toFixed(1) : "n/a"})`);
  return out;
}
