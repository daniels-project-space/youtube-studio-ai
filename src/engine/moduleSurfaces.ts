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
    capabilities: ["tone presets", "length-budgeted word count", "optional summary close"],
    knobs: [
      { id: "style", type: "enum", values: ["essay", "crime", "shorts", "meditation", "generic"], default: "generic", describes: "narration tone / structure", servesStyles: ["documentary", "crime", "shorts", "meditation"] },
      { id: "maxSeconds", type: "number", range: [30, 3600], default: 420, describes: "spoken-length target → word budget", servesStyles: ["platform"] },
      { id: "endWithSummary", type: "boolean", default: false, describes: "close with a concise recap section", servesStyles: ["explainer", "documentary"] },
    ],
    presets: {
      documentary: { style: "essay", endWithSummary: true },
      essay: { style: "essay" },
      shorts: { style: "shorts", maxSeconds: 50 },
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
  does: "Renders script-synced motion graphics (stats / charts / comparisons) when the narration speaks numbers.",
  customization: {
    capabilities: ["number-triggered data viz", "spacing control"],
    knobs: [
      { id: "maxInserts", type: "number", range: [1, 8], default: 4, describes: "max data inserts per video", servesStyles: ["finance", "explainer"] },
      { id: "minGapSec", type: "number", range: [10, 60], default: 25, describes: "minimum spacing between inserts", servesStyles: ["explainer"] },
    ],
    presets: {},
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

/** Core narrated-pipeline surfaces — registered into MODULE_REGISTRY. */
export const CORE_MODULE_SURFACES: ModuleCard[] = [
  SCRIPT_MODULE,
  NARRATION_MODULE,
  FOOTAGE_MODULE,
  INTRO_MODULE,
  INSERTS_MODULE,
  QUOTES_MODULE,
];
