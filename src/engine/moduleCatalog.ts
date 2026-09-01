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
    block: "synthetic_scenario",
    label: "Fictional AI Scenario",
    description: "Locks an explicit fictional town, decision, or AI POV contract before writing; the profile is selected in the channel form rather than via free-form overrides.",
    optional: true,
    params: [],
  },
  {
    block: "scenario_disclosure_gate",
    label: "Scenario Disclosure Gate",
    description: "Rejects a fictional AI scenario script unless the opening explicitly discloses illustrative assumptions.",
    optional: true,
    params: [],
  },
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
    description: "Creates typed mood, character, setting, and storyboard locks for a cinematic story. Planning remains provider-free; a separate server-admitted direct-Novita text-to-image pack may supply byte-bound QA references, never keyframe image conditioning.",
    optional: true,
    params: [
      { key: "enabled", label: "Use Visual Matter", type: "toggle", help: "Keep the typed visual-development handoff active for this cinematic pipeline." },
      { key: "maxCharacters", label: "Character sheets", type: "number", min: 0, max: 6, step: 1 },
      { key: "maxSettings", label: "Setting sheets", type: "number", min: 0, max: 6, step: 1 },
    ],
  },
  {
    block: "topic_select",
    label: "Topic Select",
    description: "Chooses each video's topic with no-repeat memory. Ordered series are sealed in the channel Program Brief, not configured as runtime module overrides.",
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
    ],
  },
  {
    block: "serialized_program_episode_context",
    label: "Serialized Episode Context",
    description: "Route-owned, provider-free continuity receipt inserted only after an admitted serialized Topic Select completion. It has no user controls and cannot be used to create a series route.",
    optional: false,
    params: [],
  },
  {
    block: "script_gen",
    label: "Script",
    description: "Researches and writes the narration script. Its spoken-length budget is sealed by the channel format.",
    optional: false,
    params: [
      { key: "endWithSummary", label: "End with summary", type: "toggle", help: "Close with a concise recap section." },
      {
        key: "style", label: "Tone", type: "select",
        options: [
          { value: "essay", label: "Video essay" },
          { value: "crime", label: "True-crime / mystery" },
          { value: "shorts", label: "Punchy short-form" },
          { value: "meditation", label: "Calm / guided" },
          { value: "illustrated_explainer", label: "Illustrated explainer" },
          { value: "children_learning", label: "Children’s learning" },
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
      {
        key: "ttsProvider", label: "Voice engine", type: "select",
        options: [
          { value: "elevenlabs", label: "ElevenLabs v3 · expressive" },
          { value: "qwen3", label: "Qwen3-TTS · open 4090 worker" },
        ],
        help: "New-channel casting supports ElevenLabs or a qualified Qwen worker. Existing Fish channels need separately reviewed cast evidence.",
      },
      {
        key: "qwenSpeaker", label: "Qwen speaker", type: "select",
        options: [
          { value: "Aiden", label: "Aiden · clear American male" },
          { value: "Ryan", label: "Ryan · dynamic English male" },
          { value: "Serena", label: "Serena · warm female" },
          { value: "Uncle_Fu", label: "Uncle Fu · seasoned low male" },
          { value: "Vivian", label: "Vivian · bright female" },
          { value: "Dylan", label: "Dylan · clear Beijing male" },
          { value: "Eric", label: "Eric · lively Chengdu male" },
          { value: "Ono_Anna", label: "Ono Anna · playful Japanese female" },
          { value: "Sohee", label: "Sohee · warm Korean female" },
        ],
        help: "Required with Qwen3-TTS. Channel setup measures a real cold-open and binds the result to this exact speaker.",
      },
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
    description: "Script-synced motion graphics (animated stats, charts, comparisons) rendered when the narration speaks numbers. The explicit Source-attributed Data Story profile renders only numbers spoken in a sentence naming a concrete source.",
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
    block: "quiz_year",
    label: "Certified QuizYear",
    description:
      "Self-contained multiple-choice quiz. A certified QuizYear profile owns its deterministic CC0 Wikidata category and source-topic mapping; each round shows four options with a depleting timer and locks in the verified answer on reveal. Replaces script + footage + assembly for the Quiz family.",
    optional: false,
    params: [
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
    description: "Gates the final video to the duration band sealed by the selected channel format.",
    optional: true,
    params: [],
  },
  {
    block: "music_program_plan",
    label: "Original Music Program",
    description: "Seals the episode’s instrumental and looping-visual direction to the selected channel program before rendering.",
    optional: false,
    params: [],
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
      { key: "segmentCount", label: "Source segments", type: "number", min: 2, max: 2, step: 1 },
      { key: "clipDurationSec", label: "Clip length (sec)", type: "number", min: 15, max: 15, step: 1 },
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
    description: "Loops the clip to the runtime sealed by the selected channel format, with an optional deblur intro.",
    optional: false,
    params: [
      { key: "deblurIntro", label: "Deblur intro", type: "toggle", help: "Open on a focus-pull from blur with the title." },
    ],
  },
  {
    block: "episode_graph",
    label: "Episode Graph",
    description: "Locks causal beats, continuity, sources, and a deterministic scene manifest before rendering.",
    optional: false,
    params: [],
  },
  {
    block: "learning_contract",
    label: "Learning Contract",
    description: "Locks the learning objective, source-linked demonstration beats, retrieval prompt, and human-review checklist.",
    optional: false,
    params: [],
  },
  {
    block: "child_content_safety",
    label: "Children’s Safety Review",
    description: "Requires curriculum evidence, child-safe language, and a human-reviewed private draft for children-learning channels.",
    optional: false,
    params: [],
  },
  {
    block: "scene_compiler",
    label: "Scene Compiler",
    description: "Builds an original deterministic illustrated 16:9 master from the locked scene manifest.",
    optional: false,
    params: [],
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
