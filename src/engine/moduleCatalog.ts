/**
 * MODULE CATALOG — a client-safe manifest of every editable pipeline module and
 * the parameters the Advanced editor exposes for it. Pure data (no server/block
 * imports) so the wizard can render param controls without pulling in Trigger
 * code. The designer is the source of truth for DEFAULTS; this only declares
 * which knobs are user-tunable, their type, and safe bounds.
 *
 * The wizard collects values into `paramOverrides[blockId][key]`, which
 * designPipeline() merges on top of the derived params (overrides win). Only
 * keys declared here are accepted — see sanitizeParamOverrides().
 */

export type ParamType = "number" | "toggle" | "select" | "text";

export interface ParamField {
  key: string;
  label: string;
  type: ParamType;
  help?: string;
  /** number bounds */
  min?: number;
  max?: number;
  step?: number;
  /** select options (value + label) */
  options?: { value: string; label: string }[];
}

export interface ModuleSpec {
  block: string;
  label: string;
  description: string;
  /** false = mandatory backbone module; true = can be toggled off in the wizard. */
  optional: boolean;
  params: ParamField[];
}

/** Ordered, de-duplicated set of every module the builder can place + tune. */
export const MODULE_CATALOG: ModuleSpec[] = [
  {
    block: "director_brief",
    label: "Crew · Director",
    description: "Designs each video's structure: hook + beat map + pacing, from the Show Bible.",
    optional: true,
    params: [],
  },
  {
    block: "dp_brief",
    label: "Crew · Cinematographer",
    description: "Directs the look: footage/keyframe criteria, color, and motion.",
    optional: true,
    params: [],
  },
  {
    block: "editor_brief",
    label: "Crew · Editor",
    description: "Sets cut cadence, transitions, caption styling, and overlay placement.",
    optional: true,
    params: [],
  },
  {
    block: "composer_brief",
    label: "Crew · Composer",
    description: "Writes the per-video music prompt + audio brief (ducking, voice FX).",
    optional: true,
    params: [],
  },
  {
    block: "critic_spec",
    label: "Crew · Critic",
    description: "Authors the validation spec this specific video must pass.",
    optional: true,
    params: [],
  },
  {
    block: "visual_matter",
    label: "Visual Matter",
    description: "Creates mood, character, setting, and storyboard locks for a cinematic story; reference-image rendering remains explicitly paid and capped.",
    optional: true,
    params: [
      { key: "enabled", label: "Use Visual Matter", type: "toggle", help: "Keep the typed visual-development handoff active for this cinematic pipeline." },
      { key: "maxCharacters", label: "Character sheets", type: "number", min: 0, max: 6, step: 1 },
      { key: "maxSettings", label: "Setting sheets", type: "number", min: 0, max: 6, step: 1 },
      { key: "renderReferenceAssets", label: "Render fal.ai Nano Banana 2 references", type: "toggle", help: "Explicit paid action; requires FAL_KEY and a configured Nano Banana 2 unit-cost guard." },
      { key: "maxReferenceImages", label: "Reference-image cap", type: "number", min: 1, max: 12, step: 1 },
    ],
  },
  {
    block: "topic_select",
    label: "Topic Select",
    description: "Chooses each video's topic (no-repeat memory, optional ordered series, optional speculative-hypothetical genre seeds).",
    optional: false,
    params: [
      {
        key: "policy", label: "Repeat policy", type: "select",
        options: [
          { value: "prefer_fresh", label: "Prefer fresh (recycle when exhausted)" },
          { value: "no_repeat", label: "Never repeat" },
        ],
        help: "Whether the channel may eventually reuse a topic.",
      },
      { key: "seriesTitle", label: "Series title", type: "text", help: "Set to run an ordered, numbered series (e.g. \"7 Days of Stoic Calm\"). Leave blank for standalone videos." },
      { key: "seriesCount", label: "Series length", type: "number", min: 0, max: 100, step: 1, help: "Episodes in the series. 0 = open-ended. After the last episode the channel resumes normal topics." },
      {
        key: "genre", label: "Speculative genre", type: "select",
        options: [
          { value: "", label: "None (subject-driven topics)" },
          { value: "ai_hypothetical", label: "What would AI do? (hypothetical)" },
          { value: "ai_pov", label: "AI POV (first person)" },
        ],
        help: "Appends genre seed phrasings to this channel's topic pool. Pair with the matching script tone. The no-repeat check still applies to seeded topics.",
      },
    ],
  },
  {
    block: "script_gen",
    label: "Script",
    description: "Researches and writes the narration script.",
    optional: false,
    params: [
      { key: "maxSeconds", label: "Target length (sec)", type: "number", min: 30, max: 3600, step: 30, help: "Spoken length target. Drives the word budget." },
      { key: "endWithSummary", label: "End with summary", type: "toggle", help: "Close with a concise recap section." },
      {
        key: "style", label: "Tone", type: "select",
        options: [
          { value: "essay", label: "Video essay" },
          { value: "crime", label: "True-crime / mystery" },
          { value: "shorts", label: "Punchy short-form" },
          { value: "meditation", label: "Calm / guided" },
          { value: "ranking_countdown", label: "Ranking countdown" },
          // Speculative-hypothetical genres (src/lib/aiPersona.ts). Both carry
          // a hard frame: state the premise as a hypothetical and never
          // fabricate a study, dataset or expert to support it.
          { value: "ai_hypothetical", label: "What would AI do? (hypothetical)" },
          { value: "ai_pov", label: "AI POV (first person)" },
        ],
      },
    ],
  },
  {
    block: "narration_tts",
    label: "Narration",
    description: "Synthesizes the voiceover, pauses, and chapter cards.",
    optional: false,
    params: [
      { key: "sentenceGapSec", label: "Pause between sentences (sec)", type: "number", min: 0, max: 3, step: 0.05, help: "Base silence between sentences (jittered for a human feel)." },
      { key: "ttsSpeed", label: "Speaking rate", type: "number", min: 0.85, max: 1.15, step: 0.01, help: "Voice speed multiplier (0.9 = slower, deliberate)." },
      {
        key: "voiceFx", label: "Voice effect", type: "select",
        options: [
          { value: "none", label: "None (clean)" },
          { value: "radio", label: "Old radio (vintage AM)" },
        ],
        help: "Stylized filter applied to the finished narration.",
      },
      { key: "chapterCards", label: "Spoken chapter cards", type: "toggle", help: "Read each section heading on a fading card." },
    ],
  },
  {
    block: "stock_footage",
    label: "Stock Footage",
    description: "Sources serene b-roll for narrated videos.",
    optional: false,
    params: [
      {
        key: "footageTheme", label: "Footage theme", type: "select",
        options: [
          { value: "nature", label: "Nature / landscape / water" },
          { value: "ruins", label: "Ancient ruins / statues" },
          { value: "city", label: "City / urban" },
          { value: "abstract", label: "Abstract / textures" },
        ],
      },
    ],
  },
  {
    block: "music",
    label: "Music",
    description: "Generates the background score.",
    optional: false,
    params: [
      {
        key: "provider", label: "Provider", type: "select",
        options: [
          { value: "mureka", label: "Mureka" },
          { value: "suno", label: "Suno" },
        ],
      },
      { key: "prompt", label: "Music style prompt", type: "text", help: "Describe the mood (e.g. \"calm ambient, soft pads, no drums\")." },
      { key: "trackCount", label: "Distinct tracks", type: "number", min: 1, max: 8, step: 1, help: "Clips crossfaded into the mix (variety vs cost)." },
    ],
  },
  {
    block: "intro_card",
    label: "Intro Card",
    description: "Remotion title card at the start.",
    optional: false,
    params: [
      { key: "introSec", label: "Intro length (sec)", type: "number", min: 2, max: 10, step: 1 },
    ],
  },
  {
    block: "visual_inserts",
    label: "Data Inserts",
    description: "Script-synced motion graphics (animated stats, charts, comparisons) rendered when the narration speaks numbers.",
    optional: true,
    params: [
      { key: "maxInserts", label: "Max inserts", type: "number", min: 1, max: 8, step: 1 },
      { key: "minGapSec", label: "Min spacing (sec)", type: "number", min: 10, max: 60, step: 5 },
    ],
  },
  {
    block: "quote_overlays",
    label: "Quote Overlays",
    description: "Renders attributed philosopher quotes over the footage.",
    optional: true,
    params: [
      { key: "maxQuotes", label: "Max quotes", type: "number", min: 0, max: 8, step: 1 },
      { key: "minQuoteWords", label: "Min words per quote", type: "number", min: 3, max: 20, step: 1 },
    ],
  },
  {
    block: "whiteboard_scribe",
    label: "Whiteboard scribe (drawn cinema)",
    description:
      "Self-contained narration-synced whiteboard explainer: Gemini storyboards layered scenes, Fish narrates, a deterministic hand draws each beat in time. Replaces footage + assembly for the Whiteboard family.",
    optional: false,
    params: [
      { key: "width", label: "Resolution", type: "select", options: [{ value: "1920", label: "1080p" }, { value: "2560", label: "2K (1440p)" }] },
      { key: "styleId", label: "Whiteboard style", type: "select", options: [{ value: "history", label: "History" }, { value: "finance", label: "Finance" }] },
    ],
  },
  {
    block: "lore_short",
    label: "Lore micro-doc (depth camera)",
    description:
      "Self-contained first-person 'Histories & Lore' micro-documentary: Gemini writes the beat sheet, the attested Novita farm paints each beat and animates a real 3D depth camera move over it, and the cut follows the narration. Replaces script + footage + assembly for the Lore family.",
    optional: false,
    params: [
      { key: "subStyle", label: "Art look", type: "select", options: [{ value: "cinematic", label: "Cinematic concept art" }, { value: "watercolor_pencil", label: "Watercolour + pencil" }] },
      { key: "narrator", label: "Narrator identity", type: "text", help: "WHO speaks, in first person — identity plus tone. Defaults to the channel persona." },
    ],
  },
  {
    block: "story_spine",
    label: "Story spine (timed shots)",
    description:
      "Turns timed narration into beats, a shot list and per-shot DP specs. The camera GRAMMAR is a composition profile (src/lib/shotComposition.ts): third-person cinematic coverage by default, or handheld first-person selfie framing for character-vlog channels. Same renderer either way — only the prompt and the move vocabulary change.",
    optional: false,
    params: [
      { key: "targetShotSec", label: "Seconds per shot", type: "number", min: 2, max: 30, step: 1 },
      {
        key: "shotComposition",
        label: "Camera grammar",
        type: "select",
        options: [
          { value: "cinematic_third_person", label: "Cinematic (third person)" },
          { value: "pov_handheld_vlog", label: "First-person POV vlog (handheld selfie)" },
        ],
        help: "How the camera relates to the subject. POV framing puts the camera in the host's own hand.",
      },
    ],
  },
  {
    block: "pov_vlog_script",
    label: "POV vlog episode script",
    description:
      "Writes one episode of a first-person character vlog in the format's real structure: direct-address cold open naming the host, an immediate sensory reaction to the period, a stated itinerary, fact-drops delivered mid-scene IN CHARACTER, setups for scripted encounters with named historical figures, an in-character line to the audience, and a deadpan sign-off recap. The host is READ from the channel's character lock and never re-authored. Every fun fact must be emitted as a structured, checkable claim — the writer cannot assert a number it has not said how to verify.",
    optional: false,
    params: [
      { key: "targetSeconds", label: "Episode length (sec)", type: "number", min: 120, max: 1800, step: 30, help: "The real format runs 13-14 minutes (~800s)." },
      { key: "dialogueBeats", label: "Conversations", type: "number", min: 1, max: 3, step: 1, help: "How many scripted encounters with historical figures this episode calls for." },
    ],
  },
  {
    block: "dialogue_scene",
    label: "Scripted encounter (dialogue)",
    description:
      "Turns each conversation the episode called for into speaker-tagged turns between the host and named historical figures, then splices them into the finished narration. It synthesizes NO speech and renders NO picture — it produces dialogue text and nothing else. Rejects the four ways a scripted historical conversation actually fails: too few turns, the counterpart used as a lectern, stacked turns with no real exchange, and paragraph-length exposition dumps.",
    optional: false,
    params: [],
  },
  {
    block: "fact_check",
    label: "Historical fact check (Wikidata)",
    description:
      "Verifies every claim the episode makes against Wikidata date and quantity statements over the same free, unauthenticated CC0 endpoint the quiz and ranking lanes use. A subject that resolves ambiguously, or an entity carrying conflicting values, is refused rather than arbitrated. A claim the record CONTRADICTS fails the episode outright; claims with no structured statement are reported as unverifiable rather than passed off as correct, and capped by ratio. Costs nothing.",
    optional: false,
    params: [
      {
        key: "maxUnsupportedRatio",
        label: "Max unverifiable share",
        type: "number",
        min: 0,
        max: 1,
        step: 0.1,
        help: "Fraction of claims allowed to have no structured source. Contradicted claims always fail regardless of this.",
      },
    ],
  },
  {
    block: "rank_data",
    label: "Ranking data (cited)",
    description:
      "Sources the ranked list a chart video counts down — tallest buildings, longest rivers, biggest cities — by reading Wikidata QUANTITY STATEMENTS (CC0) directly. No model is ever asked for a figure, entities carrying conflicting values are dropped rather than picked between, rows measured in the wrong unit are dropped rather than converted, and every surviving row carries a resolvable citation. Produces data only; it renders nothing.",
    optional: false,
    params: [
      {
        key: "rankTopic",
        label: "Ranking subject",
        type: "select",
        options: [
          { value: "tallest_buildings", label: "Tallest buildings" },
          { value: "longest_rivers", label: "Longest rivers" },
          { value: "highest_mountains", label: "Highest mountains" },
          { value: "most_populous_countries", label: "Most populous countries" },
          { value: "most_populous_cities", label: "Biggest cities" },
          { value: "largest_lakes", label: "Largest lakes" },
        ],
      },
      {
        key: "chartMode",
        label: "Chart motion",
        type: "select",
        options: [
          { value: "count_up", label: "Top-N count-up reveal" },
          { value: "bar_race", label: "Bar chart race" },
        ],
      },
      { key: "secondsPerRow", label: "Seconds per entry", type: "number", min: 2, max: 20, step: 1 },
      { key: "outroSeconds", label: "Outro hold (sec)", type: "number", min: 0, max: 20, step: 1 },
      { key: "minNotability", label: "Minimum fame", type: "number", min: 0, max: 200, step: 5, help: "Wikipedia language editions the subject must appear in." },
    ],
  },
  {
    block: "sim_narrative",
    label: "Dramatized simulation story",
    description:
      "Authors an explicitly IMAGINARY simulation run in ONE bounded LLM call — story beats at chosen generation numbers plus the level the curve sits at, from which the graph is interpolated deterministically. It is not a real genetic algorithm and never claims to be: the mandatory speculative disclosure is prepended and appended in code, and the block refuses to ship narration that asserts the run actually happened.",
    optional: false,
    params: [
      { key: "beats", label: "Story beats", type: "number", min: 3, max: 8, step: 1, help: "How many dramatic turns the imagined run has." },
      { key: "secondsPerRow", label: "Pacing unit (sec)", type: "number", min: 2, max: 20, step: 1 },
      { key: "outroSeconds", label: "Outro hold (sec)", type: "number", min: 0, max: 20, step: 1 },
    ],
  },
  {
    block: "chart_render",
    label: "Animated chart render",
    description:
      "Draws whatever ChartSpec it is given — a bar-chart race, a Top-N count-up or a single moving curve — in an ISOLATED Remotion bundle, then muxes the narration that narration_tts already produced. Shared by the ranking and dramatized-simulation families; it never sources data, writes a script or synthesizes speech. A chart declared illustrative gets its disclosure burned into every frame.",
    optional: false,
    params: [],
  },
  {
    block: "quiz_year",
    label: "Mixed trivia quiz",
    description:
      "Self-contained multiple-choice trivia quiz that MIXES categories inside one video the way real trivia channels do — guess-the-year, capital cities, currencies, chemical symbols, atomic numbers and citation-verified general knowledge. Facts come from Wikidata (CC0); general-knowledge rounds are accepted only when an independently fetched Wikipedia article is shown to state the answer and to not state any of the wrong options. Each round shows four options with a depleting timer and locks in the correct one on reveal. The answer is never LLM-generated — a model only phrases the question. Replaces script + footage + assembly for the Quiz family.",
    optional: false,
    params: [
      {
        key: "categories",
        label: "Question categories",
        type: "text",
        help: "Comma-separated mix, e.g. \"guess_year, capital_city, general_knowledge\". Leave blank for the full mix. Options: guess_year, capital_city, country_currency, element_symbol, element_atomic_number, general_knowledge.",
      },
      {
        key: "topic",
        label: "Guess-the-year topic",
        type: "select",
        options: [
          { value: "science_discovery", label: "Scientific discoveries" },
          { value: "space_exploration", label: "Space missions" },
          { value: "invention_technology", label: "Inventions & technology" },
          { value: "video_games", label: "Video game releases" },
          { value: "film_release", label: "Film releases" },
          { value: "sports_championship", label: "Sporting events" },
          { value: "landmark_architecture", label: "Landmarks & monuments" },
        ],
      },
      { key: "countdownSeconds", label: "Guess time (sec)", type: "number", min: 3, max: 15, step: 1, help: "How long the viewer gets before the answer locks in." },
      { key: "revealSeconds", label: "Reveal hold (sec)", type: "number", min: 2, max: 10, step: 1 },
      { key: "minNotability", label: "Minimum fame", type: "number", min: 0, max: 200, step: 5, help: "Wikipedia language editions the subject must appear in. Higher = more widely known, fewer available facts." },
    ],
  },
  {
    block: "timeline_assemble",
    label: "Assemble",
    description: "Cuts footage to narration, beds the music, and renders the final video.",
    optional: false,
    params: [
      { key: "tailSec", label: "Outro hold (sec)", type: "number", min: 0, max: 30, step: 1, help: "How long the closing card holds." },
      { key: "fadeOutSec", label: "Video fade-out (sec)", type: "number", min: 0, max: 6, step: 0.5 },
      { key: "audioFadeOutSec", label: "Music fade-out (sec)", type: "number", min: 0, max: 30, step: 1 },
      { key: "burnCaptions", label: "Burn-in captions", type: "toggle" },
    ],
  },
  {
    block: "length_check",
    label: "Length Check",
    description: "Gates the final video to an acceptable duration band.",
    optional: true,
    params: [
      { key: "minSeconds", label: "Min length (sec)", type: "number", min: 0, max: 3600, step: 30 },
      { key: "maxSeconds", label: "Max length (sec)", type: "number", min: 0, max: 5400, step: 30 },
    ],
  },
  {
    block: "scene_planner",
    label: "Scene Planner",
    description: "Plans the looping visual scenes (lofi / ambient).",
    optional: false,
    params: [
      { key: "clipDurationSec", label: "Clip length (sec)", type: "number", min: 3, max: 15, step: 1 },
    ],
  },
  {
    block: "loop_clips",
    label: "Loop Clips",
    description: "Generates the seamless looping clips.",
    optional: false,
    params: [
      { key: "clipDurationSec", label: "Clip length (sec)", type: "number", min: 3, max: 15, step: 1 },
    ],
  },
  {
    block: "upscale",
    label: "Upscale",
    description: "Upscales and frame-interpolates the loop.",
    optional: true,
    params: [
      {
        key: "targetResolution", label: "Resolution", type: "select",
        options: [
          { value: "2k", label: "2K" },
          { value: "4k", label: "4K" },
        ],
      },
      { key: "targetFps", label: "FPS", type: "number", min: 24, max: 60, step: 6 },
    ],
  },
  {
    block: "assemble",
    label: "Assemble (Loop)",
    description: "Loops the clip to the full runtime with a deblur intro.",
    optional: false,
    params: [
      { key: "durationSec", label: "Runtime (sec)", type: "number", min: 30, max: 36000, step: 30, help: "Total video length the loop is extended to." },
      { key: "deblurIntro", label: "Deblur intro", type: "toggle", help: "Open on a focus-pull from blur with the title." },
    ],
  },
  {
    block: "upload_draft",
    label: "Upload",
    description: "Uploads to YouTube.",
    optional: false,
    params: [
      {
        key: "publishMode", label: "Publish mode", type: "select",
        options: [
          { value: "draft", label: "Private draft" },
          { value: "scheduled", label: "Scheduled" },
          { value: "public", label: "Public" },
        ],
      },
    ],
  },
];

