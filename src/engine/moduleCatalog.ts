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
    block: "topic_select",
    label: "Topic Select",
    description: "Chooses each video's topic (no-repeat memory, optional ordered series).",
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
