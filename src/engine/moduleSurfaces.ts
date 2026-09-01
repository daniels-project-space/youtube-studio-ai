/**
 * CustomizationSurfaces for the core narrated-pipeline blocks (Tier-2,
 * docs/MODULES_TO_MASTRA.md). These blocks previously had only client-side
 * MODULE_CATALOG hints and NO server contract — so their per-module config was
 * silently dropped on write (validateModuleConfigMap skips non-registered blocks).
 *
 * Each card here gives the block the SAME self-describing shape as ASSEMBLY_MODULE
 * and the crew modules: a CustomizationSurface (knobs + presets + capabilities)
 * that channels.setModuleConfig validates, the config UI renders, and the future
 * Pipeline Architect reasons over. Knobs mirror the real MODULE_CATALOG params the
 * UI sends (so validation never sees an unknown key) and the ctx.params each block
 * reads — every range/enum matches the catalog exactly.
 *
 * Only blocks whose params are ALL enum/number/boolean are here; blocks with
 * free-text params (music `prompt`, topic_select `seriesTitle`) need the Knob type
 * to gain a "text" variant first — tracked as a follow-up.
 */
import type { ModuleCard } from "./moduleRegistry";

const SCRIPT_MODULE: ModuleCard = {
  key: "script_gen",
  title: "Script",
  stage: "script",
  does: "Writes the narration script in the chosen tone, to the spoken-length target.",
  customization: {
    capabilities: ["tone presets", "format-owned word budget", "optional summary close"],
    knobs: [
      { id: "style", type: "enum", values: ["essay", "crime", "shorts", "meditation", "generic"], default: "generic", describes: "narration tone / structure", servesStyles: ["documentary", "crime", "shorts", "meditation"] },
      { id: "endWithSummary", type: "boolean", default: false, describes: "close with a concise recap section", servesStyles: ["explainer", "documentary"] },
    ],
    presets: {
      documentary: { style: "essay", endWithSummary: true },
      essay: { style: "essay" },
      shorts: { style: "shorts" },
      meditation: { style: "meditation" },
    },
  },
};

const NARRATION_MODULE: ModuleCard = {
  key: "narration_tts",
  title: "Narration",
  stage: "voice",
  does: "Synthesizes the voiceover with human-feel pauses, an optional voice effect, and spoken chapter cards.",
  customization: {
    capabilities: ["jittered inter-sentence pauses", "speaking-rate control", "stylized voice fx", "spoken chapter cards"],
    knobs: [
      { id: "sentenceGapSec", type: "number", range: [0, 3], default: 0.35, describes: "base silence between sentences (jittered)", servesStyles: ["meditation", "documentary"] },
      { id: "ttsSpeed", type: "number", range: [0.85, 1.15], default: 1.0, describes: "voice speed multiplier", servesStyles: ["meditation", "hype"] },
      { id: "voiceFx", type: "enum", values: ["none", "radio"], default: "none", describes: "stylized filter on the finished narration", servesStyles: ["vintage", "crime"] },
      { id: "chapterCards", type: "boolean", default: false, describes: "read each section heading on a fading card", servesStyles: ["documentary", "essay"] },
    ],
    presets: {
      documentary: { chapterCards: true },
      meditation: { ttsSpeed: 0.9, sentenceGapSec: 0.6 },
      shorts: { ttsSpeed: 1.1, sentenceGapSec: 0.15, chapterCards: false },
    },
  },
};

const FOOTAGE_MODULE: ModuleCard = {
  key: "stock_footage",
  title: "Stock Footage",
  stage: "visual",
  does: "Sources themed b-roll for narrated videos (topic-matched by default, or theme-locked).",
  customization: {
    capabilities: ["topic-matched b-roll", "theme lock (nature / ruins / city / abstract)"],
    knobs: [
      { id: "footageTheme", type: "enum", values: ["auto", "nature", "ruins", "city", "abstract"], default: "auto", describes: "lock b-roll to a theme (auto = topic-matched)", servesStyles: ["stoicism", "history", "nature"] },
    ],
    presets: {},
  },
};

const INTRO_MODULE: ModuleCard = {
  key: "intro_card",
  title: "Intro Card",
  stage: "visual",
  does: "Renders the Remotion title card at the start.",
  customization: {
    capabilities: ["title-card duration"],
    knobs: [
      { id: "introSec", type: "number", range: [2, 10], default: 5, describes: "title-card hold duration", servesStyles: ["branding"] },
    ],
    presets: { shorts: { introSec: 2 } },
  },
};

const INSERTS_MODULE: ModuleCard = {
  key: "visual_inserts",
  title: "Data Inserts",
  stage: "visual",
  does: "Renders script-synced motion graphics (stats / charts / comparisons) when the narration speaks numbers; its source-attributed data-story profile rejects unsourced numeric claims.",
  customization: {
    capabilities: ["number-triggered data viz", "spacing control", "source-attributed data-story contract"],
    knobs: [
      { id: "maxInserts", type: "number", range: [1, 8], default: 4, describes: "max data inserts per video", servesStyles: ["finance", "explainer"] },
      { id: "minGapSec", type: "number", range: [10, 60], default: 25, describes: "minimum spacing between inserts", servesStyles: ["explainer"] },
    ],
    presets: {
      source_attributed_data_story: { maxInserts: 5, minGapSec: 25 },
    },
  },
};

