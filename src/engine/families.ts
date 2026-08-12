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
  | "quizyear";

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
  /** Production channel creation always uses the Style-DNA/playbook engine.
   * Plain title cards remain a draft-only renderer, never a family default. */
  defaultThumbnailStyle: "banana";
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
    requiresKeys: ["fal", "suno", "replicate"],
    // Any non-title_card engine unlocks the real-scene thumbnail path (the
    // run's own keyframe + styled title) — title_card is a plain drawtext card.
    defaultThumbnailStyle: "banana",
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
  },
  comic: {
    key: "comic",
    label: "Motion comic (3D drawn page)",
    description:
      "A narrated comic page that DRAWS ITSELF OUT in 3D: character-consistent panels, multi-voice " +
      "dialogue bubbles, hand-drawn reveal, page turns. History, stories, true events. ZERO render credits.",
    visualEngine: "motion_comic",
    archetypeKey: "narrated-essay",
    available: true,
    narrated: true,
    requiresKeys: ["gemini", "elevenlabs"],
    defaultThumbnailStyle: "banana",
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
    requiresKeys: ["gemini", "fal", "fish-audio"],
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
      "Narration-synced hand-drawn whiteboard explainer (history, finance, explainers). DRAWN-CINEMA engine: Gemini storyboards layered scenes, Fish narrates, Whisper aligns, and a deterministic hand draws each beat in time with the voice — zero render credits. 1080p / 2K.",
    visualEngine: "whiteboard_scribe",
    archetypeKey: "narrated-essay",
    available: true,
    narrated: true,
    requiresKeys: ["fish-audio", "gemini"],
    defaultThumbnailStyle: "banana",
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
    requiresKeys: ["gemini", "novita", "fish-audio"],
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
      "currencies, chemical symbols and citation-verified general knowledge — with four options, a depleting " +
      "timer and a lock-in reveal. Self-contained: sources its own facts, writes its own questions and renders itself.",
    visualEngine: "quiz_year",
    archetypeKey: "quiz-year",
    available: true,
    // No spoken narration: the format is on-screen typography plus a timer.
    narrated: false,
    // Gemini is OPTIONAL (it only phrases questions more engagingly, and the
    // block falls back to deterministic templates), but the family declares it
    // because a channel that never has it would ship template wording forever.
    requiresKeys: ["gemini"],
    defaultThumbnailStyle: "banana",
    // Facts are free (Wikidata CC0) and the render is local Remotion. The only
    // spend on the whole path is a handful of bounded text calls, so this is
    // the cheapest family in the catalog by a wide margin.
    defaultRunBudgetUsd: 1,
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
  },
};

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
  // NO cinematographer and NO composer: there is no photography and no score in
  // this format — it is typography, a timer and a reveal. The critic is what
  // actually matters here, since question WORDING is the only creative surface.
  quizyear: ["director", "editor", "critic"],
};

/** Crew role → the brief block id that role contributes. */
export const CREW_ROLE_BLOCK: Record<string, string> = {
  director: "director_brief",
  cinematographer: "dp_brief",
  editor: "editor_brief",
  composer: "composer_brief",
  critic: "critic_spec",
};
