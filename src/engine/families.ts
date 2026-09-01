import {
  assessPipelineVideoRuntimeReadiness,
  NOVITA_VIDEO_RUNTIME_REMEDIATION,
  type NovitaVideoRuntimeTarget,
  type PipelineRuntimeBlockInput,
} from "./runtimeCapability";
import { familyChannelInceptionCapability } from "./channelInceptionCapability";
import {
  assertNarratedFoundationFormatContract,
  narratedPlanningFoundation,
  type NarratedFoundationFamily,
} from "./narratedPlanningFoundation";
import { isProductionQualityGenerationProfile } from "./generationProfiles";

/**
 * Engine families = curated presets that map a channel format to a base pipeline
 * (an archetype) + its visual engine + required keys. The builder picks a family
 * (from the niche default or the operator), then the designer derives a concrete,
 * validated pipeline from it. Families whose visual engine isn't built yet are
 * `available: false` → the channel is created as a DRAFT until the module ships.
 */
export type FamilyKey =
  | "narrated_stock"
  | "cinematic"
  | "music_loop"
  | "sleep"
  | "shorts"
  | "documentary_collage_short"
  | "whiteboard"
  | "comic"
  | "loreshort"
  | "quizyear"
  | "illustrated_explainer"
  | "children_learning";

export interface Family {
  key: FamilyKey;
  label: string;
  description: string;
  /** Visual-engine module id for the `visuals` slot. */
  visualEngine: string;
  /** Base archetype whose (valid) pipeline the designer derives from. */
  archetypeKey: string;
  /** false → visual engine not built yet; channel saved as draft. */
  available: boolean;
  /** Whether this family narrates (drives wizard voice questions). */
  narrated: boolean;
  requiresKeys: string[];
  /** Every production channel delegates its final thumbnail to Nano Banana. */
  defaultThumbnailStyle: "banana";
  /** Default per-video spend envelope when the operator did not set one. */
  defaultRunBudgetUsd?: number;
  /**
   * Default LTX 2.5 visual-style preset id for families whose visual engine
   * renders through the shared LTX I2V prompt contract (see
   * src/engine/ltxStylePresets.ts, src/lib/ltxI2vPrompt.ts). Omitted for
   * families that don't render through that contract; consumers that do
   * should fall back to DEFAULT_LTX_STYLE_ID (mirrors the `defaultRunBudgetUsd
   * ?? <fallback>` pattern used elsewhere against this catalog).
   */
  styleId?: string;
}