const BY_BLOCK: Record<string, ModuleSpec> = Object.fromEntries(
  MODULE_CATALOG.map((m) => [m.block, m]),
);

export function getModuleSpec(block: string): ModuleSpec | undefined {
  return BY_BLOCK[block];
}

/**
 * Sanitize raw param overrides from the wizard: drop unknown blocks/keys, coerce
 * to the declared type, and clamp numbers to their bounds. Returns a clean
 * `paramOverrides` object safe to pass to designPipeline() / the design task.
 */
export function sanitizeParamOverrides(
  raw: unknown,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [block, vals] of Object.entries(raw as Record<string, unknown>)) {
    const spec = BY_BLOCK[block];
    if (!spec || !vals || typeof vals !== "object") continue;
    const clean: Record<string, unknown> = {};
    for (const field of spec.params) {
      const v = (vals as Record<string, unknown>)[field.key];
      if (v === undefined || v === null || v === "") continue;
      if (field.type === "number") {
        let n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) continue;
        if (field.min !== undefined) n = Math.max(field.min, n);
        if (field.max !== undefined) n = Math.min(field.max, n);
        clean[field.key] = n;
      } else if (field.type === "toggle") {
        clean[field.key] = Boolean(v);
      } else if (field.type === "select") {
        const ok = field.options?.some((o) => o.value === v);
        if (ok) clean[field.key] = v;
      } else {
        // text
        const s = String(v).trim();
        if (s) clean[field.key] = s.slice(0, 500);
      }
    }
    if (Object.keys(clean).length) out[block] = clean;
  }
  return out;
}
