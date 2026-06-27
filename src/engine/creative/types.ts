/**
 * Creative-direction layer types — the "film crew" contracts.
 *
 * Two artifacts:
 *   - ShowBible: written ONCE at channel creation (the Showrunner). The channel's
 *     durable essence/vibe + the doctrines each crew role works from. Persisted on
 *     `channels.identity.creativeBrief`.
 *   - VideoBrief: derived PER VIDEO from the Bible by the crew brief blocks. Lives
 *     in the run store (ctx.store.videoBrief); mechanical blocks execute it.
 *
 * Everything is optional/degradable: a channel with no Bible runs exactly as before.
 */

/** Stable crew roles. Function is fixed; the goal (brief) is channel-custom. */
export const CREW_ROLES = [
  "showrunner", // owns the Bible + role selection (creation-time)
  "director", // narrative structure, hook, pacing, emotional arc
  "cinematographer", // the look: footage/keyframe criteria, color, motion
  "editor", // cuts & rhythm, transitions, caption/overlay placement
  "composer", // music doctrine + audio (ducking, voice-fx)
  "critic", // the validation spec (what THIS video must satisfy)
] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

/** Per-video crew roles (everything except the creation-time showrunner). */
export const VIDEO_CREW_ROLES = [
  "director",
  "cinematographer",
  "editor",
  "composer",
  "critic",
] as const;
export type VideoCrewRole = (typeof VIDEO_CREW_ROLES)[number];

/* ----------------------------- Show Bible ------------------------------ */

export interface ShowBible {
  /** One-paragraph "what this channel IS" (positioning). */
  positioning: string;
  /** The emotional/tonal signature in a sentence or two. */
  vibe: string;
  /** The recurring visual signature — avatar + thumbnails + intro card share it. */
  iconicMotif: string;
  /** Proven patterns in this space to lean into. */
  worksInSpace: string[];
  /** Anti-patterns to NEVER do (the "what doesn't work"). */
  avoidInSpace: string[];
  /** Which crew roles are active for this channel (drives the designed pipeline). */
  activeCrew: VideoCrewRole[];
  /** Default stance for each role (the per-channel "goal" each agent works from). */
  directorDoctrine?: string;
  dpDoctrine?: string;
  editorDoctrine?: string;
  composerDoctrine?: string;
  criticDoctrine?: string;
  refreshedAt: number;
}

/* ------------------------------ Style DNA ------------------------------ */
/**
 * The FROZEN, machine-readable definition of "good" for ONE channel — distilled
 * ONCE at Inception from auto-discovered research (top competitors + Gemini
 * thumbnail vision + the SEO databank). Every downstream block generates AGAINST
 * this and the critic scores conformance TO it (drift = divergence from the DNA).
 *
 * It is NOT a fallback: `confidence` + `groundingGaps` record how well-grounded
 * the distillation was, so the Pipeline Doctor knows exactly what to heal before
 * the channel is "established" (rather than silently shipping generic output).
 * Stored on `channels.styleDNA`.
 */
export interface StyleDNA {
  /** Provenance of the distillation. */
  source: "research+vision" | "research" | "ungrounded";
  /** 0..1 grounding confidence — gates whether the channel is "established". */
  confidence: number;
  /** What the Doctor must heal (e.g. "no thumbnail vision", "thin competitor set"). */
  groundingGaps: string[];

  /* --- Visual identity (the "Lofi Girl" recognizability) --- */
  /** Ordered hex, dominant → accent. */
  palette: string[];
  /** The ONE concrete recurring subject/character that IS the brand. */
  recurringSubject: string;
  /** The recurring world/place every video shares (single-scene channels). */
  setting: string;
  /**
   * Optional ROTATING set of signature scenes (the channel's recognizable
   * worlds, e.g. a meadow vista, a seaside cafe, a night apartment). One is
   * chosen per video, unified by the art style + color grade + recurring
   * character. Each `setting` is a complete, self-contained scene description;
   * `motion` lists only the ambient elements that may move in it.
   */
  signatureScenes?: { name: string; setting: string; motion: string }[];
  /** Focal placement / rule-of-thirds / depth conventions. */
  composition: string;
  /** Color grade + mood of the look. */
  colorGrade: string;
  /** Recurring signature elements (motifs). */
  motifs: string[];
  /** The ONLY axes allowed to vary (e.g. "time-of-day", "season"). */
  variationAxes: string[];

  /* --- Motion / video --- */
  /** What is allowed to move (rain, steam, hair-sway, blink). */
  motionVocabulary: string[];
  /** Camera/motion rules (e.g. "locked tripod; no pans/zooms"). */
  motionDiscipline: string;
  /** Anti-patterns to NEVER render. */
  visualAvoid: string[];

  /* --- Thumbnail (pushed-contrast, click-first) --- */
  thumbnail: {
    /** Subject-on-a-third, ≥30% contrast, mobile-legible. */
    composition: string;
    /** ≤3 words / mood-phrase / none. */
    textRule: string;
    /** Thumbnail palette (contrast pushed past the in-video grade). */
    palette: string[];
    /** The click subject. */
    subject: string;
  };