export const FAMILIES: Record<FamilyKey, Family> = {
  narrated_stock: {
    key: "narrated_stock",
    label: "Narrated + Stock footage",
    description:
      "Researched narration over themed real b-roll. Stoicism, psychology, finance-lite, scripture readings, motivational, 7-day series.",
    visualEngine: "stock_footage",
    archetypeKey: "narrated-essay",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "pexels", "mureka"],
    defaultThumbnailStyle: "banana",
    // Current standard-episode compiler reservation includes fully batched
    // final visual evidence. Keep the creator floor above that sealed cost.
    defaultRunBudgetUsd: 2,
  },
  music_loop: {
    key: "music_loop",
    label: "Music + looping visual",
    description:
      "Long music track under a seamless animated loop (lofi, ghibli, pixel, rainy neon). No narration.",
    visualEngine: "seamless_loops",
    archetypeKey: "lofi-ambient",
    available: true,
    narrated: false,
    requiresKeys: ["suno", "novita", "openrouter-vision"],
    // The final cover always uses the universal Nano Banana scene path with
    // deterministic local typography.
    defaultThumbnailStyle: "banana",
    // Standard production loop + final visual/audio review reservation.
    defaultRunBudgetUsd: 3.5,
  },
  sleep: {
    key: "sleep",
    label: "Ambient / Sleep / Meditation",
    description: "Calm long-form guided narration (or none) + slow ambient visuals + soft music.",
    visualEngine: "ambient_visual",
    archetypeKey: "meditation",
    available: true,
    // The meditation archetype IS narrated (script_gen style=meditation +
    // narration_tts pace slow). narrated:false skipped the wizard voice
    // questions AND voice casting — every meditation channel spoke in the
    // fallback default voice while the architect saw a loop-only toolbox.
    narrated: true,
    requiresKeys: ["mureka", "pexels", "fish-audio"],
    defaultThumbnailStyle: "banana",
    // Narrated ambient masters retain the same complete final-review envelope.
    defaultRunBudgetUsd: 2,
  },
  comic: {
    key: "comic",
    label: "Motion comic (3D drawn page)",
    description:
      "A narrated comic page that DRAWS ITSELF OUT in 3D: character-consistent panels, multi-voice " +
      "dialogue bubbles, hand-drawn reveal, page turns. History, stories, true events, with bounded attested image workers.",
    visualEngine: "motion_comic",
    archetypeKey: "narrated-essay",
    available: true,
    narrated: true,
    // Legacy Gemini helpers are deliberately not a runtime capability. This
    // family stays unadmitted until its planner/renderer route is fully
    // non-Google; its thumbnail is the sole sealed exception elsewhere.
    requiresKeys: ["elevenlabs", "novita"],
    defaultThumbnailStyle: "banana",
    // The standard eight-panel comic reserves direct panel workers plus the
    // complete final-review envelope at its real teardown-verified ceiling.
    defaultRunBudgetUsd: 8,
  },
  shorts: {
    key: "shorts",
    label: "Shorts (vertical)",
    description: "9:16 hook-driven short — motivational speech cuts, fast captions.",
    visualEngine: "shorts_cuts",
    archetypeKey: "shorts",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "pexels"],
    defaultThumbnailStyle: "banana",
    // Portrait production includes complete final visual evidence, not a
    // representative sample.
    defaultRunBudgetUsd: 2,
  },
  documentary_collage_short: {
    key: "documentary_collage_short",
    label: "Documentary collage Shorts",
    description:
      "Source-backed, native 9:16 documentary Shorts: locked narration beats, evidence-board/collage motion, portrait-safe scene QA.",
    visualEngine: "documotion_short",
    archetypeKey: "documentary-collage-short",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "novita"],
    defaultThumbnailStyle: "banana",
    // Seven gated Nano Banana plates, portrait verification, and a high-memory
    // native master have a truthful $25.29 reserved envelope. Keep a modest
    // buffer rather than silently weakening the existing preflight rail.
    defaultRunBudgetUsd: 30,
  },
  whiteboard: {
    key: "whiteboard",
    label: "Whiteboard explainer (drawn cinema)",
    description:
      "Narration-synced hand-drawn whiteboard explainer (history, finance, explainers). DRAWN-CINEMA engine: non-Google storyboards layered scenes, Fish narrates, Whisper aligns, and a deterministic hand draws each beat in time with the voice using bounded attested image workers. 1080p / 2K.",
    visualEngine: "whiteboard_scribe",
    archetypeKey: "narrated-essay",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "novita"],
    defaultThumbnailStyle: "banana",
    // The authored five-minute board reserves just over $25 once every direct
    // drawing layer and its full final-QA evidence plan are admitted. Keep a
    // small declared floor above that exact compiled envelope rather than
    // weakening review coverage to fit an obsolete $25 budget.
    defaultRunBudgetUsd: 25.25,
  },
  loreshort: {
    key: "loreshort",
    label: "Lore micro-documentary",
    description:
      "First-person 'Histories & Lore' micro-doc: one narrator recounts a history over painted concept art with genuine " +
      "3D depth camera moves, cut to the voice beat by beat. Self-contained — writes, paints, animates and edits itself.",
    visualEngine: "lore_short",
    archetypeKey: "lore-short",
    available: true,
    narrated: true,
    requiresKeys: ["novita", "fish-audio"],
    defaultThumbnailStyle: "banana",
    // Nine beats, each an attested Novita still plus one attested LTX-class i2v
    // clip, finished with the FREE ffmpeg 2K lane (no paid upscale). Budget is
    // a conservative envelope over that bounded shot count, not an invoice.
    defaultRunBudgetUsd: 12,
  },
  quizyear: {
    key: "quizyear",
    label: "Mixed trivia quiz",
    description:
      "Multiple-choice trivia quiz that mixes categories inside one video — guess-the-year, capital cities, " +
      "currencies, chemical symbols and atomic numbers — with four options, a depleting " +
      "timer and a lock-in reveal. Self-contained: sources its own facts, writes its own questions and renders itself.",
    visualEngine: "quiz_year",
    archetypeKey: "quiz-year",
    available: true,
    // No spoken narration: the format is on-screen typography plus a timer.
    narrated: false,
    // The certified autonomous route is deliberately Gemini-free: it selects
    // from a curated, safety-screened topic registry, sources only CC0
    // Wikidata facts, renders locally, and uses an original non-vocal music
    // bed plus a non-Gemini vision QA provider. Legacy Google helpers are
    // unavailable to this production family.
    requiresKeys: ["mureka", "groq-or-fal-vision"],
    // The video remains local/CC0, but every final thumbnail is intentionally
    // routed through the universal Nano Banana thumbnail module.
    defaultThumbnailStyle: "banana",
    // Facts, planning and pixels are local/CC0. Reserve an original music bed,
    // the mandatory production QA, and the sealed thumbnail request.
    defaultRunBudgetUsd: 3,
  },
  illustrated_explainer: {
    key: "illustrated_explainer",
    label: "Illustrated explainer (scene compiler)",
    description:
      "A causal narrated explainer rendered from a deterministic Episode Graph: maps, diagrams, charts, panels and original vector characters stay locked to timed story beats without a video-generation provider.",
    visualEngine: "scene_compiler",
    archetypeKey: "illustrated-explainer",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "mureka"],
    // The video stays deterministic/local; its final thumbnail uses the shared
    // Nano Banana module so every channel follows one image-quality path.
    defaultThumbnailStyle: "banana",
    // Local vector rendering adds no provider-media line item; the envelope is
    // narration, original music, and final quality evidence.
    defaultRunBudgetUsd: 2,
  },
  children_learning: {
    key: "children_learning",
    label: "Original children’s learning show (supervised)",
    description:
      "Original 2D learning stories for a declared age band: one life-skill or learning objective, stable characters and settings, deterministic animation, and a mandatory human-review-only release path.",
    visualEngine: "scene_compiler",
    archetypeKey: "children-learning",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "mureka"],
    defaultThumbnailStyle: "banana",
    // The media renderer is local; this reserves the same audible-quality and
    // final-review envelope as the illustrated explainer. Public/scheduled
    // release is separately blocked by the children’s safety contract.
    defaultRunBudgetUsd: 2,
  },
  cinematic: {
    key: "cinematic",
    label: "Cinematic AI scenes",
    description:
      "Fully produced multi-scene AI-rendered video with a locked Z-Image-to-LTX shot chain, automatic identity QA, edits, score, and structure. Requires a preflighted per-video spend plan; insufficient caps fail closed.",
    visualEngine: "ai_scenes",
    archetypeKey: "crime-narrative",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "mureka", "novita"],
    defaultThumbnailStyle: "banana",
    // The production compiler reserves $123.86 for the current locked
    // Z-Image → QA → LTX chain. Keep a visible buffer so the creator never
    // advertises a cinematic channel that its own runtime must reject.
    defaultRunBudgetUsd: 130,
    // Matches DEFAULT_LTX_STYLE_ID in src/engine/ltxStylePresets.ts — the
    // exact look this family has always rendered through. Baked in literally
    // (rather than left unset to fall back implicitly) so the family catalog
    // stays the single discoverable source of truth for which visual world
    // a cinematic channel renders in today.
    styleId: "cinematic_heist_noir",
  },
};

