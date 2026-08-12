/**
 * LORESHORT — standalone lore micro-doc engine (GoT "Histories & Lore" style) with
 * GENUINE AI 3D camera moves, as a reusable module.
 *
 * Gemini first-person narration + per-beat LAYERED-DEPTH scene prompts → Nano Banana
 * art → ElevenLabs PER-LINE TTS (for exact beat timing) → cheap image-to-video camera
 * moves (Replicate LTX-distilled / Wan 2.2) → optional Real-ESRGAN 2K upscale → ffmpeg
 * beat-cut edit (fit each shot to its narration line + breath, dissolve, title, grade).
 * Every stage caches to output/loreshort/<slug>/ → fully resumable.
 *
 * Art SUB-STYLES are swappable (cinematic concept-art, watercolour+pencil, …) so the
 * SAME engine renders any lore in any look. Visual-only; narration muxed at the end.
 *
 * PROVIDERS ARE INJECTED (see LoreShortDeps). Called with no deps — the CLI /
 * proof-gallery path — every provider above is the default and behaviour is
 * unchanged. The pipeline block (src/trigger/blocks/loreShortBlocks.ts) injects
 * the attested Novita render farm, the channel's cast voice and an R2 publish
 * sink, so nothing paid escapes the cost-attestation rail and nothing depends on
 * a VPS filesystem.
 */