  /* --- Audio / music --- */
  audio: {
    genre: string;
    /** [min, max] BPM band. */
    bpmRange: [number, number];
    instrumentation: string[];
    /** 1-2 only — restraint is the premium signal. */
    textures: string[];
    moodArc: string;
    /** Integrated-loudness master target (LUFS). */
    loudnessLufs: number;
    loopable: boolean;
  };

  /* --- Narrative / voice (narrated families; optional for music_loop) --- */
  narrative?: {
    scriptStyle: string;
    hookStyle: string;
    pacing: string;
    /** Timbre / age / pace / warmth of the narrator. */
    voiceProfile: string;
    /** Emotional delivery direction (calm sleep vs measured documentary…). */
    delivery: string;
  };

  /* --- SEO --- */
  seo: {
    /** e.g. "[mood] Lofi — Beats to [use-case] (X Hours)". */
    titleFormula: string;
    descriptionStructure: string;
    playlistStrategy: string;
  };

  refreshedAt: number;
}

/* ----------------------------- Quality Bar ----------------------------- */
/**
 * The per-channel bar every block's critic judges against. Coarse 0-1-2 scoring
 * (research-backed: 3 levels stabilize an LLM judge). `target` is the channel's
 * "80%". Deterministic floors (CLIP similarity, LUFS window, loop-seam SSIM) are
 * the un-gameable anchors against reward-hacking. Stored on `channels.qaRubric`.
 */
export interface QualityDimension {
  /** "thumbnail" | "loop_seam" | "music" | "script" | "footage" | "identity" | … */
  id: string;
  /** What "good" means for THIS channel on this dimension. */
  description: string;
  /** Minimum 0..2 to pass. */
  minScore: number;
  /** Optional deterministic floor the loop cannot talk past. */
  metric?: string;
  op?: ValidationOp;
  threshold?: number;
}

export interface QualityBar {
  /** Mean dimension score that counts as "good enough to ship" (the 80%). */
  target: number;
  dimensions: QualityDimension[];
  refreshedAt: number;
}

/* ----------------------------- Video Brief ----------------------------- */

export interface StructureBrief {
  /** A scroll-stopping opening line / cold-open idea. */
  hook: string;
  /** Ordered beats with an intended on-screen duration + creative note. */
  beats: { name: string; intentSec: number; note: string }[];
}

export interface VisualBrief {
  /** Concrete footage search queries (narrated) — replaces the generic pool. */
  footageQueries: string[];
  /** Style clause blended into keyframe/scene prompts (loop/cinematic). */
  promptStyle: string;
  /** Hex palette to bias selection/generation toward. */
  palette: string[];
  /** Motion language (what should move, how). */
  motion: string;
  /** Visual things to avoid for this channel. */
  avoid: string[];
  /** Family-specific extras some visual engines add to the brief (all optional). */
  look?: string;     // gen_footage — establishing look
  setting?: string;  // lofi — scene setting
  world?: string;    // lofi — world description
  header?: string;   // whiteboard — header text
}

export interface CutSheet {
  /** Cut cadence per named section (cuts per minute). */
  sections: { name: string; cutsPerMin: number }[];
  /** Transition language (e.g. "hard cuts on beat; no crossfades except act breaks"). */
  transitions: string;
  /** Caption styling intent (size/placement/emphasis). */
  captionStyle: string;
  /** Where text overlays / quote cards may land + rules. */
  overlayRule: string;
}

export interface AudioBrief {
  /** How far to duck music under narration, in dB (negative). */
  duckDb: number;
  /** Music bed loudness target (LUFS). */
  bedLufs: number;
  /** Optional narration filter, e.g. "radio". */
  voiceFx?: string;
}

export interface VideoBrief {
  structure?: StructureBrief;
  visual?: VisualBrief;
  cutSheet?: CutSheet;
  /** The Composer's music-generation prompt (overrides the archetype default). */
  musicPrompt?: string;
  audio?: AudioBrief;
  validation?: ValidationSpec;
}

/* --------------------------- Validation spec --------------------------- */

export type ValidationCheckKind = "deterministic" | "vision";
export type ValidationOp = "<" | "<=" | ">" | ">=" | "==";
export type ValidationSeverity = "block" | "warn";

export interface ValidationAssertion {
  /** Stable id, e.g. "loop_seam", "caption_coverage", "hook_2s", "no_overlap". */
  id: string;
  description: string;
  /** Computed in code (trustworthy) vs. judged by an agent on sampled frames. */
  check: ValidationCheckKind;
  /** For deterministic checks: the metric name the executor computes. */
  metric?: string;
  op?: ValidationOp;
  threshold?: number;
  /** block → fails the run / triggers refine; warn → logged only. */
  severity: ValidationSeverity;
}

export interface ValidationSpec {
  assertions: ValidationAssertion[];
}

export interface ValidationResult {
  id: string;
  passed: boolean;
  /** "skipped" when the metric couldn't be computed (treated as non-blocking). */
  skipped?: boolean;
  observed?: number | string;
  severity: ValidationSeverity;
  note?: string;
}

export interface ValidationOutcome {
  /** false only when a BLOCK-severity assertion failed (skips never block). */
  passed: boolean;
  results: ValidationResult[];
}