/**
 * A family is not just a visual renderer: its story unit has a bounded
 * duration. Keeping that contract beside the family catalog prevents a
 * generic wizard default from quietly exceeding a specialist renderer's
 * panel, beat, evidence, or provider-cost envelope.
 *
 * The public request still transports `lengthMinutes` for backwards
 * compatibility. The creator converts its seconds controls at the edge and
 * this contract remains the authoritative validation point for every caller.
 */
export type FamilyDurationInputUnit = "hours" | "minutes" | "seconds" | "fixed";

export interface FamilyDurationContract {
  /** Smallest finished-master duration that preserves the format's unit. */
  minimumSeconds: number;
  /** Largest duration the current renderer, editorial unit, and cost model own. */
  maximumSeconds: number;
  /** Used when a caller omits a duration or a generic niche preset does not fit. */
  defaultSeconds: number;
  /** The meaningful authoring increment, not an arbitrary numeric spinner step. */
  stepSeconds: number;
  inputUnit: FamilyDurationInputUnit;
  /** Explains the creative constraint in the creator without exposing internals. */
  rationale: string;
}

export const FAMILY_DURATION_CONTRACTS: Readonly<Record<FamilyKey, FamilyDurationContract>> = {
  narrated_stock: {
    minimumSeconds: 60,
    maximumSeconds: 3_600,
    defaultSeconds: 600,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "Long-form researched narration; the timed story spine scales in one-minute units.",
  },
  music_loop: {
    minimumSeconds: 3_600,
    maximumSeconds: 28_800,
    defaultSeconds: 7_200,
    stepSeconds: 3_600,
    inputUnit: "hours",
    rationale: "A sealed 30-second visual unit streams under an original mastered mix for one to eight hours.",
  },
  sleep: {
    minimumSeconds: 60,
    maximumSeconds: 3_600,
    defaultSeconds: 600,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "Guided ambient narration is authored in calm one-minute pacing units.",
  },
  comic: {
    minimumSeconds: 88,
    maximumSeconds: 264,
    defaultSeconds: 176,
    stepSeconds: 22,
    inputUnit: "seconds",
    rationale: "Four to twelve 22-second comic panels preserve a complete visual arc and readable dialogue.",
  },
  shorts: {
    minimumSeconds: 15,
    maximumSeconds: 60,
    defaultSeconds: 50,
    stepSeconds: 5,
    inputUnit: "seconds",
    rationale: "Native 9:16 Shorts must stay inside the platform-length and retention design window.",
  },
  documentary_collage_short: {
    minimumSeconds: 35,
    maximumSeconds: 60,
    defaultSeconds: 52,
    stepSeconds: 1,
    inputUnit: "seconds",
    rationale: "Five to seven evidence-backed portrait beats are designed for a 35–60 second documentary Short.",
  },
  whiteboard: {
    minimumSeconds: 60,
    maximumSeconds: 600,
    defaultSeconds: 300,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "The drawn-cinema board is bounded to ten minutes so every causal beat remains legible and reviewed.",
  },
  loreshort: {
    minimumSeconds: 36,
    maximumSeconds: 96,
    defaultSeconds: 54,
    stepSeconds: 6,
    inputUnit: "seconds",
    rationale: "Six to sixteen six-second first-person lore beats are the complete micro-documentary unit.",
  },
  quizyear: {
    minimumSeconds: 80,
    maximumSeconds: 80,
    defaultSeconds: 80,
    stepSeconds: 1,
    inputUnit: "fixed",
    rationale: "The mixed-trivia round and timer system owns a fixed 80-second episode cadence.",
  },
  illustrated_explainer: {
    minimumSeconds: 60,
    maximumSeconds: 900,
    defaultSeconds: 300,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "The deterministic scene grammar keeps a five-minute causal explainer legible while retaining a bounded beat and review load.",
  },
  children_learning: {
    minimumSeconds: 60,
    maximumSeconds: 360,
    defaultSeconds: 180,
    stepSeconds: 30,
    inputUnit: "minutes",
    rationale: "A supervised children’s episode is a short, complete beginning–middle–resolution story with one clear learning objective.",
  },
  cinematic: {
    minimumSeconds: 60,
    maximumSeconds: 300,
    defaultSeconds: 300,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "The current 50-shot production envelope is deliberately bounded to a five-minute cinematic episode.",
  },
};

