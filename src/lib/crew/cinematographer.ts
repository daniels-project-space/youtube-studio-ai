/**
 * Cinematographer (DP) — a per-channel CREW SUB-MODULE. The DP owns the LOOK and,
 * critically, the SHOT COVERAGE: turning a script into a real shot list with varied
 * sizes (wide/medium/close), INSERTS/cutaways (the map, hands, the objective),
 * REACTION shots and cut-to-antagonist — not endless push-ins on the host. It is the
 * missing brain behind the long-declared `cinematographer` role (roles.ts) whose
 * sub-module was never built (index.ts: "director/dp/composer/critic to follow").
 *
 * Config resolver + directives mirror editor.ts/director.ts exactly. `planCoverage()`
 * is the script/scene-aware shot planner (Gemini Pro), producing cinecraft `ShotSpec`s
 * (no new shot type) that the visual stage (gen_footage) renders.
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, knobDefaults, type KnobValue, type CustomizationSurface } from "@/engine/customization";
import { geminiJsonPro, hasGeminiKey } from "@/lib/gemini";
import type { ShotSpec } from "@/lib/cinecraft";

export const CINEMATOGRAPHER_SURFACE: CustomizationSurface = {
  capabilities: [
    "shot COVERAGE per beat (wide/medium/close + inserts + reactions — not host-only)",
    "camera-move grammar (dolly/crane/orbit/pan/crash-zoom, matched to energy)",
    "lens language + lighting key (the channel's optical look)",
    "cut-to-subject discipline (objective, antagonist, bystanders — story-driven)",
  ],
  knobs: [
    { id: "coverageDensity", type: "number", range: [1, 3], default: 2, describes: "shots per story beat (1 = spare, 3 = rich coverage)", servesStyles: ["cinematic", "documentary"] },
    { id: "shotSizeMix", type: "enum", values: ["balanced", "wide_led", "intimate", "kinetic"], default: "balanced", describes: "the shot-size palette — balanced / wide-establishing-led / close-up-intimate / dynamic-kinetic", servesStyles: ["cinematic", "documentary", "hype"] },
    { id: "insertFrequency", type: "enum", values: ["none", "light", "rich"], default: "light", describes: "how often to cut to INSERTS/cutaways (objects, hands, documents, mechanisms)", servesStyles: ["documentary", "explainer"] },
    { id: "cameraEnergy", type: "enum", values: ["locked", "measured", "dynamic", "frenetic"], default: "measured", describes: "camera-move vocabulary + intensity", servesStyles: ["meditation", "documentary", "hype", "shorts"] },
    { id: "lensLanguage", type: "enum", values: ["natural", "wide", "tele", "anamorphic"], default: "natural", describes: "lens character (natural 35-50mm / wide 18-24mm / tele 85-135mm / anamorphic + flares)", servesStyles: ["cinematic"] },
    { id: "lightingKey", type: "enum", values: ["natural", "low_key", "high_key", "noir"], default: "natural", describes: "lighting doctrine (natural / low-key moody / high-key bright / noir chiaroscuro)", servesStyles: ["cinematic", "documentary"] },
    { id: "speedRamps", type: "boolean", default: false, describes: "allow slow-motion / speed-ramp notes on hero shots (smooths AI jitter, adds prestige)", servesStyles: ["hype", "cinematic"] },
  ],
  presets: {
    documentary: { coverageDensity: 3, shotSizeMix: "balanced", insertFrequency: "rich", cameraEnergy: "measured", lensLanguage: "natural", lightingKey: "low_key" },
    essay: { coverageDensity: 2, shotSizeMix: "balanced", insertFrequency: "light", cameraEnergy: "measured" },
    cinematic: { coverageDensity: 3, shotSizeMix: "balanced", insertFrequency: "rich", cameraEnergy: "dynamic", lensLanguage: "anamorphic", lightingKey: "noir", speedRamps: true },
    hype: { coverageDensity: 2, shotSizeMix: "kinetic", insertFrequency: "light", cameraEnergy: "frenetic", speedRamps: true },
    shorts: { coverageDensity: 1, shotSizeMix: "kinetic", insertFrequency: "light", cameraEnergy: "frenetic" },
    meditation: { coverageDensity: 1, shotSizeMix: "wide_led", insertFrequency: "none", cameraEnergy: "locked", lightingKey: "high_key" },
  },
};

export interface CinematographerConfig {
  coverageDensity: number;
  shotSizeMix: string;
  insertFrequency: string;
  cameraEnergy: string;
  lensLanguage: string;
  lightingKey: string;
  speedRamps: boolean;
}

export const CINEMATOGRAPHER_BLOCK = "dp_brief";

/** Resolve the DP's per-channel config from the ChannelProfile (preset + overrides). Pure. */
export function resolveCinematographerConfig(profile: ChannelProfile, block = CINEMATOGRAPHER_BLOCK): CinematographerConfig {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;
  const overrides: Record<string, KnobValue> = {};
  for (const k of CINEMATOGRAPHER_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const r = resolveKnobs(CINEMATOGRAPHER_SURFACE, preset, overrides);
  if (!r.ok) throw new Error(`resolveCinematographerConfig: ${r.errors.join("; ")}`);
  const k = r.values;
  return {
    coverageDensity: Number(k.coverageDensity),
    shotSizeMix: String(k.shotSizeMix),
    insertFrequency: String(k.insertFrequency),
    cameraEnergy: String(k.cameraEnergy),
    lensLanguage: String(k.lensLanguage),
    lightingKey: String(k.lightingKey),
    speedRamps: Boolean(k.speedRamps),
  };
}

/** Default DP config (all knob defaults) — for callers without a resolved ChannelProfile. */
export function defaultCinematographerConfig(): CinematographerConfig {
  const d = knobDefaults(CINEMATOGRAPHER_SURFACE);
  return {
    coverageDensity: Number(d.coverageDensity),
    shotSizeMix: String(d.shotSizeMix),
    insertFrequency: String(d.insertFrequency),
    cameraEnergy: String(d.cameraEnergy),
    lensLanguage: String(d.lensLanguage),
    lightingKey: String(d.lightingKey),
    speedRamps: Boolean(d.speedRamps),
  };
}

/* --------------------------- directives (pure) --------------------------- */

const SHOT_SIZES: Record<string, string[]> = {
  balanced: ["wide establishing", "medium", "close-up", "insert"],
  wide_led: ["wide establishing", "wide", "medium", "insert"],
  intimate: ["close-up", "medium close-up", "reaction close-up", "insert"],
  kinetic: ["dynamic medium", "close-up", "insert", "wide"],
};
const CAMERA_MOVES: Record<string, string[]> = {
  locked: ["static", "slow dolly in", "slow dolly out"],
  measured: ["dolly in", "dolly out", "pan left", "pan right", "crane up", "gentle push-in", "slow orbit"],
  dynamic: ["tracking", "crane down", "orbit", "handheld follow", "crash zoom in", "dolly zoom", "whip pan"],
  frenetic: ["crash zoom in", "crash zoom out", "whip pan", "handheld", "snap zoom", "fast tracking"],
};
const LENS: Record<string, string> = {
  natural: "natural 35-50mm, shallow depth of field",
  wide: "wide 18-24mm, deep focus, slight distortion",
  tele: "telephoto 85-135mm, compressed background, creamy bokeh",
  anamorphic: "anamorphic ~40mm, horizontal flares, oval bokeh, 2.39 feel",
};
const LIGHTING: Record<string, string> = {
  natural: "motivated natural light, soft key",
  low_key: "low-key, moody, deep shadows, single motivated source",
  high_key: "high-key, bright, soft even light, minimal shadow",
  noir: "noir chiaroscuro, hard single source, pools of light in darkness",
};
const INSERT_GUIDANCE: Record<string, string> = {
  none: "Do NOT add insert/cutaway shots.",
  light: "Add an INSERT/cutaway (object, hands, document, mechanism) about once every 2-3 beats.",
  rich: "Cut to INSERTS/cutaways liberally — objects, hands at work, documents, mechanisms, the objective — most beats get one.",
};

/** The DP's structured directives — the concrete guidance planCoverage & the brief consume. */
export interface DpDirectives {
  coverageDensity: number;
  shotSizes: string[];
  cameraMoves: string[];
  insertGuidance: string;
  lens: string;
  lighting: string;
  speedRamps: boolean;
  /** One-paragraph coverage rubric handed to the shot-planner LLM. */
  rubric: string;
}

/** Map a CinematographerConfig to concrete DP directives. Pure. */
export function cinematographerDirectives(cfg: CinematographerConfig): DpDirectives {
  const shotSizes = SHOT_SIZES[cfg.shotSizeMix] ?? SHOT_SIZES.balanced;
  const cameraMoves = CAMERA_MOVES[cfg.cameraEnergy] ?? CAMERA_MOVES.measured;
  const lens = LENS[cfg.lensLanguage] ?? LENS.natural;
  const lighting = LIGHTING[cfg.lightingKey] ?? LIGHTING.natural;
  const insertGuidance = INSERT_GUIDANCE[cfg.insertFrequency] ?? INSERT_GUIDANCE.light;
  const rubric =
    `Cover the story like a director of photography, not a talking-head camera. ` +
    `Vary shot size across ${shotSizes.join(", ")}. ${insertGuidance} ` +
    `Do NOT frame every shot on the host — cut to the OBJECTIVE, the ANTAGONIST (e.g. pursuers/police), ` +
    `BYSTANDERS reacting, hands performing the action, and the environment. Move the camera only with ` +
    `motivated moves from: ${cameraMoves.join(", ")}. Lens: ${lens}. Lighting: ${lighting}.` +
    (cfg.speedRamps ? " Slow-motion / speed-ramp is allowed on hero moments." : "");
  return { coverageDensity: cfg.coverageDensity, shotSizes, cameraMoves, insertGuidance, lens, lighting, speedRamps: cfg.speedRamps, rubric };
}

/* ---------------------------- planCoverage ------------------------------ */

export interface CoverageScript {
  hook?: string;
  sections?: { heading?: string; narration?: string }[];
}
export interface CoverageSubject {
  name: string;
  kind?: string;
  look?: string;
}
export interface PlanCoverageArgs {
  script: CoverageScript;
  cfg?: CinematographerConfig;
  directives?: DpDirectives;
  dpDoctrine?: string;
  subjects?: CoverageSubject[];
  look?: { style?: string; look?: string; cameraGrammar?: string };
  /** Locked visual world (from Style-DNA) — repeated into every keyframe prompt. */
  styleLock?: string;
  avoid?: string;
  period?: string;
  niche?: string;
  /** Total shots to plan (default = sections × coverageDensity). */
  targetShots?: number;
  clipSec?: number;
  log?: (m: string) => void;
}

/**
 * Turn the SCRIPT (hook + sections) into a coverage-rich cinematic SHOT LIST — the DP
 * brain. Reuses cinecraft's `ShotSpec`. Understands each beat's context and gives it
 * varied coverage: wide/medium/close + inserts + reaction/antagonist cuts + subject
 * variety, with a motivated camera move, lens and lighting per the DP config. Throws if
 * no Gemini key (no silent thin fallback — mirrors synthScript/buildShotScript).
 */
export async function planCoverage(args: PlanCoverageArgs): Promise<ShotSpec[]> {
  if (!hasGeminiKey()) throw new Error("cinematographer.planCoverage: GEMINI_API_KEY missing (no fallback)");
  const cfg = args.cfg ?? defaultCinematographerConfig();
  const dir = args.directives ?? cinematographerDirectives(cfg);
  const sections = (args.script.sections ?? []).filter((s) => (s.heading || s.narration));
  const nShots = Math.max(4, args.targetShots ?? Math.round(sections.length * cfg.coverageDensity) + 1);
  const clipSec = Math.min(10, Math.max(4, args.clipSec ?? 5));
  const beats = sections.map((s, i) => `${i + 1}. ${s.heading ?? ""}: ${(s.narration ?? "").slice(0, 220)}`).join("\n");
  const chars = (args.subjects ?? []).filter((s) => (s.kind ?? "character") !== "location");
  const places = (args.subjects ?? []).filter((s) => s.kind === "location");

  const out = await geminiJsonPro<{ shots?: ShotSpec[] }>({
    prompt: [
      `You are the CINEMATOGRAPHER (director of photography) of a ${args.look?.style ?? "cinematic"} ${args.niche ?? "documentary"} reconstruction${args.period ? ` (${args.period})` : ""}.`,
      `COVERAGE DOCTRINE: ${dir.rubric}`,
      args.look?.look ? `LOOK: ${args.look.look}. CAMERA GRAMMAR: ${args.look.cameraGrammar ?? ""}.` : "",
      args.styleLock ? `LOCKED VISUAL WORLD (every keyframePrompt MUST live in it, repeat its style words): ${args.styleLock}` : "",
      args.avoid ? `NEVER show: ${args.avoid}` : "",
      args.dpDoctrine ? `Your channel doctrine: ${args.dpDoctrine}` : "",
      chars.length ? `SUBJECTS (use exact names; keep each identical every shot; NOT every shot is the host):\n${chars.map((c) => `- ${c.name}${c.look ? `: ${c.look}` : ""}`).join("\n")}` : "",
      places.length ? `RECURRING LOCATIONS (exact names; keep consistent):\n${places.map((c) => `- ${c.name}${c.look ? `: ${c.look}` : ""}`).join("\n")}` : "",
      `SCRIPT (the story, in order):\n${args.script.hook ? `HOOK: ${args.script.hook}\n` : ""}${beats}`,
      `Produce EXACTLY ${nShots} shots that COVER this story in order (roughly ${cfg.coverageDensity} per beat). ` +
        `Vary shot size (${dir.shotSizes.join(", ")}). Include establishing shots AND inserts (subjects=[] for a pure atmosphere/insert). ` +
        `Cut to the objective, the antagonist, and reactions — not only the host. Each shot ~${clipSec}s.`,
      `For each shot return: id (1..${nShots}), beat (which script beat), subjects (exact names present; EMPTY array for atmosphere/insert), setting, action, ` +
        `keyframePrompt (START-FRAME: subject/environment/framing/lighting in the locked world — do NOT redescribe a subject's identity, it is anchored elsewhere), ` +
        `cameraMove (ONE motivated move from: ${dir.cameraMoves.join(", ")}), lens (${dir.lens}), mood, ` +
        `i2vPrompt (image-to-video motion: the camera move + what moves in-frame for ${clipSec}s), ` +
        `transition (cut/match-cut/whip/dip-to-black/continuous), durationSec (${clipSec}).`,
      `Return STRICT JSON {"shots":[{id,beat,subjects,setting,action,keyframePrompt,cameraMove,lens,mood,i2vPrompt,transition,durationSec}]}.`,
    ].filter(Boolean).join("\n\n"),
    maxTokens: 8000,
    temperature: 0.7,
    log: args.log,
  });

  const shots = (out.shots ?? [])
    .filter((s) => s?.keyframePrompt && s?.i2vPrompt)
    .map((s, i) => ({
      ...s,
      id: s.id ?? i + 1,
      subjects: Array.isArray(s.subjects) ? s.subjects : [],
      durationSec: s.durationSec || clipSec,
      lens: s.lens || dir.lens,
      transition: s.transition || "cut",
    }));
  const inserts = shots.filter((s) => !s.subjects.length).length;
  args.log?.(`cinematographer: ${shots.length} shots planned (${inserts} inserts/atmosphere; density ${cfg.coverageDensity})`);
  return shots;
}

export const CINEMATOGRAPHER_MODULE = {
  key: "dp_brief",
  title: "Crew · Cinematographer",
  stage: "brief",
  does:
    "The cinematographer (DP) owns the look AND the shot coverage: it turns the script into a real shot list " +
    "with varied sizes (wide/medium/close), inserts/cutaways, reaction + antagonist cuts and subject variety — " +
    "with motivated camera moves, lens and lighting. planCoverage() produces cinecraft ShotSpecs the visual " +
    "stage (gen_footage) renders. Crew directs, the visual module renders.",
  produces: { kind: "shot_plan", file: "n/a", returns: "CinematographerConfig + DpDirectives + planCoverage(script) → ShotSpec[]" },
  requires: { channelProfile: "ChannelProfile — supplies DP preset + overrides (moduleConfig['dp_brief'])" },
  optional: { script: "the video's Script (hook + sections) — planCoverage plans coverage from it" },
  needs: { secrets: ["GEMINI_API_KEY"], tools: [], note: "Config/directives are pure; planCoverage calls Gemini Pro to author the shot list." },
  customization: CINEMATOGRAPHER_SURFACE,
  rules: [
    "DP OWNS COVERAGE: shot-size mix + inserts + reactions + camera grammar — NOT host-only push-ins.",
    "SUBJECT VARIETY: cut to the objective, the antagonist, bystanders and hands — empty subjects[] = atmosphere/insert.",
    "PER-ACCOUNT: all DP choices come from moduleConfig['dp_brief'] (preset + overrides).",
    "REUSES ShotSpec: planCoverage emits cinecraft ShotSpecs — no parallel shot type.",
  ],
} as const;