import { writeFile, readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "./bootstrap";
import { geminiJsonPro, parseJsonLoose } from "./gemini";
import { visionLocal, VISION_GATE_MAX_TOKENS } from "./vision";
import { synthNarration } from "./tts";
import { generateBananaImage } from "./banana";
import { ffprobeDuration } from "./ffmpeg";

export interface LoreSubStyle {
  /** image-prompt style prefix fed to every scene render */
  art: string;
  /** ffmpeg grade chain applied to the assembled video */
  grade: string;
}

/** Swappable art looks — pick per short via cfg.subStyle. */
export const SUB_STYLES: Record<string, LoreSubStyle> = {
  cinematic: {
    art: "epic cinematic concept-art ILLUSTRATION, dramatic chiaroscuro lighting, highly detailed, vast awe-inspiring scale, deep shadows with selective warm and cold light, painterly grandeur, original universe. ABSOLUTELY NO text, no letters, no borders, no UI.",
    grade: "eq=contrast=1.05:saturation=1.03,vignette=PI/7,noise=alls=4:allf=t",
  },
  watercolor_pencil: {
    art: "delicate WATERCOLOUR and PENCIL illustration — soft translucent watercolour washes bleeding into textured cold-press paper, visible graphite PENCIL linework and gentle cross-hatching, loose hand-drawn edges, muted earthy palette with soft natural light, storybook lore-art, atmospheric and painterly, plenty of paper texture. ABSOLUTELY NO text, no letters, no borders, no UI.",
    grade: "eq=contrast=1.02:saturation=0.96:brightness=0.02,vignette=PI/9,noise=alls=7:allf=t",
  },
};

export interface LoreShortCfg {
  slug: string;
  title: string;
  kicker: string;
  topic: string;
  narrator: string;
  nScenes?: number;
  subStyle?: string;
  voiceId?: string;
  narrationSpeed?: number; // TTS speaking-rate multiplier (<1 = slower/graver); default 0.96
  model?: "ltx" | "wan" | "seedance";
  frames?: number;
  seedanceRes?: "480p" | "720p" | "1080p";
  seedanceDur?: number;
  upscale?: "realesrgan" | "ffmpeg" | "none";
  upscaleRes?: "FHD" | "2k" | "4k";
  elaborateMoves?: boolean;
  analyzeMotion?: boolean; // vision-derived per-image motion brief (subject + particles + camera) — the core
  introSec?: number;       // title-card hold BEFORE narration starts (rule)
  pause?: number;
  dissolve?: number;
  host?: string;   // public base URL the final video is served from
  webDir?: string; // local dir served at <host>/loreshort
  path?: "budget" | "premium"; // applies a LORESHORT_PATHS preset (explicit fields still override)
}

/** The two cost/quality lanes. Spread onto a cfg (or pass cfg.path). */
export const LORESHORT_PATHS = {
  budget:  { model: "ltx" as const,      frames: 145, upscale: "ffmpeg" as const,     upscaleRes: "2k" as const, note: "LTX-distilled + FREE ffmpeg 2K — ~$0.4/video, fastest, softest figures" },
  premium: { model: "seedance" as const, seedanceRes: "480p" as const, seedanceDur: 5, upscale: "realesrgan" as const, upscaleRes: "4k" as const, note: "Seedance-1-lite 480p + Real-ESRGAN 4K — ~$1.35/video, best figures, true 4K" },
} as const;

/**
 * LORESHORT_MODULE — the self-describing contract. So this module runs on its own
 * AND inside an array of other modules: it declares what it NEEDS, what it DOES,
 * what it PRODUCES, and the RULES that protect its output.
 */
export const LORESHORT_MODULE = {
  key: "loreshort",
  title: "Lore Short",
  stage: "visual",
  does: "Produces a ~1-minute first-person 'Histories & Lore' micro-documentary (Game-of-Thrones style): a single narrator recounts a history over AI-painted art with GENUINE 3D camera moves. Standalone and composable.",
  produces: {
    kind: "narrated_lore_video",
    file: "mp4 — H.264, 24fps, 2K or 4K, narration muxed, EB-Garamond title card",
    duration: "~50-60s for 9 beats",
    returns: "{ videoPath, url, scenes, durationSec, width, height }",
  },
  requires: { // the caller MUST supply these
    slug: "string — unique id; names the output folder + published file",
    title: "string — title-card headline",
    kicker: "string — title-card subtitle",
    topic: "string — the history/subject to narrate",
    narrator: "string — WHO narrates, first person (identity + tone)",
  },
  optional: { // sensible defaults (see DEFAULTS / LORESHORT_PATHS)
    path: "'budget' | 'premium' — picks a LORESHORT_PATHS lane (default = premium defaults)",
    subStyle: "key of SUB_STYLES — 'cinematic' | 'watercolor_pencil' | add your own (default cinematic)",
    nScenes: "beats ≈ seconds/6 (default 9)", voiceId: "ElevenLabs voice id",
    model: "'seedance' | 'ltx' | 'wan'", seedanceRes: "'480p'|'720p'|'1080p'",
    upscale: "'realesrgan' | 'ffmpeg' | 'none'", upscaleRes: "'2k' | '4k'",
    introSec: "title-card seconds", pause: "breath between beats", dissolve: "crossfade seconds",
  },
  needs: { // environment
    // GEMINI is unconditional (story + motion-analysis vision are the engine).
    // ELEVENLABS / REPLICATE are only required by the DEFAULT implementations —
    // an injected caller (LoreShortDeps) supplies its own providers and neither
    // token is demanded. See the secret computation in craftLoreShort.
    secrets: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY (default TTS only)", "REPLICATE_API_TOKEN (default i2v/upscale only)"],
    tools: ["ffmpeg", "ffprobe"],
    note: "Render is nginx-INDEPENDENT (all Replicate inputs are base64 data URIs). The DEFAULT publish sink copies to cfg.webDir and returns cfg.host; an injected `publish` dep (the pipeline block) writes to R2 instead and needs no web host at all.",
  },
  paths: LORESHORT_PATHS,
  rules: [
    "DE-BRAND the visuals: SCENE art prompts use only generic, non-trademarked terms (Gemini image refuses IP); narration text may be freer.",
    "The DEPTH camera move is the CORE and always leads; subject/particle motion is added only where a vision pass finds it, scaled to honest intensity — never forced onto still objects.",
    "A title card plays BEFORE the narration starts (rule).",
    "NO cross-engine fallback: a failed clip retries the SAME engine, then fails LOUD; fix content-policy refusals at the art source (re-gen / de-brand).",
    "Every stage caches to output/loreshort/<slug>/ → fully resumable; bounded concurrency + retries make it fail-proof.",
    "Two lanes: budget (free ffmpeg 2K) and premium (Seedance 480p → Real-ESRGAN 4K).",
  ],
} as const;

const DEFAULTS = {
  // STANDARD: Seedance-1-lite @ 480p (cheap floor ~$0.09/clip, best figures) → Real-ESRGAN to 4K (small input = cheap upscale ~$0.06). ~$0.15/clip.
  nScenes: 9, subStyle: "cinematic", voiceId: "IKne3meq5aSn9XLyUdCD", model: "seedance" as const,
  frames: 145, seedanceRes: "480p" as const, seedanceDur: 5, upscale: "realesrgan" as const, upscaleRes: "4k" as const,
  elaborateMoves: false, analyzeMotion: true, introSec: 2.8,
  pause: 0.45, dissolve: 0.35, host: "http://87.106.233.113", webDir: "/var/www/html/loreshort",
};

const LTX_VERSION = "e7f2778ec419047c564a6620b2d9bf7d6c64673411bf2ae13e628ee2b2c0b5b1"; // lightricks/ltx-video-0.9.7-distilled
const SEEDANCE_VERSION = "6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73"; // bytedance/seedance-1-lite (better figures, native HD)
const ESRGAN_VER = "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775";  // lucataco/real-esrgan-video

// elaborate cinematic moves cycled per beat (cfg.elaborateMoves=true); each drives a different 3D travel
const CAM_MOVES = [
  "A slow majestic CRANE DESCENT from high above, the camera booming down past a towering foreground element and sweeping deep into the scene",
  "A powerful DOLLY PUSH straight forward THROUGH the frame, near foreground shapes rushing past the lens as the camera plunges toward the distant background",
  "A grand PULL-BACK reveal, the foreground sweeping up huge and close in front of the lens while layer after layer of the deep background unfolds behind it",
  "A sweeping ORBIT arcing sideways around the central subject, foreground and background sliding apart with strong parallax",
  "A low gliding TRACK forward weaving past tall foreground silhouettes that part to reveal the vista beyond",
  "A rising BOOM up and over a near foreground obstacle, then tilting down to reveal the scene stretching far into the distance",
  "A steady descending CRANE that drops the camera down through stacked layers of depth, foreground passing close overhead",
  "A slow lateral TRUCK gliding across the scene, near foreground elements streaking past fast while the far background drifts slowly",
  "A cinematic FLY-THROUGH gliding between foreground pillars and shapes, deep into the receding space, vanishing point opening up ahead",
];
const DEPTH_STRONG = " Reveal MANY overlapping depth layers — distinct foreground occluders close to the lens, several midground planes, and a deep receding background — with strong volumetric parallax so every layer moves at its own rate and planes slide past one another. Cinematic, smooth, continuous motion; ONLY the camera moves through real 3D space; keep the exact art style and content; no cuts, no morphing, no new objects.";
const DEPTH_SIMPLE = " Reveal strong parallax depth between the foreground, midground and background. Keep the exact same art style and content; ONLY the camera moves smoothly through real 3D space. Slow, cinematic, no cuts, no morphing, no new objects.";
// motion-analysis driven shot: a depth camera move ALWAYS (the core), subject/particles only when really present,
// and the AMOUNT of motion matched to the scene's analyzed intensity so calm scenes aren't force-animated.
const HOLD: Record<string, string> = {
  gentle: " Keep the motion SUBTLE, calm and restrained: the smooth cinematic camera move revealing parallax depth is the MAIN motion, with only soft, natural drift in the elements above. Do NOT over-animate; objects that would be still STAY still; nothing warps, melts or moves unnaturally. Keep the EXACT art style and content; no cuts, no new objects, no text.",
  moderate: " Animate naturally and believably: the camera makes a smooth cinematic move revealing strong PARALLAX DEPTH (foreground vs midground vs deep background), and the named subject and elements move clearly but never unnaturally. Keep the EXACT art style and content; no cuts, no morphing, no new objects, no text.",
  strong: " Bring the scene fully to LIFE with lively, energetic, continuous motion: a bold cinematic camera move reveals strong PARALLAX DEPTH while the named subject acts and the particles fly and flicker. Keep the EXACT art style and content; no cuts, no morphing, no new objects, no text.",
};
const NEG_BASE = "warping, morphing, deforming, melting, distorted, glitch, flicker artifacts, extra limbs, duplicated objects, wobbling, jitter, text, watermark, blurry";
const NEG_ANTISTATIC = ", static, still image, frozen, motionless"; // added ONLY for moderate/strong so calm scenes aren't forced to move

export interface LoreScene {
  line: string;
  shot?: string;
  visual: string;
  camera: string;
}

export interface LorePlan {
  scenes?: LoreScene[];
}

/**
 * Is the engine's own (non-injectable) half configured? Gemini drives BOTH the
 * story pass and the motion-analysis vision pass, so without it there is no
 * lore short regardless of which render providers a caller injects.
 */
export function hasLoreShort(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** What the story writer needs. Deliberately a subset of LoreShortCfg. */
export interface LoreStoryBrief {
  narrator: string;
  topic: string;
  nScenes: number;
}

/**
 * The story pass, hoisted out of craftLoreShort so a caller can run it under a
 * produce→critique loop at TEXT prices BEFORE any art, narration or clip is
 * bought (mirrors planWhiteboardStoryboard). `priorIssues` feeds a rejected
 * draft's defects back into the rewrite.
 *
 * This is one Gemini text call per invocation and reaches NO image, TTS or
 * video provider — by construction an iteration here cannot spend render money.
 */
export async function planLoreShortStory(
  brief: LoreStoryBrief,
  log: (message: string) => void = () => {},
  priorIssues: readonly string[] = [],
): Promise<LorePlan> {
  const fixes = priorIssues.length
    ? `\n\nYour previous draft was REJECTED. Fix EVERY one of these and return a complete rewrite:\n` +
      priorIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "";
  let plan: LorePlan = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    plan = await geminiJsonPro<LorePlan>({
      prompt:
        `Write a lore micro-documentary in the EXACT spirit of the Game of Thrones "Histories & Lore" featurettes: a single ` +
        `figure narrates history in FIRST PERSON — proud, intimate, epic, measured, never breathless, with DRAMATIC PACING ` +
        `(mix short punchy lines with a few longer ones; let it breathe). NARRATOR: ${brief.narrator}. TOPIC: ${brief.topic}. ` +
        `Compose a tight narration ARC across EXACTLY ${brief.nScenes} beats that BUILDS: a calm opening, rising dread, a climax, a cold resolution. ` +
        `Return STRICT JSON {"scenes":[{...}]} with EXACTLY ${brief.nScenes} scene objects IN ORDER, each with: ` +
        `"line" = that beat's spoken narration sentence (vary length 6–22 words for rhythm); ` +
        `"shot" = the cinematic SHOT TYPE, chosen for rhythm and to vary across beats: one of "wide establishing", "sweeping aerial", "slow low-angle hero", "intimate close", "dramatic reveal", "looming over-the-shoulder", "vast vista"; ` +
        `"visual" = a vivid description of that moment composed in THREE SEPARATED DEPTH PLANES — a distinct CLOSE FOREGROUND element, a clear MIDGROUND subject, and a DEEP receding BACKGROUND — so a moving camera reveals strong parallax depth; atmospheric, dramatic; use ONLY generic original NON-trademarked terms (no franchise/brand/character names, no graphic gore); ` +
        `"camera" = ONE cinematic camera move that TRAVELS THROUGH THE DEPTH for this shot (e.g. "slow dolly push-in past the foreground toward X, revealing the depth", "crane up and back to unveil the vast Y behind", "track laterally past the foreground W as the background slides"). Vary the moves. ` +
        `The "scenes" array MUST contain EXACTLY ${brief.nScenes} complete objects — do not stop early, do not summarise. Keep each "visual" to ~40 words.` +
        fixes,
      maxTokens: 28000, temperature: 0.75,
    });
    if ((plan.scenes?.length ?? 0) >= brief.nScenes) break;
    log(`story attempt ${attempt + 1}: got ${plan?.scenes?.length || 0}/${brief.nScenes} beats, retrying`);
  }
  if (!plan?.scenes || plan.scenes.length < brief.nScenes) {
    throw new Error(`story only produced ${plan?.scenes?.length || 0} beats`);
  }
  return plan;
}

/**
 * DETERMINISTIC story defects, computed in code (critiqueLoop's design rule: the
 * Director is never asked to count beats or measure word counts).
 */
export function loreStoryDefects(plan: LorePlan, wantScenes: number): string[] {
  const issues: string[] = [];
  const scenes = plan.scenes ?? [];
  if (scenes.length < wantScenes) {
    issues.push(`only ${scenes.length} of the ${wantScenes} requested beats came back — return exactly ${wantScenes}`);
  }
  scenes.slice(0, wantScenes).forEach((scene, index) => {
    const words = String(scene.line ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (words < 5) {
      issues.push(`beat ${index + 1}'s narration line is only ${words} words — write a full spoken sentence (6-22 words)`);
    }
    if (words > 30) {
      issues.push(`beat ${index + 1}'s narration line is ${words} words — too long to hold one shot; tighten it under 22`);
    }
    // The art prompt IS scene.visual; a thin one produces a generic painting and
    // the depth camera move has nothing to travel through.
    const visualWords = String(scene.visual ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (visualWords < 10) {
      issues.push(`beat ${index + 1}'s "visual" is only ${visualWords} words — describe a CLOSE FOREGROUND, a MIDGROUND subject and a DEEP BACKGROUND`);
    }
    if (!String(scene.camera ?? "").trim()) {
      issues.push(`beat ${index + 1} has no "camera" move — every beat needs one move that travels through the depth`);
    }
  });
  for (let i = 1; i < scenes.length; i++) {
    if (String(scenes[i].line ?? "").trim() === String(scenes[i - 1].line ?? "").trim()) {
      issues.push(`beats ${i} and ${i + 1} repeat the same narration line — each beat must advance the history`);
    }
  }
  return issues.slice(0, 8);
}

interface MotionAnalysis {
  camera?: string;
  subject_action?: string;
  particles?: string;
  secondary?: string;
  intensity?: "gentle" | "moderate" | "strong";
}

interface ReplicatePrediction {
  status?: string;
  output?: string | string[];
  detail?: unknown;
  error?: unknown;
  title?: unknown;
  urls?: { get?: string };
}

type ResolvedLoreShortCfg = LoreShortCfg & Required<Pick<LoreShortCfg,
  "analyzeMotion" | "dissolve" | "elaborateMoves" | "frames" | "host" | "introSec" |
  "model" | "nScenes" | "pause" | "seedanceDur" | "seedanceRes" | "subStyle" |
  "upscale" | "upscaleRes" | "voiceId" | "webDir"
>>;

export interface LoreShortResult { videoPath: string; url: string; scenes: LoreScene[]; durationSec: number; width: number; height: number; }

/* ── INJECTION SEAM ───────────────────────────────────────────────────────────
 *
 * The engine used to reach three paid providers itself (Replicate LTX/Seedance
 * for i2v, Replicate Real-ESRGAN for upscale, ElevenLabs for TTS) and to
 * "publish" by copying into an nginx docroot. None of that survives on a
 * Trigger.dev cloud worker, and the Replicate calls bypassed the pipeline's
 * cost-attestation rail entirely.
 *
 * Every one of those is now a caller-supplied callback with the ORIGINAL
 * implementation as its default, so:
 *   - a standalone CLI / proof-gallery run that calls craftLoreShort(cfg) with
 *     no deps behaves EXACTLY as before (same providers, same nginx publish);
 *   - the pipeline block injects the attested Novita render farm, the
 *     pipeline's cast voice, and an R2 sink instead.
 *
 * The shape deliberately mirrors castWhiteboardSync's `generateImage`
 * injection (src/lib/whiteboardSync.ts) so both self-contained engines are
 * wired the same way.
 */
export interface LoreArtRequest { id: string; index: number; prompt: string; }
export interface LoreClipRequest {
  id: string;
  index: number;
  prompt: string;
  negativePrompt: string;
  /** Local path to the already-downscaled 1280px JPEG still for this beat. */
  imagePath: string;
  durationSec: number;
}
export interface LoreNarrationRequest { index: number; text: string; voiceId: string; speed: number; }
export interface LorePublishRequest { slug: string; localPath: string; }
export interface LorePublishResult {
  /** Where the finished master now lives (an R2 key, a docroot path, …). */
  videoPath: string;
  /** How a consumer reaches it. */
  url: string;
}

export interface LoreShortDeps {
  /**
   * A story the caller already settled (e.g. under a produce→critique loop).
   * When present the engine does ZERO planning calls and renders exactly this.
   */
  plan?: LorePlan;
  /** Beat art. Default: Nano Banana (generateBananaImage). */
  generateImage?: (request: LoreArtRequest) => Promise<Buffer | Uint8Array>;
  /** Image→video camera move. Default: Replicate LTX/Seedance/Wan. */
  generateClip?: (request: LoreClipRequest) => Promise<Buffer | Uint8Array>;
  /** Per-line narration. Default: ElevenLabs via synthNarration. */
  synthLine?: (request: LoreNarrationRequest) => Promise<Buffer | Uint8Array>;
  /** Where the finished master goes. Default: copy into cfg.webDir (nginx). */
  publish?: (request: LorePublishRequest) => Promise<LorePublishResult>;
  /**
   * Fired once per ACTUAL motion-analysis vision call — never on a cache hit,
   * so a resumed run does not book a charge it did not incur. The engine drives
   * this pass itself (it is not swappable), so this is how a caller keeps the
   * cost it reports equal to the cost it spent.
   */
  onVisionCall?: (index: number) => void;
  /** Resumable scratch dir. Default: <cwd>/output/loreshort/<slug>. */
  workDir?: string;
  /** Default: console.error("[loreshort] …"). */
  log?: (message: string) => void;
}

/** Run the full lore-short pipeline for one config. Resumable; returns the published video. */
export async function craftLoreShort(userCfg: LoreShortCfg, deps: LoreShortDeps = {}): Promise<LoreShortResult> {
  const pathPreset = userCfg.path ? LORESHORT_PATHS[userCfg.path] : {};
  const cfg = { ...DEFAULTS, ...pathPreset, ...userCfg } as ResolvedLoreShortCfg; // explicit fields override the path lane
  // VALIDATE required inputs — fail clearly whether run alone or inside an orchestrator
  const requiredFields = ["slug", "title", "kicker", "topic", "narrator"] as const;
  const missing = requiredFields.filter((key) => !String(cfg[key] ?? "").trim());
  if (missing.length) throw new Error(`loreshort: missing required input(s): ${missing.join(", ")}. See LORESHORT_MODULE.requires.`);
  const style = SUB_STYLES[cfg.subStyle] ?? SUB_STYLES.cinematic;
  // Only demand the secrets the DEFAULT implementations still in play actually
  // need. An injected caller (the pipeline block) supplies its own attested
  // providers, so requiring a Replicate/ElevenLabs token would fail a run that
  // never touches either. Gemini is unconditional: the story pass and the
  // motion-analysis vision pass are the engine itself, not a swappable dep.
  const usesReplicate = !deps.generateClip || cfg.upscale === "realesrgan";
  await bootstrapSecrets(() => {}, {
    required: [
      "GEMINI_API_KEY",
      ...(deps.synthLine ? [] : ["ELEVENLABS_API_KEY"]),
      ...(usesReplicate ? ["REPLICATE_API_TOKEN"] : []),
    ],
  });
  const RT = process.env.REPLICATE_API_TOKEN as string;
  const RUN = deps.workDir ?? join(process.cwd(), "output", "loreshort", cfg.slug);
  const WEB = cfg.webDir;
  await mkdir(RUN, { recursive: true });
  // The nginx docroot only exists for the DEFAULT publish sink; an injected
  // sink (R2) must not make the engine mkdir into a path a cloud worker has no
  // business writing to.
  if (!deps.publish) await mkdir(WEB, { recursive: true });
  const rd = (f: string) => join(RUN, f);
  const is4k = cfg.upscale !== "none" && cfg.upscaleRes === "4k"; // 3840x2160 canvas at 4K
  const OW = cfg.upscale === "none" ? 1920 : is4k ? 3840 : 2560;
  const OH = cfg.upscale === "none" ? 1080 : is4k ? 2160 : 1440;
  const PRESET = is4k ? "fast" : "medium"; // 4K encodes are heavy on CPU — faster x264 preset
  const log = deps.log ?? ((m: string) => console.error("[loreshort]", m));
  const sh = (c: string, a: string[]) => new Promise<void>((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
  const probe = ffprobeDuration; // shared (was a local ffprobe-duration one-liner)
  // VPS DNS/network flakes (EAI_AGAIN); retry with backoff so a blip can't kill a long run
  const rfetch = async (url: string, opts?: RequestInit, tries = 6): Promise<Response> => { for (let a = 0; ; a++) { try { return await fetch(url, opts); } catch (e) { if (a >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 4000 * (a + 1))); } } };
  // bounded concurrency — burst-submitting 9 predictions trips Replicate rate limits; keep a few in flight
  const pool = async <T>(n: number, items: readonly T[], fn: (item: T, index: number) => Promise<void>) => { let idx = 0; const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; await fn(items[i], i); } }); await Promise.all(workers); };
  // FAIL-PROOF inputs: embed files as base64 data URIs so Replicate never has to fetch from our (OOM-prone) nginx
  const dataUri = async (p: string, mime: string) => `data:${mime};base64,${(await readFile(p)).toString("base64")}`;

  // 1 ── STORY ────────────────────────────────────────────────────────────────
  let plan: LorePlan = {};
  if (deps.plan) {
    // The caller already settled the story under its own critique loop; never
    // re-plan (a second draft here would silently discard the accepted one).
    plan = deps.plan;
    await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
  } else if (existsSync(rd("plan.json"))) {
    plan = JSON.parse(await readFile(rd("plan.json"), "utf8")) as LorePlan;
  } else {
    plan = await planLoreShortStory({ narrator: cfg.narrator, topic: cfg.topic, nScenes: cfg.nScenes }, log);
    await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
  }
  const scenes = (plan.scenes ?? []).slice(0, cfg.nScenes);
  log(`story: ${scenes.length} beats`);

  // 2 ── ART (layered depth, parallel) ────────────────────────────────────────
  async function genArt(i: number) {
    const out = rd(`scene_${i}.png`);
    if (existsSync(out)) return;
    const text = `${scenes[i].shot ? scenes[i].shot.toUpperCase() + " SHOT. " : ""}${style.art}\nCompose in THREE clear depth layers (close foreground / midground subject / deep background). SCENE: ${scenes[i].visual}`;
    try {
      const bytes = deps.generateImage
        ? await deps.generateImage({ id: `${cfg.slug}-scene-${i}`, index: i, prompt: text })
        : await generateBananaImage({ prompt: text, aspectRatio: "16:9", imageSize: "2K" });
      await writeFile(out, Buffer.from(bytes));
      log(`art ${i} ✓`);
    } catch (e) {
      log(`scene ${i} art FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  await pool(4, scenes, (_, i) => genArt(i));
  for (let i = 0; i < scenes.length; i++) if (!existsSync(rd(`scene_${i}.png`))) throw new Error(`art ${i} missing (likely content-policy refusal — de-brand the topic)`);

  // 3 ── PER-LINE NARRATION (for exact timing) ────────────────────────────────
  const lineDur: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const f = rd(`line_${i}.mp3`);
    if (!existsSync(f)) {
      const speed = cfg.narrationSpeed ?? 0.96;
      const b = deps.synthLine
        ? await deps.synthLine({ index: i, text: scenes[i].line, voiceId: cfg.voiceId, speed })
        : await synthNarration({ text: scenes[i].line, provider: "elevenlabs", elevenVoiceId: cfg.voiceId, speed });
      await writeFile(f, Buffer.from(b));
    }
    lineDur[i] = await probe(f);
  }
  log(`lines: ${lineDur.map((d) => d.toFixed(1)).join(", ")}s  total≈${(lineDur.reduce((a, b) => a + b, 0) + scenes.length * cfg.pause).toFixed(0)}s`);

  // 3b ── MOTION ANALYSIS — LOOK at each painting, decide what is animatable, write the shot ──
  // This is the core: a vision pass grounds the i2v prompt in the REAL subject + particles + depth
  // of the actual image, so the clip animates the smith's arm/hammer/sparks, not just a slow pan.
  const motion: Array<MotionAnalysis | undefined> = new Array(scenes.length);
  async function analyzeMotion(i: number) {
    const out = rd(`motion_${i}.json`);
    if (existsSync(out)) { motion[i] = JSON.parse(await readFile(out, "utf8")); return; }
    deps.onVisionCall?.(i);
    const raw = await visionLocal({
      imagePaths: [rd(`scene_${i}.png`)], json: true, maxTokens: VISION_GATE_MAX_TOKENS, model: "gemini-2.5-flash",
      prompt:
        `You are the SHOT DIRECTOR for an image-to-video clip (~6s). Look CAREFULLY at this ${String(cfg.subStyle).replace(/_/g, " ")} illustration ` +
        `and decide what should MOVE, grounded ONLY in what is ACTUALLY visible. The CAMERA move is the heart of the shot; subject and particle motion are added ONLY when they genuinely belong. Do NOT invent motion. ` +
        `Return STRICT JSON with these keys: ` +
        `"camera" = ONE smooth cinematic camera move that TRAVELS THROUGH THE DEPTH and reveals parallax, naming the REAL foreground / midground / background you see (e.g. "slow dolly push-in past the foreground anvil toward the smith as the deep arched hall slides behind"). This is ALWAYS present. ` +
        `"subject_action" = the main figure/subject's SPECIFIC physical motion IF there is a clear acting figure (e.g. "the smith swings the hammer down onto the ring, arm and shoulder driving the blow"); if there is NO clear figure that would plausibly move, return EXACTLY "none". Do not animate statues, corpses, or still figures. ` +
        `"particles" = sparks/embers/fire/smoke/dust/mist/falling leaves/snow/water/glowing energy ACTUALLY visible that would flicker, fly or drift; if there are none, return "none"; ` +
        `"secondary" = smaller real motion (cloth, hair, robes, banners, flames, ripples, breathing); if none, "none"; ` +
        `"intensity" = how much TOTAL motion HONESTLY suits this moment: "gentle" for calm, quiet, still, contemplative or portrait scenes (MOST lore scenes), "moderate" for normal activity, "strong" ONLY for genuine action/chaos/battle/cataclysm. Default to gentle or moderate; reserve strong. ` +
        `Be concrete and specific to THIS picture. Output ONLY the JSON object.`,
    }).catch(() => "");
    let analysis: MotionAnalysis = {};
    try { analysis = (parseJsonLoose(raw) || {}) as MotionAnalysis; } catch { analysis = {}; }
    motion[i] = analysis;
    await writeFile(out, JSON.stringify(analysis, null, 2));
    log(`motion ${i}: ${String(analysis.subject_action || analysis.camera || "?").slice(0, 56)}`);
  }
  if (cfg.analyzeMotion) await pool(4, scenes, (_, i) => analyzeMotion(i));

  // 4 ── CAMERA MOVES (cheap i2v) — parallel ──────────────────────────────────
  const real = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !/^none\b/i.test(value.trim());
  function shotPrompt(i: number): { prompt: string; negative: string } {
    const m = motion[i];
    if (cfg.analyzeMotion && m && (real(m.subject_action) || real(m.camera))) {
      const intensity = m.intensity === "gentle" || m.intensity === "strong" ? m.intensity : "moderate";
      // camera ALWAYS leads (the depth core); subject/particles/secondary only when genuinely present
      const parts = [m.camera, m.subject_action, m.particles, m.secondary].filter(real);
      const negative = NEG_BASE + (intensity === "gentle" ? "" : NEG_ANTISTATIC); // don't force motion on calm scenes
      return { prompt: `${parts.join(". ")}.${HOLD[intensity]}`, negative };
    }
    const prompt = cfg.elaborateMoves ? `${CAM_MOVES[i % CAM_MOVES.length]}. ${scenes[i].camera}.${DEPTH_STRONG}` : `${scenes[i].camera}.${DEPTH_SIMPLE}`;
    return { prompt, negative: NEG_BASE + NEG_ANTISTATIC };
  }
  async function repI2V(i: number) {
    if (existsSync(rd(`clip_${i}.mp4`))) return;
    // downscale the scene to a compact 1280px JPEG and send it as a data URI (no nginx dependency)
    const imgJpg = rd(`img_${i}.jpg`);
    if (!existsSync(imgJpg)) await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd(`scene_${i}.png`), "-vf", "scale=1280:-2", "-q:v", "3", imgJpg]);
    const { prompt, negative } = shotPrompt(i);
    // INJECTED LANE (the pipeline block): the attested Novita render farm gets
    // the same shot prompt and the same downscaled still, and its receipts are
    // accumulated by the caller. No Replicate submission happens at all.
    if (deps.generateClip) {
      const bytes = await deps.generateClip({
        id: `${cfg.slug}-clip-${i}`,
        index: i,
        prompt,
        negativePrompt: negative,
        imagePath: imgJpg,
        durationSec: cfg.model === "seedance" ? cfg.seedanceDur : Math.max(1, Math.round(cfg.frames / 24)),
      });
      await writeFile(rd(`clip_${i}.mp4`), Buffer.from(bytes));
      log(`clip ${i} ✓ (injected generator)`);
      return;
    }
    const image = await dataUri(imgJpg, "image/jpeg");
    let endpoint: string, input: Record<string, unknown>, body: Record<string, unknown>;
    if (cfg.model === "seedance") {
      endpoint = "https://api.replicate.com/v1/predictions";
      input = { image, prompt, duration: cfg.seedanceDur, resolution: cfg.seedanceRes, aspect_ratio: "16:9" }; // Seedance has no negative_prompt
      body = { version: SEEDANCE_VERSION, input };
    } else if (cfg.model === "ltx") {
      endpoint = "https://api.replicate.com/v1/predictions";
      input = { image, prompt, resolution: 720, aspect_ratio: "16:9", num_frames: cfg.frames, negative_prompt: negative };
      body = { version: LTX_VERSION, input };
    } else {
      endpoint = "https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions";
      input = { image, prompt, resolution: "720p", num_frames: 81, negative_prompt: negative };
      body = { input };
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const sub = await rfetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let j = await sub.json() as ReplicatePrediction; const getUrl = j.urls?.get; const t0 = Date.now();
      while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); j = await (await rfetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 540000) break; }
      const url = Array.isArray(j.output) ? j.output[0] : j.output;
      if (url) { await writeFile(rd(`clip_${i}.mp4`), Buffer.from(await (await rfetch(url)).arrayBuffer())); log(`clip ${i} ✓`); return; }
      log(`clip ${i} attempt ${attempt + 1} failed: ${JSON.stringify(j.detail || j.error || j.title || j.status).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
    throw new Error(`scene ${i} i2v failed after retries`);
  }
  await pool(4, scenes, (_, i) => repI2V(i));

  // 4b ── 2K UPSCALE (cheap AI), parallel — Replicate real-esrgan-video → 2560x1440 ──
  async function upscaleClip(i: number) {
    if (cfg.upscale !== "realesrgan" || existsSync(rd(`up_${i}.mp4`))) return;
    const vpath = await dataUri(rd(`clip_${i}.mp4`), "video/mp4"); // embed clip directly — Replicate never fetches from nginx
    for (let attempt = 0; attempt < 4; attempt++) {
      const sub = await rfetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: ESRGAN_VER, input: { video_path: vpath, model: "RealESRGAN_x4plus", resolution: cfg.upscaleRes } }) });
      let j = await sub.json() as ReplicatePrediction; const getUrl = j.urls?.get; const t0 = Date.now();
      while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); j = await (await rfetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 600000) break; }
      const url = Array.isArray(j.output) ? j.output[0] : j.output;
      if (url) { await writeFile(rd(`up_${i}.mp4`), Buffer.from(await (await rfetch(url)).arrayBuffer())); log(`upscale ${i} ✓`); return; }
      log(`upscale ${i} attempt ${attempt + 1} failed: ${JSON.stringify(j.detail || j.error || j.title || j.status).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
    throw new Error(`scene ${i} upscale failed after retries`);
  }
  await pool(4, scenes, (_, i) => upscaleClip(i));
  const vid = (i: number) => (cfg.upscale === "realesrgan" ? rd(`up_${i}.mp4`) : rd(`clip_${i}.mp4`));

  // 5 ── EDIT: fit each shot to its line (+breath), cut on beats, dissolve, title, grade ──
  const SCALER = cfg.upscale === "ffmpeg" ? ":flags=lanczos" : "";
  const SHARP = cfg.upscale === "ffmpeg" ? ",unsharp=5:5:0.8:5:5:0.0" : "";
  for (let i = 0; i < scenes.length; i++) {
    const disp = lineDur[i] + cfg.pause;
    const nat = (await probe(vid(i))) || 5;
    const factor = Math.min(2.2, Math.max(0.45, disp / nat));
    await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", vid(i), "-vf",
      `setpts=${factor.toFixed(4)}*PTS,scale=${OW}:${OH}:force_original_aspect_ratio=increase${SCALER},crop=${OW}:${OH},fps=24${SHARP}`,
      "-t", disp.toFixed(3), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", rd(`fit_${i}.mp4`)]);
    await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd(`line_${i}.mp3`), "-af", `apad=pad_dur=${(cfg.pause + 0.3).toFixed(2)}`, "-t", disp.toFixed(3), "-ar", "48000", "-ac", "2", "-c:a", "aac", rd(`a_${i}.m4a`)]);
  }
  const offs: number[] = []; let acc = 0;
  for (let i = 0; i < scenes.length; i++) { const disp = lineDur[i] + cfg.pause; if (i > 0) offs.push(acc - cfg.dissolve); acc += disp - (i > 0 ? cfg.dissolve : 0); }
  let fc = "", prev = "0:v";
  for (let i = 1; i < scenes.length; i++) { const lbl = i === scenes.length - 1 ? "vx" : `x${i}`; fc += `[${prev}][${i}:v]xfade=transition=fade:duration=${cfg.dissolve}:offset=${offs[i - 1].toFixed(3)}[${lbl}];`; prev = lbl; }
  fc += `[${prev}]${style.grade}[v]`;
  const vin = scenes.flatMap((_, i) => ["-i", rd(`fit_${i}.mp4`)]);
  await sh("ffmpeg", ["-y", "-loglevel", "error", ...vin, "-filter_complex", fc, "-map", "[v]", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", PRESET, rd("visual.mp4")]);
  await writeFile(rd("aconcat.txt"), scenes.map((_, i) => `file '${rd(`a_${i}.m4a`)}'`).join("\n"));
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", rd("aconcat.txt"), "-c:a", "aac", rd("audio.m4a")]);
  const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
  const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
  const T = cfg.title.replace(/[':]/g, ""), K = cfg.kicker.replace(/[':]/g, "");
  const sc = OH / 1080, fz1 = Math.round(124 * sc), fz2 = Math.round(48 * sc), ky = Math.round(154 * sc);
  // body = the narrated scenes, graded, with a gentle end fade (NO title over them — the card owns the title)
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("visual.mp4"), "-vf", `fade=t=out:st=${(acc - 1).toFixed(2)}:d=1`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", PRESET, rd("body.mp4")]);

  // 6 ── TITLE CARD (RULE: a held title card plays BEFORE the narration starts) ────────────────
  const intro = Math.max(0, cfg.introSec || 0);
  let head = rd("body.mp4"), total = acc, delayMs = 120;
  if (intro > 0.4) {
    const cardA = "alpha='if(lt(t,0.5),0,if(lt(t,1.2),(t-0.5)/0.7,1))'"; // title fades in, holds; xfade blends it out
    const cardVf = [
      `scale=${OW}:${OH}:force_original_aspect_ratio=increase,crop=${OW}:${OH}`, "eq=brightness=-0.15:saturation=0.6", "gblur=sigma=8",
      `drawtext=fontfile=${F_SC}:text='${T}':fontcolor=0xEAD9B0:fontsize=${fz1}:x=(w-text_w)/2:y=h*0.42:borderw=3:bordercolor=0x000000C0:shadowx=0:shadowy=2:${cardA}`,
      `drawtext=fontfile=${F_IT}:text='${K}':fontcolor=0xD9C8A2:fontsize=${fz2}:x=(w-text_w)/2:y=h*0.42+${ky}:borderw=2:bordercolor=0x000000B0:${cardA}`,
      "fade=t=in:st=0:d=0.5",
    ].join(",");
    await sh("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-t", intro.toFixed(2), "-i", rd("scene_0.png"), "-vf", cardVf, "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", PRESET, rd("card.mp4")]);
    await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("card.mp4"), "-i", rd("body.mp4"), "-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=0.5:offset=${(intro - 0.5).toFixed(2)}[v]`, "-map", "[v]", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", PRESET, rd("titled.mp4")]);
    head = rd("titled.mp4"); total = intro + acc - 0.5; delayMs = Math.round(intro * 1000) + 120;
  }
  // narration begins only AFTER the title card
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", head, "-i", rd("audio.m4a"), "-filter_complex", `[1:a]adelay=${delayMs}|${delayMs}[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("final.mp4")]);
  // PUBLICATION is a sink, not a hardcoded nginx copy. The default reproduces
  // the original VPS behaviour byte-for-byte; the pipeline block swaps in an R2
  // putObjectFromFile and returns a videoKey.
  const published = deps.publish
    ? await deps.publish({ slug: cfg.slug, localPath: rd("final.mp4") })
    : await (async (): Promise<LorePublishResult> => {
        const pub = join(WEB, `${cfg.slug}.mp4`);
        await copyFile(rd("final.mp4"), pub);
        return { videoPath: pub, url: `${cfg.host}/loreshort/${cfg.slug}.mp4` };
      })();
  log(`DONE ${published.videoPath}`);
  return { videoPath: published.videoPath, url: published.url, scenes, durationSec: total, width: OW, height: OH };
}