export function familyDurationContract(family: FamilyKey): FamilyDurationContract {
  return FAMILY_DURATION_CONTRACTS[family];
}

export type FamilyTimeScalingContract =
  | Readonly<{
      method: "authored_timeline";
      finalDurationSource: "episode_contract";
    }>
  | Readonly<{
      method: "fixed_cadence";
      finalDurationSource: "family_default";
    }>
  | Readonly<{
      method: "stream_loop";
      finalDurationSource: "episode_contract";
      sourceSegmentCount: 2;
      sourceSegmentSeconds: 15;
      sourceUnitSeconds: 30;
      loopMode: "flf2v";
      seamMaximumDiff: 0.12;
      assembly: "ffmpeg_stream_loop";
    }>;

const AUTHORED_TIMELINE = Object.freeze({
  method: "authored_timeline",
  finalDurationSource: "episode_contract",
} as const);
const FIXED_CADENCE = Object.freeze({
  method: "fixed_cadence",
  finalDurationSource: "family_default",
} as const);

/**
 * Separates the requested master duration from the amount of source media a
 * renderer must create. Most families author the whole timeline; a music loop
 * creates one short, continuity-proven unit and repeats it at assembly time.
 * Keeping every family in this exact record prevents a new format from
 * inheriting the music-loop shortcut accidentally.
 */
export const FAMILY_TIME_SCALING_CONTRACTS: Readonly<Record<FamilyKey, FamilyTimeScalingContract>> = {
  narrated_stock: AUTHORED_TIMELINE,
  music_loop: Object.freeze({
    method: "stream_loop",
    finalDurationSource: "episode_contract",
    sourceSegmentCount: 2,
    sourceSegmentSeconds: 15,
    sourceUnitSeconds: 30,
    loopMode: "flf2v",
    seamMaximumDiff: 0.12,
    assembly: "ffmpeg_stream_loop",
  }),
  sleep: AUTHORED_TIMELINE,
  comic: AUTHORED_TIMELINE,
  shorts: AUTHORED_TIMELINE,
  documentary_collage_short: AUTHORED_TIMELINE,
  whiteboard: AUTHORED_TIMELINE,
  loreshort: AUTHORED_TIMELINE,
  quizyear: FIXED_CADENCE,
  illustrated_explainer: AUTHORED_TIMELINE,
  children_learning: AUTHORED_TIMELINE,
  cinematic: AUTHORED_TIMELINE,
};

export function familyTimeScalingContract(family: FamilyKey): FamilyTimeScalingContract {
  return FAMILY_TIME_SCALING_CONTRACTS[family];
}

function formatDurationSeconds(seconds: number, unit: Exclude<FamilyDurationInputUnit, "fixed">): string {
  if (unit === "hours") {
    const hours = seconds / 3_600;
    return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
  }
  if (unit === "minutes") {
    const minutes = seconds / 60;
    return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
  }
  return `${seconds} sec`;
}

export function formatFamilyDurationContract(family: FamilyKey): string {
  const contract = familyDurationContract(family);
  if (contract.inputUnit === "fixed") return `${contract.defaultSeconds} sec fixed`;
  const minimum = formatDurationSeconds(contract.minimumSeconds, contract.inputUnit);
  const maximum = formatDurationSeconds(contract.maximumSeconds, contract.inputUnit);
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}

/** Return a user-facing error instead of silently clamping a requested duration. */
export function familyEpisodeLengthError(family: FamilyKey, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const minutes = typeof value === "number" ? value : Number(value);
  const contract = familyDurationContract(family);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return `${FAMILIES[family].label} needs a positive episode duration (${formatFamilyDurationContract(family)}).`;
  }
  const seconds = Math.round(minutes * 60);
  if (seconds < contract.minimumSeconds || seconds > contract.maximumSeconds) {
    return `${FAMILIES[family].label} supports ${formatFamilyDurationContract(family)} per episode; received ${seconds} sec.`;
  }
  return undefined;
}

/**
 * Resolve a valid duration in seconds. An omitted value explicitly means the
 * family's authored default, never an arbitrary generic wizard length.
 */
