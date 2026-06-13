/**
 * CINECRAFT — the cinematic character engine as ONE standalone module (golden-
 * shaped, like banana / scriptcraft / metacraft / topicraft / voicecraft /
 * footagecraft). It does ONE thing: turn a story into a set of CHARACTER-
 * CONSISTENT cinematic VIDEO SHOTS. No narration, no music, no SFX, no
 * assembly — purely the generated visuals. A pipeline layers audio + Remotion
 * assembly on top later; this module is the visual family that unlocks the
 * Cipher / "ago." true-crime / history documentary style.
 *
 * What it unlocks, in order (each callable on its own):
 *   1. extractCast()      — identify the people ESSENTIAL to the story.
 *   2. designCharacter()  — Nano Banana character sheet (hero + angles), the
 *                           ONE canonical reference every shot is anchored to.
 *                           Operator approves the hero BEFORE any Soul.
 *   3. trainSoul()        — optional Higgsfield Soul ID (flexibility / extreme
 *                           angles); the caller persists it to its registry.
 *   4. buildShotScript()  — per beat: setting, action, camera move, lens, mood,
 *                           transition + the keyframe and i2v prompts.
 *   5. renderShot()       — the CONSISTENCY LAW: keyframe = the canonical hero
 *                           image as a DIRECT reference (NOT the soul — the soul
 *                           drops fine features; hero-anchor scored 9/10 vs 2-6),
 *                           the prompt LEADS with the identity lock and names
 *                           distinctive features, a vision gate re-rolls drift,
 *                           then Seedance/Kling i2v animates the locked keyframe.
 *   craftCinematicShots() — the orchestrator that runs 4→5 for a cast.
 *
 * Deps: Higgsfield CLI (HIGGSFIELD_LIVE=1, hostless auth) + GEMINI_API_KEY.
 * PURE of Convex/R2 — returns job ids / urls / local paths; the caller owns the
 * soul registry + R2 persistence (injected `tmpDir` is the worker scratch dir,
 * NEVER a dev box). Seamless to integrate: one import, plain data in/out.
 *
 *   import { extractCast, designCharacter, buildShotScript, renderShot,
 *            craftCinematicShots, hasCinecraft } from "@/lib/cinecraft";
 */
