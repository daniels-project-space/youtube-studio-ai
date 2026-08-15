import {
  assessPipelineVideoRuntimeReadiness,
  NOVITA_VIDEO_RUNTIME_REMEDIATION,
  type PipelineRuntimeBlockInput,
} from "./runtimeCapability";
import { familyChannelInceptionCapability } from "./channelInceptionCapability";

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
  /**
   * The channel-level thumbnail provenance. Most families use the Style-DNA
   * image engine; the deterministic QuizYear renderer owns its local stills.
   * A plain title card is never a default for a provider-backed family.
   */
  defaultThumbnailStyle: "banana" | "title_card";
  /** Default per-video spend envelope when the operator did not set one. */
  defaultRunBudgetUsd?: number;
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
    requiresKeys: ["fish-audio", "pexels", "mureka", "fal"],
    defaultThumbnailStyle: "banana",
    // Current standard-episode compiler reservation: $0.64. This rounded
    // floor keeps creator advice and server admission above the real pipeline.
    defaultRunBudgetUsd: 1,
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
    requiresKeys: ["fal", "suno", "replicate", "novita"],
    // Any non-title_card engine unlocks the real-scene thumbnail path (the
    // run's own keyframe + styled title) — title_card is a plain drawtext card.
    defaultThumbnailStyle: "banana",
    // Standard production loop + aesthetic-audio review reserves $1.47.
    defaultRunBudgetUsd: 2,
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
    defaultRunBudgetUsd: 1,
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
    // The standard eight-panel comic now reserves $6.36 once every direct
    // Novita panel worker is costed at its real teardown-verified ceiling.
    defaultRunBudgetUsd: 7,
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
    defaultRunBudgetUsd: 1,
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
    // The authored five-minute board reserves $24.99 once every direct
    // Novita drawing layer is admitted; this is intentionally below the $31
    // absolute sixteen-panel module ceiling but above the real default run.
    defaultRunBudgetUsd: 25,
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
    // The QuizYear Remotion composition emits its own deterministic still;
    // routing this family through the generic Banana thumbnailer would make
    // the creator advertise a provider it never needs and break the visual
    // language between the video and its thumbnail.
    defaultThumbnailStyle: "title_card",
    // Facts, planning, metadata, thumbnail and pixels are local/CC0. Reserve
    // an original music bed and the mandatory production QA rather than
    // pretending a silent game-show master is release-ready.
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
export type FamilyDurationInputUnit = "minutes" | "seconds" | "fixed";

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
    minimumSeconds: 180,
    maximumSeconds: 3_600,
    defaultSeconds: 180,
    stepSeconds: 60,
    inputUnit: "minutes",
    rationale: "A seamless moving loop needs at least one complete listening session; longer mixes add bounded track coverage.",
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

function formatDurationSeconds(seconds: number, unit: Exclude<FamilyDurationInputUnit, "fixed">): string {
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
      geminiBackedBlocks: readonly string[];
    };

export const FAMILY_AUTONOMOUS_PLANNING: Readonly<
  Record<FamilyKey, AutonomousPlanningCapability>
> = {
  narrated_stock: {
    mode: "registered_non_gemini",
    id: "narrated-stock-claude-story-spine/v1",
    plannerBlock: "topic_select",
    provenance:
      "non-Google topic research, Claude crew/script planning, local narration evidence, Story Spine assembly, and independent non-Google visual review; Gemini is sealed to thumbnail_gen only",
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
      { block: "timeline_assemble" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
    ],
    forbiddenGeminiBlocks: ["motion_comic", "documotion_short", "whiteboard_scribe", "lore_short"],
  },
  music_loop: { mode: "unregistered", geminiBackedBlocks: ["topic_select"] },
  sleep: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "script_gen"] },
  comic: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "motion_comic"] },
  shorts: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "script_gen"] },
  documentary_collage_short: {
    mode: "unregistered",
    geminiBackedBlocks: ["topic_select", "script_gen", "documotion_short"],
  },
  whiteboard: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "whiteboard_scribe"] },
  loreshort: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "lore_short"] },
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
      { block: "quiz_thumbnail" },
    ],
    forbiddenGeminiBlocks: [
      "competitor_research",
      "topic_select",
      "metadata",
      "thumbnail_gen",
      "director_brief",
      "dp_brief",
      "editor_brief",
      "composer_brief",
      "critic_spec",
    ],
  },
  illustrated_explainer: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "script_gen"] },
  children_learning: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "script_gen"] },
  cinematic: { mode: "unregistered", geminiBackedBlocks: ["topic_select", "script_gen"] },
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
      if (entry.params?.[key] !== value) {
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
}

function noGeminiPlanningBlocker(template: Family): string | undefined {
  const capability = familyAutonomousPlanningCapability(template.key);
  if (capability.mode === "registered_non_gemini") return undefined;
  return (
    `${template.label}: no-Gemini automatic planning is not registered; ` +
    `the creator pipeline still requires Gemini-backed ${capability.geminiBackedBlocks.join(", ")}.`
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

export function familyProductionReadiness(family: FamilyKey): FamilyProductionReadiness {
  const template = FAMILIES[family];
  const blockers: string[] = [];
  if (!template.available) {
    blockers.push(
      `${template.label}: the ${template.visualEngine} production template is not implemented`,
    );
  }
  const planningBlocker = noGeminiPlanningBlocker(template);
  if (planningBlocker) blockers.push(planningBlocker);
  const inception = noGeminiChannelInceptionBlocker(template);
  if (inception.blocker) blockers.push(inception.blocker);
  const runtime = assessPipelineVideoRuntimeReadiness(FAMILY_RUNTIME_PIPELINE[family]);
  if (!runtime.ready) {
    blockers.push(...runtime.blockers.map((blocker) => `${template.label}: ${blocker}`));
  }
  if (!blockers.length) return { productionReady: true, blockers: [] };
  return {
    productionReady: false,
    blockers,
    remediation: [
      ...(planningBlocker
        ? ["Register a deterministic or non-Gemini topic/story planner before admitting this family."]
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