export function resolveFamilyEpisodeLengthSeconds(family: FamilyKey, value: unknown): number {
  const error = familyEpisodeLengthError(family, value);
  if (error) throw new Error(error);
  if (value === undefined || value === null || value === "") {
    return familyDurationContract(family).defaultSeconds;
  }
  return Math.round(Number(value) * 60);
}

/** UI-only normalization. Server and Trigger callers use the fail-closed helper above. */
export function clampFamilyEpisodeLengthMinutes(family: FamilyKey, value: unknown): number {
  const contract = familyDurationContract(family);
  const minutes = typeof value === "number" ? value : Number(value);
  const requestedSeconds = Number.isFinite(minutes) ? Math.round(minutes * 60) : contract.defaultSeconds;
  const boundedSeconds = Math.min(contract.maximumSeconds, Math.max(contract.minimumSeconds, requestedSeconds));
  const snappedSeconds = contract.inputUnit === "fixed"
    ? contract.defaultSeconds
    : Math.round((boundedSeconds - contract.minimumSeconds) / contract.stepSeconds) * contract.stepSeconds + contract.minimumSeconds;
  return Math.min(contract.maximumSeconds, Math.max(contract.minimumSeconds, snappedSeconds)) / 60;
}

/**
 * Template availability is intentionally separate from production readiness.
 * The cinematic graph is built and audited, but LTX-2.5's exact 640×352 →
 * 1280×704 FP8/CPU-offloaded x2 profile is not admitted on the locked 24 GB
 * RTX 4090 fleet until its digest-pinned worker and benchmark proof exist.
 * Keeping this explicit prevents paid retries/OOMs.
 */
export interface FamilyProductionReadiness {
  productionReady: boolean;
  blockers: readonly string[];
  remediation?: string;
}

/**
 * Family-level readiness is deliberately derived from the exact executable
 * video block rather than duplicated as a stale boolean. Pipeline execution
 * repeats the same check with actual parameters, protecting custom and legacy
 * graphs too.
 */
/**
 * Pinned video-producing blocks by family. Read-only consumers such as the
 * creator preflight may assess this declarative contract, but the authorized
 * design task remains the only authority that compiles an executable run.
 *
 * The "production" literal below is DELIBERATELY static and is NOT part of the
 * per-channel render-tier selection (DesignOptions.generationProfile). This
 * constant never reaches a compiled pipeline: its only two consumers are
 * familyProductionReadiness() and selectFormat(), which both feed it to
 * assessPipelineVideoRuntimeReadiness() as a preflight probe. That probe reads
 * the profile's `video` block only, and draft/production/hero currently share
 * byte-identical video settings, so the readiness verdict is tier-invariant.
 * Making this dynamic would add a per-channel plumbing path that provably
 * cannot change any outcome.
 */
export const FAMILY_RUNTIME_PIPELINE: Readonly<Record<FamilyKey, readonly PipelineRuntimeBlockInput[]>> = {
  narrated_stock: [],
  music_loop: ["loop_clips"],
  sleep: [],
  comic: [],
  shorts: [],
  documentary_collage_short: [],
  whiteboard: [],
  loreshort: ["lore_short"],
  quizyear: [],
  illustrated_explainer: [],
  children_learning: [],
  cinematic: [{ block: "novita_render_video", params: { generationProfile: "production" } }],
};

/**
 * A production family can be admitted only when its autonomous planning route
 * is explicit, provenance-bearing and wired into the compiled pipeline. This
 * is intentionally a family-level registry rather than a key-presence check:
 * a configured Gemini secret must never make a Gemini-only creator route look
 * like a repeatable no-Gemini system.
 *
 * `plannedTopic` / `reuseTopic` are resume handoffs, not autonomous planning.
 * They cannot satisfy this contract by themselves. New deterministic planners
 * (children, casefile, etc.) add one registered entry and inherit the same
 * admission and designer assertions as the quiz route below.
 */
export type AutonomousPlanningCapability =
  | {
      mode: "registered_non_gemini";
      id: string;
      plannerBlock: string;
      provenance: string;
      requiredEntries: readonly Readonly<{
        block: string;
        params?: Readonly<Record<string, unknown>>;
      }>[];
      forbiddenGeminiBlocks: readonly string[];
    }
  | {
      mode: "unregistered";
      /**
       * Concrete prerequisites still missing from an automatic planner. This
       * intentionally describes the architecture gap rather than guessing a
       * provider from a legacy implementation.
       */
      missingPlanningRequirements: readonly string[];
    };

function registeredNarratedPlanningCapability(
  family: NarratedFoundationFamily,
): Extract<AutonomousPlanningCapability, { mode: "registered_non_gemini" }> {
  const foundation = narratedPlanningFoundation(family);
  if (!foundation) throw new Error(`missing narrated planning foundation for ${family}`);
  return {
    mode: "registered_non_gemini",
    id: foundation.plannerId,
    plannerBlock: foundation.plannerBlock,
    provenance: foundation.provenance,
    requiredEntries: foundation.requiredEntries,
    forbiddenGeminiBlocks: foundation.forbiddenGeminiBlocks,
  };
}