const QUOTES_MODULE: ModuleCard = {
  key: "quote_overlays",
  title: "Quote Overlays",
  stage: "visual",
  does: "Renders attributed quotes over the footage.",
  customization: {
    capabilities: ["quote count cap", "minimum quote length"],
    knobs: [
      { id: "maxQuotes", type: "number", range: [0, 8], default: 3, describes: "max quote cards per video", servesStyles: ["stoicism", "philosophy"] },
      { id: "minQuoteWords", type: "number", range: [3, 20], default: 4, describes: "minimum words for a quote to qualify", servesStyles: ["philosophy"] },
    ],
    presets: {},
  },
};

const TOPIC_MODULE: ModuleCard = {
  key: "topic_select",
  title: "Topic Select",
  stage: "topic",
  does: "Picks the next on-identity topic (or the next episode of a series), honoring the repeat policy.",
  customization: {
    capabilities: ["fresh-vs-recycle repeat policy", "route-sealed episode order"],
    knobs: [
      { id: "policy", type: "enum", values: ["prefer_fresh", "no_repeat"], default: "prefer_fresh", describes: "repeat behavior when the topic pool is exhausted", servesStyles: ["evergreen", "series"] },
    ],
    presets: {},
  },
};

const MUSIC_MODULE: ModuleCard = {
  key: "music",
  title: "Music",
  stage: "audio",
  does: "Generates the background score, crossfading distinct tracks into the mix.",
  customization: {
    capabilities: ["provider choice", "channel sound program", "structured arrangement", "style-prompt steering", "multi-track crossfade mix"],
    knobs: [
      { id: "provider", type: "enum", values: ["mureka", "suno", "minimax_music3"], default: "mureka", describes: "music provider; MiniMax-Music3 is attribution-, license-, safeguards-, and quality-gated", servesStyles: ["platform"] },
      { id: "prompt", type: "text", maxLength: 300, default: "", describes: "music style/mood prompt (e.g. 'calm ambient, soft pads, no drums')", servesStyles: ["lofi", "ambient"] },
      { id: "trackCount", type: "number", range: [1, 8], default: 2, describes: "distinct tracks crossfaded (variety vs cost)", servesStyles: ["lofi", "long-form"] },
      { id: "generationDurationSec", type: "number", range: [10, 300], default: 300, describes: "native channel-score duration before deterministic looping", servesStyles: ["lofi", "ambient", "documentary"] },
    ],
    presets: { lofi: { provider: "suno", trackCount: 4 } },
  },
};

const WHITEBOARD_MODULE: ModuleCard = {
  key: "whiteboard_scribe",
  title: "Whiteboard Scribe",
  stage: "visual",
  does: "Self-contained drawn-cinema whiteboard explainer (storyboard → narrate → hand-draw each beat).",
  customization: {
    capabilities: ["resolution", "whiteboard style pack"],
    knobs: [
      { id: "width", type: "enum", values: ["1920", "2560"], default: "1920", describes: "output resolution (1080p / 2K)", servesStyles: ["explainer"] },
      { id: "styleId", type: "enum", values: ["history", "finance"], default: "history", describes: "whiteboard art style pack", servesStyles: ["history", "finance"] },
    ],
    presets: {},
  },
};

const LENGTH_MODULE: ModuleCard = {
  key: "length_check",
  title: "Length Check",
  stage: "verify",
  does: "Gates the final video to an acceptable duration band.",
  customization: {
    capabilities: ["channel-format duration gate"],
    knobs: [],
    presets: {},
  },
};

const SCENE_PLANNER_MODULE: ModuleCard = {
  key: "scene_planner",
  title: "Scene Planner",
  stage: "visual",
  does: "Plans the looping visual scenes (lofi / ambient).",
  customization: {
    capabilities: ["clip length"],
    knobs: [
      { id: "clipDurationSec", type: "number", range: [15, 15], default: 15, describes: "source-segment length", servesStyles: ["lofi", "ambient"] },
    ],
    presets: {},
  },
};

const LOOP_CLIPS_MODULE: ModuleCard = {
  key: "loop_clips",
  title: "Loop Clips",
  stage: "visual",
  does: "Generates the seamless looping clips.",
  customization: {
    capabilities: ["two-segment source", "measured internal and wrap seams"],
    knobs: [
      { id: "segmentCount", type: "number", range: [2, 2], default: 2, describes: "sealed source-segment count", servesStyles: ["lofi", "ambient"] },
      { id: "clipDurationSec", type: "number", range: [15, 15], default: 15, describes: "per-segment source length", servesStyles: ["lofi", "ambient"] },
    ],
    presets: {},
  },
};