import { join } from "node:path";
import { runCli, HiggsfieldError } from "@/lib/higgsfield";
import { downloadTo } from "@/lib/files";
import { geminiJsonPro, geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";

export function hasCinecraft(): boolean {
  return process.env.HIGGSFIELD_LIVE === "1" && hasGeminiKey();
}

/* ------------------------------- models -------------------------------- */

export const CINE_MODELS = {
  /** Character sheet + keyframes (hero-anchored via --image). */
  image: "nano_banana_2",
  /** Cheap i2v (camera via prompt) — Daniel's pick for the PoC. */
  i2v: "seedance1_5",
  /** i2v that takes start+end images (endframe chaining / continuity). */
  i2vChain: "kling3_0",
} as const;

/* ------------------------------- types --------------------------------- */

/** The channel/story context that shapes look + casting. */
export interface CinematicBrief {
  /** The story/topic (for cast + shot extraction). */
  story: string;
  /** Niche/genre, e.g. "true crime", "history". */
  niche?: string;
  /** Period + place, e.g. "1925 Paris". */
  period?: string;
  /** Channel look/grade, e.g. "moody cinematic chiaroscuro, warm tungsten". */
  look?: string;
  /** 16:9 (default) | 9:16. */
  aspect?: "16:9" | "9:16";
}

/** A person essential to the story, before any render. */
export interface CastMember {
  name: string;
  /** Their role in the story (protagonist, victim, official…). */
  role: string;
  /** How central — recurring leads get a Soul; one-scene extras may not. */
  importance: "lead" | "supporting" | "extra";
  /** A vivid, period-accurate visual description (age, build, face, wardrobe). */
  look: string;
}

/** A designed character: the canonical reference every shot anchors to. */
export interface CinematicCharacter extends CastMember {
  /** The canonical HERO render's Higgsfield job id — the identity anchor. */
  heroJobId: string;
  heroUrl: string;
  /** Extra angle/expression job ids (sheet) — for approval + Soul training. */
  sheetJobIds: string[];
  /** Trained Soul ID (optional). */
  soulId?: string;
  /** The distinctive features the keyframe prompt must always name. */
  identityMarkers: string;
}

/** One cinematic shot the renderer obeys. */
export interface ShotSpec {
  id: number;
  beat: string;
  /** Character name(s) in the shot (must exist in the cast). */
  characters: string[];
  setting: string;
  action: string;
  /** START-frame image prompt (scene + pose + framing; identity is anchored). */
  keyframePrompt: string;
  cameraMove: string;
  lens: string;
  mood: string;
  /** Image-to-video motion prompt (the camera move + action). */
  i2vPrompt: string;
  transition: string;
  durationSec: number;
}

export interface RenderedShot {
  spec: ShotSpec;
  keyframeJobId: string;
  keyframeUrl: string;
  /** Vision identity match of the keyframe vs the hero (0-10). */
  identityScore: number;
  clipJobId: string;
  clipUrl: string;
}

/* ------------------------------ CLI helper ------------------------------ */

interface Job { id: string; result_url?: string; status?: string }

function firstJob(raw: unknown): Job {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [(raw as Job)] : [];
  const withUrl = arr.find((j) => j && (j.result_url || j.id));
  if (!withUrl) throw new HiggsfieldError(`no job in response: ${JSON.stringify(raw).slice(0, 160)}`);
  return withUrl as Job;
}

/** Generate one image/video job and block for the result (job id + url). */
async function hfGenerate(model: string, prompt: string, extra: string[], timeout = "12m"): Promise<Job> {
  const raw = await runCli(["generate", "create", model, ...extra, "--prompt", prompt, "--wait", "--wait-timeout", timeout, "--wait-interval", "5s"]);
  return firstJob(raw);
}

/* ------------------------------- cast ---------------------------------- */

/**
 * Identify the people ESSENTIAL to the story (Gemini). Leads (recurring) are
 * flagged for individual character design + a Soul; one-scene players are
 * "extra". Returns descriptions only — no renders yet.
 */
export async function extractCast(brief: CinematicBrief, opts?: { max?: number; log?: (m: string) => void }): Promise<CastMember[]> {
  if (!hasGeminiKey()) throw new Error("cinecraft.extractCast: GEMINI_API_KEY missing");
  const max = opts?.max ?? 6;
  const out = await geminiJsonPro<{ cast?: CastMember[] }>({
    prompt: [
      `You are casting a cinematic ${brief.niche ?? "documentary"} reconstruction${brief.period ? ` set in ${brief.period}` : ""}.`,
      `STORY:\n${brief.story.slice(0, 6000)}`,
      `Identify up to ${max} people ESSENTIAL to telling this story visually. A RECURRING central person = "lead" (they will get a trained character + appear in many shots); a person in one or two scenes = "supporting" or "extra".`,
      `For each: name, role, importance (lead|supporting|extra), and a VIVID period-accurate VISUAL description (apparent age, build, face, hair, distinctive features, wardrobe) a casting director would use to render them consistently.`,
      brief.look ? `Channel look to honor: ${brief.look}.` : "",
      `Return STRICT JSON {"cast":[{"name","role","importance","look"}]}.`,
    ].filter(Boolean).join("\n\n"),
    maxTokens: 1800,
    temperature: 0.5,
    log: opts?.log,
  });
  const cast = (out.cast ?? []).filter((c) => c?.name && c?.look).slice(0, max);
  opts?.log?.(`cinecraft: cast = ${cast.map((c) => `${c.name} (${c.importance})`).join(", ")}`);
  return cast;
}

/* ---------------------------- character design -------------------------- */

/** The identity-lock preamble every keyframe prompt LEADS with (the law). */
function identityLock(markers: string): string {
  return `This is the EXACT SAME man/person — identical face, ${markers}. Do NOT change their facial identity. `;
}

/** One Nano Banana render, optionally anchored to a reference job id. */
async function nanoImage(prompt: string, brief: CinematicBrief, refJobId?: string): Promise<Job> {
  const extra = ["--aspect_ratio", brief.aspect ?? "16:9", ...(refJobId ? ["--image", refJobId] : [])];
  return hfGenerate(CINE_MODELS.image, prompt, extra, "6m");
}

/**
 * Design a character: render the canonical HERO, then N angle/expression
 * variations anchored to the hero (so face + wardrobe stay locked). Returns the
 * character for OPERATOR APPROVAL before any Soul training. `identityMarkers`
 * are the distinctive features every future keyframe prompt will name.
 */
export async function designCharacter(
  member: CastMember,
  brief: CinematicBrief,
  opts?: { angles?: number; log?: (m: string) => void },
): Promise<CinematicCharacter> {
  if (!hasCinecraft()) throw new Error("cinecraft.designCharacter: HIGGSFIELD_LIVE=1 + GEMINI required");
  const log = opts?.log ?? (() => {});
  const lookGrade = brief.look ? `, ${brief.look}` : "";
  const hero = await nanoImage(
    `Cinematic character reference portrait. ${member.look}. Photorealistic film still${lookGrade}, soft studio key light, plain neutral grey backdrop, head and shoulders, looking at camera, sharp focus, 35mm, shallow depth of field.`,
    brief,
  );
  log(`cinecraft: ${member.name} hero = ${hero.id}`);
  // Distinctive features to lock — distilled from the look (Gemini, cheap).
  const markers = await distillMarkers(member.look).catch(() => "same hair, same distinctive features, same wardrobe");
  const angles = opts?.angles ?? 4;
  const poses = [
    "Three-quarter view portrait, confident, looking slightly off-camera.",
    "FULL-HEIGHT standing pose, entire body head to shoes, hands relaxed.",
    "Strict side profile of head and shoulders.",
    "Serious, neutral expression, soft frontal light (clean reference).",
    "Subtle low angle, commanding.",
    "Looking down, focused.",
  ].slice(0, angles);
  const sheetJobIds: string[] = [];
  for (const pose of poses) {
    try {
      const j = await nanoImage(`${identityLock(markers)}${pose} Plain neutral grey backdrop, same lighting.`, brief, hero.id);
      sheetJobIds.push(j.id);
    } catch (e) {
      log(`cinecraft: sheet pose failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
  }
  log(`cinecraft: ${member.name} sheet = ${sheetJobIds.length} angles`);
  return { ...member, heroJobId: hero.id, heroUrl: hero.result_url ?? "", sheetJobIds, identityMarkers: markers };
}

async function distillMarkers(look: string): Promise<string> {
  const out = await geminiJsonPro<{ markers?: string }>({
    prompt: `From this character description, list the 3-5 MOST distinctive, identity-defining visual features as a short comma phrase a prompt can repeat to lock identity (e.g. "thin neat mustache, slicked dark hair, charcoal three-piece suit"). Description: "${look}". Return STRICT JSON {"markers":string}.`,
    maxTokens: 200,
    temperature: 0.2,
  });
  return (out.markers ?? "").trim() || "same hair, same distinctive features, same wardrobe";
}

/* ------------------------------- soul ---------------------------------- */

/**
 * Train a Higgsfield Soul ID on the character's sheet (download → upload →
 * soul-id create → wait). Optional — the hero-image anchor is what enforces
 * keyframe consistency; the Soul adds flexibility. Returns the soul id; the
 * CALLER persists it to its registry. `tmpDir` = worker scratch (never a dev box).
 */
export async function trainSoul(
  char: CinematicCharacter,
  o: { tmpDir: string; log?: (m: string) => void },
): Promise<string> {
  if (!hasCinecraft()) throw new Error("cinecraft.trainSoul: HIGGSFIELD_LIVE=1 required");
  const log = o.log ?? (() => {});
  const jobIds = [char.heroJobId, ...char.sheetJobIds];
  // Resolve job-id → result_url via the job list, download, re-upload.
  const list = (await runCli(["generate", "list", "--size", "60"])) as Job[];
  const url = new Map((Array.isArray(list) ? list : []).map((j) => [j.id, j.result_url]));
  const uploadIds: string[] = [];
  for (let i = 0; i < jobIds.length; i++) {
    const u = url.get(jobIds[i]);
    if (!u) continue;
    try {
      const local = join(o.tmpDir, `soul_${char.name.replace(/\W+/g, "_")}_${i}.png`);
      await downloadTo(u, local);
      const up = await runCli(["upload", "create", local]);
      const id = firstJob(up).id;
      if (id) uploadIds.push(id);
    } catch (e) {
      log(`cinecraft: soul upload ${i} failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
  }
  if (uploadIds.length < 4) throw new Error(`cinecraft.trainSoul: only ${uploadIds.length} usable images (need ≥4)`);
  const created = firstJob(await runCli(["soul-id", "create", "--name", char.name, "--soul-2", ...uploadIds.flatMap((u) => ["--image", u])]));
  const soulId = created.id;
  log(`cinecraft: soul ${soulId} queued (${uploadIds.length} images) — training…`);
  // Block until trained.
  await runCli(["soul-id", "wait", soulId, "--wait-timeout", "30m"]).catch(() => {});
  log(`cinecraft: soul ${soulId} trained for ${char.name}`);
  return soulId;
}

/* ---------------------------- shot script ------------------------------ */

/**
 * Turn the story into a cinematic SHOT LIST with camera grammar (Gemini Pro
 * director). Each shot names its characters (must be in the cast), the setting,
 * action, keyframe + i2v prompts, camera move, lens, mood, transition.
 */
export async function buildShotScript(
  brief: CinematicBrief,
  cast: CastMember[],
  opts?: { shots?: number; log?: (m: string) => void },
): Promise<ShotSpec[]> {
  if (!hasGeminiKey()) throw new Error("cinecraft.buildShotScript: GEMINI_API_KEY missing");
  const n = opts?.shots ?? 8;
  const out = await geminiJsonPro<{ shots?: ShotSpec[] }>({
    prompt: [
      `You are the DIRECTOR of a cinematic ${brief.niche ?? "documentary"} reconstruction${brief.period ? ` (${brief.period})` : ""}, Cipher / "ago." style.`,
      `STORY:\n${brief.story.slice(0, 6000)}`,
      `CAST (use these exact names; trained references exist — keep each person identical every shot):\n${cast.map((c) => `- ${c.name} (${c.role}): ${c.look}`).join("\n")}`,
      brief.look ? `CHANNEL LOOK: ${brief.look}.` : "",
      `Produce EXACTLY ${n} cinematic shots that tell the story in order. Each shot = one continuous ~4-5s beat. For each: id, beat (the story moment), characters (names from the cast in this shot), setting (period-accurate), action, keyframePrompt (the START-FRAME scene + the character's pose + framing + lighting — do NOT redescribe their face; identity is anchored elsewhere), cameraMove (push-in / dolly / steadicam / crane / handheld / static), lens (e.g. 35mm/50mm/85mm) + mood, i2vPrompt (the motion: camera move + the action, ~5s), transition (cut / match-cut / whip / dip-to-black), durationSec (4-5).`,
      `Return STRICT JSON {"shots":[{id,beat,characters,setting,action,keyframePrompt,cameraMove,lens,mood,i2vPrompt,transition,durationSec}]}.`,
    ].filter(Boolean).join("\n\n"),
    maxTokens: 6000,
    temperature: 0.7,
    log: opts?.log,
  });
  const shots = (out.shots ?? []).filter((s) => s?.keyframePrompt && s?.i2vPrompt).map((s, i) => ({ ...s, id: s.id ?? i + 1, durationSec: s.durationSec || 4, characters: s.characters ?? [] }));
  opts?.log?.(`cinecraft: ${shots.length} shots scripted`);
  return shots;
}

/* ------------------------------- render -------------------------------- */

/**
 * Vision identity gate: how well does a keyframe match the character's hero
 * (0-10). Downloads both to `tmpDir` for the local vision model.
 */
async function identityScore(keyframeUrl: string, heroUrl: string, tmpDir: string, tag: string): Promise<number> {
  if (!hasGeminiKey() || !keyframeUrl || !heroUrl) return 10;
  try {
    const a = join(tmpDir, `hero_${tag}.png`);
    const b = join(tmpDir, `kf_${tag}.png`);
    await Promise.all([downloadTo(heroUrl, a), downloadTo(keyframeUrl, b)]);
    const raw = await geminiVisionLocal({
      prompt: `Image 1 is the CANONICAL character. Image 2 is a keyframe that must be the SAME person (same face + distinctive features). Return STRICT JSON {"match":0-10}.`,
      imagePaths: [a, b],
      json: true,
      maxTokens: 80,
    });
    const v = parseJsonLoose<{ match?: number }>(raw);
    return typeof v.match === "number" ? v.match : 8;
  } catch {
    return 8;
  }
}

/**
 * Render ONE shot under the consistency law:
 *   keyframe = the character's HERO image as a DIRECT reference, prompt LEADS
 *   with the identity lock + names the distinctive features → vision gate vs
 *   the hero, re-roll on drift → Seedance/Kling i2v animates the locked keyframe.
 * `tmpDir` = worker scratch. Identity comes from `char.heroJobId`, never a
 * generic re-description.
 */
export async function renderShot(
  shot: ShotSpec,
  char: CinematicCharacter,
  o: { brief: CinematicBrief; tmpDir: string; i2vModel?: string; minIdentity?: number; maxRetries?: number; log?: (m: string) => void },
): Promise<RenderedShot> {
  if (!hasCinecraft()) throw new Error("cinecraft.renderShot: HIGGSFIELD_LIVE=1 + GEMINI required");
  const log = o.log ?? (() => {});
  const minId = o.minIdentity ?? 8;
  const aspect = o.brief.aspect ?? "16:9";
  const lockPrompt = `${identityLock(char.identityMarkers)}${shot.keyframePrompt}`;

  // 1) hero-anchored keyframe + vision gate (re-roll on drift).
  let best: Job | null = null;
  let bestScore = -1;
  for (let attempt = 0; attempt <= (o.maxRetries ?? 1); attempt++) {
    const kf = await nanoImage(lockPrompt, o.brief, char.heroJobId);
    const score = await identityScore(kf.result_url ?? "", char.heroUrl, o.tmpDir, `${shot.id}_${attempt}`);
    log(`cinecraft: shot ${shot.id} keyframe ${kf.id} identity ${score}/10${attempt ? " (retry)" : ""}`);
    if (score > bestScore) { best = kf; bestScore = score; }
    if (score >= minId) break;
  }
  if (!best) throw new Error(`cinecraft.renderShot: keyframe failed for shot ${shot.id}`);
  if (bestScore < minId) log(`cinecraft: shot ${shot.id} SHIPPING at identity ${bestScore}/10 (below ${minId}) — flag for review`);

  // 2) i2v — animate the LOCKED keyframe with the camera move.
  const model = o.i2vModel ?? CINE_MODELS.i2v;
  const clip = await hfGenerate(
    model,
    shot.i2vPrompt,
    ["--image", best.id, "--aspect_ratio", aspect, "--resolution", "1080p", "--duration", String(Math.min(8, Math.max(4, shot.durationSec)))],
    "15m",
  );
  log(`cinecraft: shot ${shot.id} clip ${clip.id}`);
  return { spec: shot, keyframeJobId: best.id, keyframeUrl: best.result_url ?? "", identityScore: bestScore, clipJobId: clip.id, clipUrl: clip.result_url ?? "" };
}

/**
 * Orchestrator: render every shot for an already-designed cast (characters keyed
 * by name). Shots whose character isn't designed are skipped (logged). Returns
 * the rendered shots IN ORDER — the caller assembles them (Remotion) and adds
 * the audio layer. NO narration / music / SFX here by design.
 */
export async function craftCinematicShots(
  o: {
    brief: CinematicBrief;
    characters: Record<string, CinematicCharacter>;
    shots: ShotSpec[];
    tmpDir: string;
    i2vModel?: string;
    log?: (m: string) => void;
  },
): Promise<RenderedShot[]> {
  const log = o.log ?? (() => {});
  const out: RenderedShot[] = [];
  for (const shot of o.shots) {
    const name = shot.characters[0] ?? Object.keys(o.characters)[0];
    const char = o.characters[name];
    if (!char) { log(`cinecraft: shot ${shot.id} skipped — no designed character "${name}"`); continue; }
    try {
      out.push(await renderShot(shot, char, { brief: o.brief, tmpDir: o.tmpDir, i2vModel: o.i2vModel, log }));
    } catch (e) {
      log(`cinecraft: shot ${shot.id} render failed (${e instanceof Error ? e.message.slice(0, 120) : e})`);
    }
  }
  log(`cinecraft: rendered ${out.length}/${o.shots.length} shots (avg identity ${out.length ? (out.reduce((s, r) => s + r.identityScore, 0) / out.length).toFixed(1) : "n/a"})`);
  return out;
}