/**
 * Self-contained visual engines do not consume a generic script/narration/
 * footage chain. Their one accepted native storyboard is planned, critic
 * checked, route-sealed, then consumed exactly once by their own renderer.
 */
function registeredSelfContainedPlanningCapability(
  family: "whiteboard" | "comic" | "loreshort",
): Extract<AutonomousPlanningCapability, { mode: "registered_non_gemini" }> {
  const renderer = family === "whiteboard"
    ? "whiteboard_scribe"
    : family === "comic"
      ? "motion_comic"
      : "lore_short";
  return {
    mode: "registered_non_gemini",
    id: `self-contained-${family}-storyboard-foundation/v1`,
    plannerBlock: "self_contained_story_plan",
    provenance:
      "route-owned non-Google native storyboard producer with a bounded critic loop; the accepted plan is sealed to its route, lane, and topic before the self-contained renderer can read it",
    requiredEntries: [
      { block: "topic_select" },
      { block: "critic_spec" },
      { block: "compliance_check" },
      { block: "self_contained_story_plan" },
      { block: "self_contained_story" },
      { block: renderer },
      { block: "originality_gate" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
    ],
    forbiddenGeminiBlocks: [],
  };
}

/**
 * Unlike a narrated episode, a music loop has no script to prove its intent.
 * The sealed original-music program is therefore the route-owned episode
 * authority consumed by both its visual loop and its paid audio generation.
 */
function registeredOriginalMusicProgramCapability(): Extract<AutonomousPlanningCapability, { mode: "registered_non_gemini" }> {
  return {
    mode: "registered_non_gemini",
    id: "music-loop-original-program-foundation/v1",
    plannerBlock: "music_program_plan",
    provenance:
      "route-owned deterministic original-music program binding the selected non-Google topic, channel sound, visual-loop setting, and instrumental-only constraints before either Novita or the music provider is called",
    requiredEntries: [
      { block: "topic_select" },
      { block: "music_program_plan" },
      { block: "scene_planner" },
      { block: "music" },
      { block: "keyframes" },
      { block: "loop_clips" },
      { block: "assemble" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
    ],
    forbiddenGeminiBlocks: [],
  };
}

/**
 * Cinematic is a distinct visual-control foundation, not a renamed narrated
 * essay. It seals the causal Story Spine, reusable studio assets, Visual
 * Matter controls, exact Novita image/video chain, and final-master QA before
 * release. The separate runtime admission still keeps it blocked until the
 * exact LTX profile has an immutable reviewed RTX 4090 benchmark.
 */
function registeredCinematicPlanningCapability(): Extract<AutonomousPlanningCapability, { mode: "registered_non_gemini" }> {
  return {
    mode: "registered_non_gemini",
    id: "cinematic-story-spine-visual-control-foundation/v1",
    plannerBlock: "story_spine",
    provenance:
      "non-Google Topiccraft and Claude crew/script planning, local Story Spine causality, sealed Studio Asset and Visual Matter controls, direct Novita keyframe-to-video rendering, and independent final-master visual review; Gemini remains limited to the separately receipt-bound thumbnail block",
    requiredEntries: [
      { block: "competitor_research" },
      { block: "topic_select" },
      { block: "director_brief" },
      { block: "dp_brief" },
      { block: "editor_brief" },
      { block: "composer_brief" },
      { block: "critic_spec" },
      { block: "script_gen" },
      { block: "qa_script" },
      { block: "hook_craft" },
      { block: "originality_gate" },
      { block: "compliance_check" },
      { block: "narration_tts" },
      { block: "story_spine" },
      { block: "studio_asset_resolve" },
      { block: "visual_matter" },
      { block: "novita_render_images", params: { generationProfile: "production" } },
      { block: "qa_assets" },
      { block: "studio_ltx_adapter_resolve" },
      { block: "novita_render_video", params: { generationProfile: "production" } },
      { block: "qa_shots" },
      { block: "studio_postproduction_asset_resolve" },
      { block: "music" },
      { block: "timeline_assemble" },
      { block: "length_check" },
      { block: "captions" },
      { block: "metadata" },
      { block: "package_to_opening_plan" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
    ],
    forbiddenGeminiBlocks: [
      "motion_comic",
      "documotion_short",
      "whiteboard_scribe",
      "lore_short",
    ],
  };
}

export const FAMILY_AUTONOMOUS_PLANNING: Readonly<
  Record<FamilyKey, AutonomousPlanningCapability>
> = {
  narrated_stock: registeredNarratedPlanningCapability("narrated_stock"),
  music_loop: registeredOriginalMusicProgramCapability(),
  sleep: registeredNarratedPlanningCapability("sleep"),
  comic: registeredSelfContainedPlanningCapability("comic"),
  shorts: registeredNarratedPlanningCapability("shorts"),
  documentary_collage_short: {
    mode: "unregistered",
    missingPlanningRequirements: [
      "a source-first route-owned episode plan",
      "a matching channel-inception and composition binding",
    ],
  },
  whiteboard: registeredSelfContainedPlanningCapability("whiteboard"),
  loreshort: registeredSelfContainedPlanningCapability("loreshort"),
  quizyear: {
    mode: "registered_non_gemini",
    id: "quiz-curated-wikidata-planner/v1",
    plannerBlock: "quiz_topic_plan",
    provenance:
      "curated safe QuizYear topic registry + Convex topic-memory rotation; each factual answer is independently sourced from CC0 Wikidata",
    requiredEntries: [
      { block: "quiz_topic_plan" },
      { block: "quiz_topic_safety" },
      { block: "music" },
      { block: "quiz_year", params: { noGemini: true } },
      { block: "quiz_critic_spec" },
      { block: "quiz_metadata" },
      { block: "thumbnail_gen" },
    ],
    forbiddenGeminiBlocks: [
      "competitor_research",
      "topic_select",
      "metadata",
      "director_brief",
      "dp_brief",
      "editor_brief",
      "composer_brief",
      "critic_spec",
    ],
  },
  illustrated_explainer: {
    mode: "registered_non_gemini",
    id: "illustrated-explainer-claude-local-scenario/v1",
    plannerBlock: "topic_select",
    provenance:
      "metadata-only topic research, Claude crew/script planning, Fish Audio narration, Mureka music, local Episode Graph + Remotion/FFmpeg scene rendering, a sealed Nano Banana thumbnail, and non-Google visual review; fictional scenario profiles add a mandatory disclosure gate rather than a real-simulation claim",
    requiredEntries: [
      { block: "competitor_research" },
      { block: "topic_select" },
      { block: "director_brief" },
      { block: "dp_brief" },
      { block: "editor_brief" },
      { block: "composer_brief" },
      { block: "critic_spec" },
      { block: "script_gen" },
      { block: "qa_script" },
      { block: "narration_tts" },
      { block: "story_spine" },
      { block: "episode_graph" },
      { block: "music" },
      { block: "scene_compiler" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
    ],
    forbiddenGeminiBlocks: [
      "motion_comic",
      "documotion_short",
      "whiteboard_scribe",
      "lore_short",
    ],
  },
  children_learning: {
    mode: "unregistered",
    missingPlanningRequirements: [
      "a child-editor-approved program route for automatic planning",
    ],
  },
  cinematic: registeredCinematicPlanningCapability(),
};

export function familyAutonomousPlanningCapability(family: FamilyKey): AutonomousPlanningCapability {
  return FAMILY_AUTONOMOUS_PLANNING[family];
}

/**
 * Designer-time integrity check for the central planner admission contract.
 * This verifies the actual compiled entries, rather than trusting a catalog
 * label or a feature flag that could drift away from the executable pipeline.
 */
export function assertFamilyAutonomousPlanningPipeline(
  family: FamilyKey,
  pipeline: readonly Readonly<{ block: string; params?: Record<string, unknown> }>[],
  options: Readonly<{ allowPreviewGenerationProfile?: boolean }> = {},
): void {
  const capability = familyAutonomousPlanningCapability(family);
  if (capability.mode !== "registered_non_gemini") return;

  for (const required of capability.requiredEntries) {
    const entry = pipeline.find((candidate) => candidate.block === required.block);
    if (!entry) {
      throw new Error(
        `${FAMILIES[family].label}: autonomous planner ${capability.id} is missing required module ${required.block}`,
      );
    }
    for (const [key, value] of Object.entries(required.params ?? {})) {
      const actual = entry.params?.[key];
      // The cinematic contract requires a production-quality image profile.
      // Hero is stronger than production, while draft is only valid for the
      // designer's explicitly non-runnable preview output. All execution,
      // inception, and persisted-pipeline callers use the default strict mode.
      const satisfied = key === "generationProfile" && value === "production"
        ? isProductionQualityGenerationProfile(actual) ||
          (options.allowPreviewGenerationProfile === true && actual === "draft")
        : actual === value;
      if (!satisfied) {
        throw new Error(
          `${FAMILIES[family].label}: autonomous planner ${capability.id} requires ${required.block}.${key}=${JSON.stringify(value)}`,
        );
      }
    }
  }
  const blocks = new Set(pipeline.map((entry) => entry.block));
  const leaked = capability.forbiddenGeminiBlocks.filter((block) => blocks.has(block));
  if (leaked.length) {
    throw new Error(
      `${FAMILIES[family].label}: autonomous planner ${capability.id} leaked Gemini-backed module(s): ${leaked.join(", ")}`,
    );
  }
  assertNarratedFoundationFormatContract(family, pipeline);
}

export function autonomousPlanningBlocker(family: FamilyKey): string | undefined {
  const capability = familyAutonomousPlanningCapability(family);
  if (capability.mode === "registered_non_gemini") return undefined;
  const label = FAMILIES[family].label;
  return (
    `${label}: automatic planning is not registered; still missing ` +
    `${capability.missingPlanningRequirements.join(" and ")}.`
  );
}

/**
 * A registered non-Gemini episode planner is only half of autonomous channel
 * creation.  This gate keeps the creator/UI from entering shared inception
 * stages that have not yet been given their own non-Gemini implementation.
 */
function noGeminiChannelInceptionBlocker(template: Family): {
  blocker?: string;
  remediation?: string;
} {
  if (familyAutonomousPlanningCapability(template.key).mode !== "registered_non_gemini") {
    return {};
  }
  const capability = familyChannelInceptionCapability(template.key);
  if (capability.mode === "registered_non_gemini") return {};
  return {
    blocker:
      `${template.label}: no-Gemini channel inception is not registered; ` +
      capability.blockers.join("; ") + ".",
    remediation: capability.remediation,
  };
}

/**
 * Resolve production readiness against an optional owner-attested video runtime.
 * Callers that do not have a reviewed runtime record retain the locked static
 * target, so no browser or untrusted payload can promote an LTX family.
 */
export function familyProductionReadiness(
  family: FamilyKey,
  runtimeTarget?: NovitaVideoRuntimeTarget,
): FamilyProductionReadiness {
  const template = FAMILIES[family];
  const blockers: string[] = [];
  if (!template.available) {
    blockers.push(
      `${template.label}: the ${template.visualEngine} production template is not implemented`,
    );
  }
  const planningBlocker = autonomousPlanningBlocker(template.key);
  if (planningBlocker) blockers.push(planningBlocker);
  const inception = noGeminiChannelInceptionBlocker(template);
  if (inception.blocker) blockers.push(inception.blocker);
  const runtime = assessPipelineVideoRuntimeReadiness(FAMILY_RUNTIME_PIPELINE[family], runtimeTarget);
  if (!runtime.ready) {
    blockers.push(...runtime.blockers.map((blocker) => `${template.label}: ${blocker}`));
  }
  if (!blockers.length) return { productionReady: true, blockers: [] };
  return {
    productionReady: false,
    blockers,
    remediation: [
      ...(planningBlocker
        ? ["Register a route-owned deterministic or non-Gemini planner/seal and its matching composition before admitting this family."]
        : []),
      ...(inception.remediation ? [inception.remediation] : []),
      ...(!runtime.ready ? [NOVITA_VIDEO_RUNTIME_REMEDIATION] : []),
    ].join(" "),
  };
}

export function isFamilyProductionReady(family: FamilyKey): boolean {
  return familyProductionReadiness(family).productionReady;
}

/** The closest actually-admitted fallback; undefined means none exists. */
export function productionReadyFamilyFallback(family: FamilyKey): FamilyKey | undefined {
  // Production admission is not a licence to replace the creator's requested
  // format with an unrelated one. Until a deliberately compatible fallback is
  // registered with its own quality/capability mapping, blocked families stay
  // visibly blocked; QuizYear is selectable only when QuizYear was requested.
  return isFamilyProductionReady(family) ? family : undefined;
}

export const FAMILY_KEYS = Object.keys(FAMILIES) as FamilyKey[];
export function getFamily(key: string): Family | undefined {
  return (FAMILIES as Record<string, Family>)[key];
}

/**
 * Which film-crew roles each family needs by default. The designer inserts the
 * matching crew brief blocks; the Show Bible's `activeCrew` may later prune this
 * set (informational — an extra brief is harmless). Pure data (no agent deps).
 */
export const FAMILY_CREW: Record<FamilyKey, string[]> = {
  music_loop: ["cinematographer", "composer", "critic"],
  sleep: ["cinematographer", "composer", "critic"],
  narrated_stock: ["director", "cinematographer", "editor", "composer", "critic"],
  shorts: ["director", "editor", "critic"],
  documentary_collage_short: ["director", "cinematographer", "editor", "critic"],
  whiteboard: ["director", "editor", "composer", "critic"],
  // NO composer: the comic engine scores itself (its own Suno bed) — a
  // composer_brief here was re-inserted by the crew pass after the designer
  // deliberately stripped it, wasting an LLM call every run for output the
  // engine never reads.
  comic: ["director", "editor", "critic"],
  cinematic: ["director", "cinematographer", "editor", "composer", "critic"],
  // NO composer: the lore engine muxes narration only and beds no score, so a
  // composer_brief would cost an LLM call per run for output nothing reads.
  loreshort: ["director", "cinematographer", "editor", "critic"],
  // Quiz has a dedicated deterministic planning + safety + critic receipt
  // module. Adding LLM crew briefs here would silently break its certified
  // no-Gemini route without improving factual correctness or rendered timing.
  quizyear: [],
  illustrated_explainer: ["director", "cinematographer", "editor", "composer", "critic"],
  // The child lane uses the same craft roles, but its separate child-content
  // gate keeps the output review-only even when all production QA passes.
  children_learning: ["director", "cinematographer", "editor", "composer", "critic"],
};

/** Crew role → the brief block id that role contributes. */
export const CREW_ROLE_BLOCK: Record<string, string> = {
  director: "director_brief",
  cinematographer: "dp_brief",
  editor: "editor_brief",
  composer: "composer_brief",
  critic: "critic_spec",
};