const UPSCALE_MODULE: ModuleCard = {
  key: "upscale",
  title: "Upscale",
  stage: "build",
  does: "Upscales and frame-interpolates the loop.",
  customization: {
    capabilities: ["target resolution", "frame-interpolation fps"],
    knobs: [
      { id: "targetResolution", type: "enum", values: ["2k", "4k"], default: "4k", describes: "output resolution", servesStyles: ["premium"] },
      { id: "targetFps", type: "number", range: [24, 60], default: 30, describes: "frame-interpolation target fps", servesStyles: ["premium"] },
    ],
    presets: {},
  },
};

const LOOP_ASSEMBLE_MODULE: ModuleCard = {
  key: "assemble",
  title: "Assemble (Loop)",
  stage: "build",
  does: "Loops the clip to the full runtime with a deblur intro.",
  customization: {
    capabilities: ["1–8 hour runtime", "packet-loop assembly", "deblur intro"],
    knobs: [
      { id: "durationSec", type: "number", range: [3600, 28800], default: 7200, describes: "final master duration", servesStyles: ["lofi", "ambient"] },
      { id: "deblurIntro", type: "boolean", default: true, describes: "open on a focus-pull from blur with the title", servesStyles: ["lofi"] },
    ],
    presets: {},
  },
};

const UPLOAD_MODULE: ModuleCard = {
  key: "upload_draft",
  title: "Upload",
  stage: "ship",
  does: "Uploads to YouTube (private draft, scheduled, or public).",
  customization: {
    capabilities: ["publish mode (draft / scheduled / public)"],
    knobs: [
      { id: "publishMode", type: "enum", values: ["draft", "scheduled", "public"], default: "draft", describes: "how the upload publishes", servesStyles: ["safety", "platform"] },
    ],
    presets: {},
  },
};

const VISUAL_MATTER_MODULE: ModuleCard = {
  key: "visual_matter",
  title: "Visual Matter",
  stage: "visual development",
  does: "Builds a channel-and-topic-specific mood board, character and setting sheets, plus per-shot storyboard locks. Planning is provider-free; an explicit server-admitted direct-Novita text-to-image pack may create byte-bound QA comparison assets, never keyframe image conditioning.",
  customization: {
    capabilities: [
      "topic-specific mood direction",
      "character and setting continuity sheets",
      "per-shot storyboard and visual QA locks",
      "typed provider-free visual handoff",
    ],
    knobs: [
      { id: "enabled", type: "boolean", default: true, describes: "apply the Visual Matter contract to cinematic renders", servesStyles: ["cinematic", "story"] },
      { id: "maxCharacters", type: "number", range: [0, 6], default: 3, describes: "maximum character sheets planned from the story continuity ledger", servesStyles: ["character", "comic", "cinematic"] },
      { id: "maxSettings", type: "number", range: [0, 6], default: 3, describes: "maximum setting sheets planned from the channel world", servesStyles: ["worldbuilding", "cinematic"] },
    ],
    presets: {
      planning_only: { enabled: true, maxCharacters: 3, maxSettings: 3 },
      world_only: { enabled: true, maxCharacters: 0, maxSettings: 3 },
    },
  },
};

const SYNTHETIC_SCENARIO_MODULE: ModuleCard = {
  key: "synthetic_scenario",
  title: "Fictional AI Scenario",
  stage: "story safety",
  does: "Locks an explicit fictional AI town, decision, or POV contract before writing. It never represents a real simulation, prediction, or model result.",
  customization: {
    capabilities: [
      "explicit town / decision / POV profile",
      "opening disclosure requirement",
      "assumption-led writing directive",
      "local scenario-board visual grammar",
    ],
    knobs: [],
    presets: {},
  },
};

const SCENARIO_DISCLOSURE_GATE_MODULE: ModuleCard = {
  key: "scenario_disclosure_gate",
  title: "Scenario Disclosure Gate",
  stage: "story safety",
  does: "Rejects a script unless its opening plainly identifies the story as a fictional AI scenario with illustrative assumptions.",
  customization: {
    capabilities: ["opening-disclosure verification", "assumption-language verification", "hard fail before narration"],
    knobs: [],
    presets: {},
  },
};

/** Core pipeline surfaces — registered into MODULE_REGISTRY. */
export const CORE_MODULE_SURFACES: ModuleCard[] = [
  TOPIC_MODULE,
  SCRIPT_MODULE,
  NARRATION_MODULE,
  FOOTAGE_MODULE,
  MUSIC_MODULE,
  INTRO_MODULE,
  INSERTS_MODULE,
  QUOTES_MODULE,
  WHITEBOARD_MODULE,
  LENGTH_MODULE,
  SCENE_PLANNER_MODULE,
  LOOP_CLIPS_MODULE,
  UPSCALE_MODULE,
  LOOP_ASSEMBLE_MODULE,
  VISUAL_MATTER_MODULE,
  SYNTHETIC_SCENARIO_MODULE,
  SCENARIO_DISCLOSURE_GATE_MODULE,
  UPLOAD_MODULE,
];
