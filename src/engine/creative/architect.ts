/**
 * LLM PIPELINE ARCHITECT — the design-time intelligence that turns a template
 * pipeline into THIS channel's pipeline.
 *
 * The split that has held up everywhere in this codebase: the AGENT DECIDES,
 * CODE EXECUTES. The architect (Claude) reads the channel's identity — Style
 * DNA, Show Bible, quality bar, grounding state, provider availability — and
 * chooses WHAT to add/remove/tune from a TYPED TOOLBOX it is shown explicitly.
 * The executor then applies each decision deterministically: placement anchors,
 * param bounds, core-block protection, cross-param invariants, and a
 * validatePipeline gate per operation. A decision the executor can't verify is
 * REJECTED (and recorded), never trusted.
 *
 * Three first-class concerns beyond module choice (operator mandate):
 *  - ANTI-REPETITION: every knob that keeps output non-repetitive across a
 *    channel's lifetime (topic policy, music track variety, variation axes,
 *    quote/insert pacing) is the architect's to reason about per channel.
 *  - GROUNDING HONESTY: the architect sees confidence/groundingGaps/competitor
 *    counts and must order repair work (`groundingActions`) instead of
 *    configuring confidently on garbage.
 *  - CAPABILITY GAPS: when the channel needs a tool the toolbox lacks (map
 *    animations, whiteboard, podcast remix…), it says so in
 *    `missingCapabilities` — the build queue for new modules — rather than
 *    bending an ill-fitting module.
 *
 * The deterministic designer remains the validated floor: if the architect or
 * any of its decisions fail, the channel ships with the floor pipeline.
 */
import { z } from "zod";
import { agentJson } from "@/agents/mastra";
import { registerAllBlocks } from "@/engine/blocks";
import { get as getBlock } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import type { PipelineEntry } from "@/engine/types";
import type { ShowBible, StyleDNA, QualityBar } from "./types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/* ------------------------------ Toolbox -------------------------------- */

export interface ToolParam {
  key: string;
  type: "number" | "boolean" | "string" | "enum" | "enum_list" | "string_list";
  describe: string;
  min?: number;
  max?: number;
  maxLen?: number;
  options?: string[];
}

export interface Tool {
  block: string;
  purpose: string;
  /** Honest fit guidance — when this module earns its place (and when not). */
  whenToUse: string;
  addable: boolean;
  removable: boolean;
  /** Placement: inserted AFTER the first anchor present in the pipeline. */
  anchorAfter?: string[];
  /** Env keys that must be present to enable this module. */
  requiresEnv?: string[];
  /** Family applicability ("narrated" | "loop"); undefined = both. */
  appliesTo?: "narrated" | "loop";
  params: ToolParam[];
}

/**
 * The architect's toolbox. HONEST capabilities only — params that exist and do
 * what they say (the wizard catalog's unimplemented footage themes are not
 * repeated here). Bounds are enforced by the executor, not trusted.
 */
export const ARCHITECT_TOOLBOX: Tool[] = [
  {
    block: "visual_inserts",
    purpose:
      "Script-synced motion-graphics inserts (animated stat counters, draw-on line charts, bar comparisons) branded by the channel palette, composited at the exact second the narration speaks the number. Deterministic integrity gate: only numbers spoken verbatim render.",
    whenToUse:
      "Channels whose content lives on numbers: finance, business, health data, tech benchmarks, history dates, sports stats. NOT for mood/ambient channels (lofi, meditation) or pure storytelling with no figures.",
    addable: true,
    removable: true,
    anchorAfter: ["quote_overlays", "intro_card", "narration_tts"],
    appliesTo: "narrated",
    params: [
      { key: "insertTypes", type: "enum_list", options: ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"], describe: "Which visual kinds fit this channel's content. annotated_line = historical arcs with labeled event markers; lower_third = source-citation badge when a stat's source is NAMED in the narration (data-journalism trust device)." },
      { key: "maxInserts", type: "number", min: 1, max: 8, describe: "Cap per video. Fewer, stronger inserts beat many weak ones." },
      { key: "minGapSec", type: "number", min: 10, max: 60, describe: "Minimum spacing between inserts." },
    ],
  },
  {
    block: "quote_overlays",
    purpose: "Attributed-quote cards (blur-under, timed to when the quote is spoken).",
    whenToUse:
      "Channels that quote real figures: philosophy, literature, history, faith. NOT for channels whose scripts rarely quote (data explainers, ambient).",
    addable: true,
    removable: true,
    anchorAfter: ["intro_card", "narration_tts"],
    appliesTo: "narrated",
    params: [
      { key: "maxQuotes", type: "number", min: 1, max: 6, describe: "Quote cards per video." },
      { key: "minQuoteWords", type: "number", min: 4, max: 16, describe: "Reject quotes shorter than this." },
      { key: "attributedOnly", type: "boolean", describe: "Only genuinely ATTRIBUTED quotes become cards (no rhetorical script-line fillers) — premium/documentary channels want true." },
    ],
  },
  {
    block: "entity_imagery",
    purpose: "Wikimedia portraits of named figures shown with a Ken Burns move when the script mentions them (license-attributed).",
    whenToUse:
      "Channels that discuss real people (history, finance figures, science). Remove for channels that never name people (ambient, abstract explainers) — it just burns vision calls.",
    addable: true,
    removable: true,
    anchorAfter: ["stock_footage"],
    appliesTo: "narrated",
    params: [],
  },
  {
    block: "shorts_spinoff",
    purpose: "Cuts the hook window into a 9:16 Short with word-level captions and uploads it PRIVATE alongside the long-form.",
    whenToUse: "Channels chasing discovery via Shorts. Skip when the operator wants long-form purity.",
    addable: true,
    removable: true,
    anchorAfter: ["upload_draft"],
    appliesTo: "narrated",
    params: [
      { key: "shortDurSec", type: "number", min: 20, max: 60, describe: "Short length." },
    ],
  },
  {
    block: "qa_refine",
    purpose: "LEGACY no-op block (superseded by qa_visual). Safe to remove from any pipeline.",
    whenToUse: "Never — remove it when present.",
    addable: false,
    removable: true,
    params: [],
  },
  {
    block: "topic_select",
    purpose: "Chooses each video's topic with a no-repeat memory.",
    whenToUse: "Core. Tune the repeat policy to the channel's content shape.",
    addable: false,
    removable: false,
    params: [
      { key: "policy", type: "enum", options: ["no_repeat", "prefer_fresh"], describe: "no_repeat = evergreen library channels (never reuse a topic). prefer_fresh = trend/news-adjacent channels may revisit when the pool is exhausted." },
    ],
  },
  {
    block: "script_gen",
    purpose: "Writes the narration script in the channel's DNA register.",
    whenToUse: "Core. Length and tone are the channel-defining knobs.",
    addable: false,
    removable: false,
    appliesTo: "narrated",
    params: [
      { key: "maxSeconds", type: "number", min: 60, max: 2100, describe: "Target spoken length (sec). Drives the word budget; length_check band follows automatically." },
      { key: "style", type: "enum", options: ["generic", "crime", "shorts", "meditation"], describe: "Archetype tone UNDER the DNA register (DNA wins). crime=tension/withhold-reveal, meditation=slow guided, shorts=punchy." },
      { key: "endWithSummary", type: "boolean", describe: "Close with a recap section." },
      { key: "dataRich", type: "boolean", describe: "Force 3-6 concrete sourced figures into the narration (set automatically when visual_inserts is present)." },
    ],
  },
  {
    block: "narration_tts",
    purpose: "Per-sentence TTS with humanized pauses; chapter cards optional.",
    whenToUse: "Core. Pacing IS the channel's feel — set it from the DNA's pacing/delivery.",
    addable: false,
    removable: false,
    appliesTo: "narrated",
    params: [
      { key: "sentenceGapSec", type: "number", min: 0.3, max: 2.5, describe: "Base pause between sentences. Calm/documentary 1.2-1.8; standard 0.8-1.1; energetic 0.4-0.7." },
      { key: "sentenceGapJitter", type: "number", min: 0, max: 0.6, describe: "Random pause variation (human feel)." },
      { key: "ttsSpeed", type: "number", min: 0.85, max: 1.15, describe: "Speaking-rate multiplier. Sleep 0.88; calm 0.93-0.96; energetic 1.05." },
      { key: "chapterCards", type: "boolean", describe: "Speak each section heading over a fading card. Good for structured explainers; off for flowing narratives." },
      { key: "voiceFx", type: "enum", options: ["none", "radio"], describe: "Stylized voice filter. 'radio' ONLY for vintage/period channels — never premium/modern brands." },
      { key: "ttsProvider", type: "enum", options: ["fish", "elevenlabs"], describe: "Voice engine. elevenlabs = v3 expressive tier: PERFORMS inline [audio tags] ([pause][sighs][whispers][chuckles]) the writer places — pick for flagship/emotional channels; fish = solid default." },
      { key: "elevenVoiceId", type: "string", maxLen: 30, describe: "ElevenLabs voice id (only with ttsProvider=elevenlabs; default = George, documentary-grade)." },
    ],
  },
  {
    block: "stock_footage",
    purpose: "Sources distinct, vision-gated REAL b-roll matching the channel's visual world (DNA setting/grade drive the gate).",
    whenToUse:
      "Core for narrated channels whose world EXISTS on film (cities, nature, offices, archive-adjacent). SWAPPABLE: when the channel's world is drawn/painted/impossible-to-film, propose `remove stock_footage` + `add gen_footage` IN THE SAME PLAN (the executor performs it as one swap).",
    addable: true,
    removable: true,
    anchorAfter: ["narration_tts"],
    appliesTo: "narrated",
    params: [
      { key: "footageTheme", type: "enum", options: ["", "nature"], describe: "'' = topic/DNA-matched (default, correct for almost everyone). 'nature' = HARD-LOCK to serene nature/ruins only — exclusively for contemplative nature-aesthetic channels." },
      { key: "signatureGenClips", type: "number", min: 0, max: 6, describe: "HYBRID: prepend K GENERATED signature establishing shots of the channel's canonical world (~$0.17 each) to the stock body — brand anchors stock can't provide. 2-3 for channels with a strong proprietary visual world; 0 when stock covers the world fine." },
    ],
  },
  {
    block: "gen_footage",
    purpose:
      "GENERATED b-roll: the Scene Director plans one scene per script beat in the channel's locked visual world; each scene = DNA-styled still → image-to-video clip (model env-swappable: Kling default, Veo-class optional). Same footageClips contract as stock_footage.",
    whenToUse:
      "Channels whose visual identity CANNOT come from a stock library: whiteboard/drawn explainers, painted or stylized worlds, signature recurring scenes, historical reconstructions. Costs ~$0.15-0.20/clip — use maxClips to budget. Must REPLACE stock_footage (propose both ops in one plan: remove stock_footage + add gen_footage).",
    addable: true,
    removable: true,
    anchorAfter: ["narration_tts"],
    appliesTo: "narrated",
    params: [
      { key: "maxClips", type: "number", min: 6, max: 24, describe: "Generated clips per video (coverage vs cost — ~1 per 22s of narration)." },
      { key: "clipSec", type: "number", min: 5, max: 10, describe: "Seconds per generated clip (5 = cheaper, 10 = longer holds)." },
      { key: "i2vModel", type: "enum", options: ["kling", "kling_pro", "veo3_fast"], describe: "Fidelity tier vs cost: kling ~$0.13/clip (default), kling_pro ~$0.45, veo3_fast ~$0.80 — choose from the quality bar AND the channel budget; veo-class only when the bar demands cinema-grade motion." },
    ],
  },
  {
    block: "music",
    purpose: "Generates the score (multi-track crossfaded mix, mastered to the DNA LUFS target). Provider failover is automatic.",
    whenToUse: "Core. trackCount is the anti-repetition knob for longer videos (distinct tracks crossfaded vs one loop).",
    addable: false,
    removable: false,
    params: [
      { key: "provider", type: "enum", options: ["suno", "mureka"], describe: "Primary provider (auto-failover to the other on quota death)." },
      { key: "model", type: "string", maxLen: 12, describe: "Suno model, e.g. V5 (highest quality)." },
      { key: "trackCount", type: "number", min: 1, max: 8, describe: "Distinct clips crossfaded into the mix. ~1 per 5-7 min of video; 2 minimum for variety." },
    ],
  },
  {
    block: "thumbnail_gen",
    purpose: "Executes the channel's thumbnail playbook (evidence-distilled patterns, Remotion typography, comparative reference QA).",
    whenToUse: "Core. patternBias steers the rotation toward tournament-proven patterns.",
    addable: false,
    removable: false,
    params: [
      { key: "patternBias", type: "string_list", maxLen: 40, describe: "Playbook pattern NAMES to favor in rotation (subset of the channel's thumbnailPlaybook patterns — bias toward the tournament winners)." },
      { key: "thumbEnergy", type: "enum", options: ["spectacle", "bold", "cozy_pop"], describe: "Clickbait ENERGY override: spectacle = over-the-top impossible-scale drama (finance/tech/drama); bold = grounded heroic punch (education/history); cozy_pop = charming saturated warmth (lofi/ambient). ALL are catchy — match what the identity can carry." },
    ],
  },
  {
    block: "metadata",
    purpose: "Generates SEO title/description/tags against the DNA title formula + competitor research.",
    whenToUse: "Core. baseTags are the seeded tag floor — replace them when the catalog seeds clash with the brand (banned-word pollution).",
    addable: false,
    removable: false,
    params: [
      { key: "baseTags", type: "string_list", maxLen: 40, describe: "Seed tags (8-14, lowercase, brand-safe — never words the channel's bible bans)." },
    ],
  },
  {
    block: "intro_card",
    purpose: "Branded Remotion title card over a music-only opener (channel avatar background).",
    whenToUse: "Core for narrated. Short intros for energetic channels, longer for cinematic.",
    addable: false,
    removable: false,
    appliesTo: "narrated",
    params: [
      { key: "introSec", type: "number", min: 2, max: 8, describe: "Card duration." },
    ],
  },
  {
    block: "timeline_assemble",
    purpose: "Cuts footage at the Editor's cadence, beds music, composites overlays/inserts, renders outro.",
    whenToUse: "Core. Tail/fade lengths set the ending's character.",
    addable: false,
    removable: false,
    appliesTo: "narrated",
    params: [
      { key: "tailSec", type: "number", min: 1, max: 20, describe: "Outro card hold (sec)." },
      { key: "fadeOutSec", type: "number", min: 0, max: 6, describe: "Video fade at the very end." },
      { key: "audioFadeOutSec", type: "number", min: 0, max: 30, describe: "Music fade across the tail." },
      { key: "burnCaptions", type: "boolean", describe: "Burn word-timed captions into the video." },
    ],
  },
  {
    block: "scene_planner",
    purpose: "Plans the looping visual scene from the DNA (signature-scene rotation).",
    whenToUse: "Core for loop channels.",
    addable: false,
    removable: false,
    appliesTo: "loop",
    params: [
      { key: "clipDurationSec", type: "number", min: 3, max: 15, describe: "Planned clip length." },
    ],
  },
  {
    block: "loop_clips",
    purpose: "Generates the seamless looping clip (FLF2V end-frame loop with crossfade safety net).",
    whenToUse: "Core for loop channels.",
    addable: false,
    removable: false,
    appliesTo: "loop",
    params: [
      { key: "clipDurationSec", type: "number", min: 5, max: 12, describe: "i2v clip length." },
      { key: "loopMode", type: "enum", options: ["flf2v", "boomerang", "crossfade"], describe: "flf2v = forward motion, first==last frame (default). boomerang only for non-directional motion." },
    ],
  },
  {
    block: "assemble",
    purpose: "Loops the upscaled unit under the full music mix with the deblur-title intro.",
    whenToUse: "Core for loop channels. durationSec is the product decision (stream length).",
    addable: false,
    removable: false,
    appliesTo: "loop",
    params: [
      { key: "durationSec", type: "number", min: 60, max: 7200, describe: "Total runtime. Lofi/study mixes typically 3600+." },
      { key: "deblurIntro", type: "boolean", describe: "Focus-pull title intro (the classic lofi open)." },
    ],
  },
];

/** Blocks the architect may NEVER remove (validated backbone). */
const CORE_BLOCKS = new Set([
  "competitor_research", "topic_select", "script_gen", "qa_script", "originality_gate",
  "compliance_check", "narration_tts", "music", "intro_card",
  "timeline_assemble", "length_check", "captions", "metadata", "thumbnail_gen",
  "qa_visual", "upload_draft", "cleanup", "scene_planner", "keyframes", "loop_clips",
  "upscale", "assemble", "director_brief", "dp_brief", "editor_brief", "composer_brief",
  "critic_spec",
  // stock_footage is NOT core: it is swappable with gen_footage (same
  // footageClips contract) — the incremental graph validation prevents a
  // remove without a replacement producer.
]);

/* ------------------------------- Plan ---------------------------------- */

// params travel as a JSON-ENCODED STRING: free-form records get stripped by
// structured-output layers (the first dry-run produced 12 perfect decisions
// whose z.record params all arrived empty), and a typed flat superset trips
// Anthropic's 24-optional-param grammar limit. A JSON string survives both;
// the executor parses + validates it against the toolbox anyway.
const decisionSchema = z.object({
  action: z.enum(["add", "remove", "set_params"]),
  block: z.string(),
  paramsJson: z
    .string()
    .describe('JSON object of toolbox param key/values for this block, e.g. "{\\"sentenceGapSec\\":1.6}"')
    .optional(),
  why: z.string(),
});

const planSchema = z.object({
  summary: z.string(),
  decisions: z.array(decisionSchema).default([]),
  antiRepetition: z.array(z.string()).default([]),
  missingCapabilities: z
    .array(z.object({ name: z.string(), description: z.string(), wouldEnable: z.string() }))
    .default([]),
  groundingActions: z.array(z.string()).default([]),
  /** Channel-level: upload schedule from niche watch patterns (operator wins). */
  schedule: z.object({ frequency: z.enum(["daily", "weekly", "biweekly"]), days: z.array(z.number().min(0).max(6)).optional() }).optional(),
  /** Where this channel's budget earns most (advisory, shown to operator). */
  budgetAllocation: z.string().optional(),
});

export interface ArchitectDecision {
  action: "add" | "remove" | "set_params";
  block: string;
  params?: Record<string, unknown>;
  why: string;
}

export interface ArchitectPlan {
  summary: string;
  decisions: ArchitectDecision[];
  antiRepetition: string[];
  missingCapabilities: { name: string; description: string; wouldEnable: string }[];
  groundingActions: string[];
  schedule?: { frequency: "daily" | "weekly" | "biweekly"; days?: number[] };
  budgetAllocation?: string;
}

export interface ArchitectInput {
  family: string;
  channelName: string;
  niche?: string;
  persona?: string;
  pipeline: PipelineEntry[];
  dna?: StyleDNA | null;
  bible?: ShowBible | null;
  qualityBar?: QualityBar | null;
  /** Grounding state — competitor evidence the intelligence is built on. */
  competitorCount?: number;
  /**
   * Blocks the OPERATOR explicitly disabled in the wizard (hard rail: the
   * architect may never add these, however good its reasoning).
   */
  disabledBlocks?: string[];
  /** FORGED modules (architect-authored specs, interpreter-run) available to add. */
  forgedTools?: Tool[];
  /** Voice casting verdict (real auditions judged by an audio model). */
  voiceCasting?: { voiceId: string; name: string; character: string; why: string } | null;
  /** PROBE RENDER outcome — failure = fix it; success = CRITICAL dial-in. */
  probeReport?: {
    ok: boolean;
    error?: string;
    failedBlock?: string;
    notes?: string;
    /** Native full-watch verdict on the probe video (it SAW and HEARD it). */
    feel?: { moodMatch?: number; pacing?: number; musicFit?: number; summary?: string };
    defects?: string[];
    /** Vision critique of the probe thumbnail vs the DNA/playbook spec. */
    thumbnailCritique?: string;
    /** The probe's actual SEO output for auditing vs the DNA formula. */
    seo?: { title?: string; description?: string; tags?: string[] };
  } | null;
  log?: Logger;
}

/** Convert a forged module spec into an architect Tool. */
export function toolFromForgedSpec(spec: {
  id: string; description: string; whenToUse: string; anchorAfter: string[];
  params: { key: string; min: number; max: number; describe: string }[];
}): Tool {
  return {
    block: spec.id,
    purpose: `FORGED MODULE (authored for this fleet): ${spec.description}`,
    whenToUse: spec.whenToUse,
    addable: true,
    removable: true,
    anchorAfter: spec.anchorAfter,
    appliesTo: "narrated",
    params: spec.params.map((p) => ({ key: p.key, type: "number" as const, min: p.min, max: p.max, describe: p.describe })),
  };
}

export interface ArchitectResult {
  pipeline: PipelineEntry[];
  report: {
    at: number;
    summary: string;
    applied: { action: string; block: string; params?: Record<string, unknown>; why: string }[];
    rejected: { action: string; block: string; reason: string }[];
    schedule?: { frequency: string; days?: number[] };
    budgetAllocation?: string;
    antiRepetition: string[];
    missingCapabilities: { name: string; description: string; wouldEnable: string }[];
    groundingActions: string[];
  };
}

/* ------------------------------ Executor ------------------------------- */

function familyKind(family: string): "narrated" | "loop" {
  return family === "music_loop" || family === "sleep" ? "loop" : "narrated";
}

function validateParams(
  tool: Tool,
  raw: Record<string, unknown>,
): { clean: Record<string, unknown>; rejectedKeys: string[] } {
  const clean: Record<string, unknown> = {};
  const rejectedKeys: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const spec = tool.params.find((p) => p.key === k);
    if (!spec || v === undefined || v === null) {
      rejectedKeys.push(k);
      continue;
    }
    if (spec.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) { rejectedKeys.push(k); continue; }
      clean[k] = Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, n));
    } else if (spec.type === "boolean") {
      clean[k] = Boolean(v);
    } else if (spec.type === "enum") {
      if (spec.options?.includes(String(v))) clean[k] = String(v);
      else rejectedKeys.push(k);
    } else if (spec.type === "enum_list") {
      const arr = (Array.isArray(v) ? v : [v]).map(String).filter((x) => spec.options?.includes(x));
      if (arr.length) clean[k] = arr;
      else rejectedKeys.push(k);
    } else if (spec.type === "string_list") {
      const arr = (Array.isArray(v) ? v : [v])
        .map((x) => String(x).trim().slice(0, spec.maxLen ?? 60))
        .filter(Boolean)
        .slice(0, 20);
      if (arr.length) clean[k] = arr;
      else rejectedKeys.push(k);
    } else {
      const s = String(v).trim().slice(0, spec.maxLen ?? 200);
      if (s) clean[k] = s;
      else rejectedKeys.push(k);
    }
  }
  return { clean, rejectedKeys };
}

/** Cross-param invariants the LLM never has to remember (code owns them). */
function enforceInvariants(pipeline: PipelineEntry[]): void {
  const find = (b: string) => pipeline.find((e) => e.block === b);
  // narration pacing (pauses + voice speed) mirrors into the script word budget.
  const narr = find("narration_tts")?.params;
  const gap = narr?.["sentenceGapSec"];
  const speed = narr?.["ttsSpeed"];
  const sg = find("script_gen");
  if (typeof gap === "number" && sg) sg.params = { ...(sg.params ?? {}), sentenceGapSec: gap };
  if (typeof speed === "number" && sg) sg.params = { ...(sg.params ?? {}), ttsSpeed: speed };
  // an ElevenLabs v3 voice means the writer must place (and keep) audio tags.
  if (narr?.["ttsProvider"] === "elevenlabs" && sg) sg.params = { ...(sg.params ?? {}), voiceTags: true };
  // a data-viz layer requires a data-rich script.
  if (find("visual_inserts") && sg) sg.params = { ...(sg.params ?? {}), dataRich: true };
  // length_check band follows the script target.
  const maxSec = sg?.params?.["maxSeconds"];
  const lc = find("length_check");
  if (typeof maxSec === "number" && lc) {
    lc.params = {
      ...(lc.params ?? {}),
      minSeconds: Math.round(maxSec * 0.6),
      maxSeconds: Math.round(maxSec * 1.6),
    };
  }
}

/**
 * Apply a plan deterministically: per-op validation + placement + an
 * incremental validatePipeline gate (an op that breaks the graph is rejected
 * alone; the rest still apply). Returns the new pipeline + a full audit.
 */
export function applyArchitectPlan(
  base: PipelineEntry[],
  plan: ArchitectPlan,
  opts: { family: string; disabledBlocks?: string[]; extraTools?: Tool[]; log?: Logger },
): ArchitectResult {
  const disabled = new Set(opts.disabledBlocks ?? []);
  registerAllBlocks();
  const log = opts.log ?? (() => {});
  const kind = familyKind(opts.family);
  const byBlock = new Map([...ARCHITECT_TOOLBOX, ...(opts.extraTools ?? [])].map((t) => [t.block, t]));

  let pipeline: PipelineEntry[] = base.map((e) => ({
    block: e.block,
    params: e.params ? { ...e.params } : undefined,
  }));
  const applied: ArchitectResult["report"]["applied"] = [];
  const rejected: ArchitectResult["report"]["rejected"] = [];

  const tryValidated = (next: PipelineEntry[], op: { action: string; block: string }, reason?: string): boolean => {
    try {
      const probe = next.map((e) => ({ block: e.block, params: e.params }));
      enforceInvariants(probe);
      validatePipeline(probe);
      pipeline = probe;
      return true;
    } catch (e) {
      rejected.push({
        ...op,
        reason: `${reason ?? "graph validation failed"}: ${e instanceof Error ? e.message : e}`,
      });
      return false;
    }
  };

  // SWAP pre-pass: an (add A, remove B) pair whose blocks produce the SAME key
  // (e.g. gen_footage ⇄ stock_footage → footageClips) can never apply
  // sequentially — adding first duplicates the producer, removing first
  // orphans the consumers. Execute as ONE in-place replacement.
  const decisions = [...plan.decisions];
  for (const add of [...decisions].filter((d) => d.action === "add")) {
    const addProduces = (() => { try { return getBlock(add.block)?.produces ?? []; } catch { return []; } })();
    if (!addProduces.length) continue;
    const rem = decisions.find((d) => {
      if (d.action !== "remove" || d.block === add.block) return false;
      try { return (getBlock(d.block)?.produces ?? []).some((k) => addProduces.includes(k)); } catch { return false; }
    });
    if (!rem) continue;
    const drop = () => {
      decisions.splice(decisions.indexOf(add), 1);
      decisions.splice(decisions.indexOf(rem), 1);
    };
    if (disabled.has(add.block)) {
      rejected.push({ action: "swap", block: add.block, reason: "OPERATOR explicitly disabled this module (hard rail)" });
      drop();
      continue;
    }
    const idx = pipeline.findIndex((e) => e.block === rem.block);
    if (idx < 0) { drop(); continue; }
    const swapTool = byBlock.get(add.block);
    const { clean } = swapTool ? validateParams(swapTool, add.params ?? {}) : { clean: {} as Record<string, unknown> };
    const next = pipeline.map((e, i) =>
      i === idx ? { block: add.block, params: Object.keys(clean).length ? clean : undefined } : e,
    );
    if (tryValidated(next, { action: "swap", block: `${rem.block}→${add.block}` }, "swap breaks the graph")) {
      applied.push({ action: "swap", block: `${rem.block}→${add.block}`, params: clean, why: add.why });
      log(`architect: SWAP ${rem.block} → ${add.block}`);
    }
    drop();
  }

  for (const d of decisions) {
    const tool = byBlock.get(d.block);
    const has = pipeline.some((e) => e.block === d.block);

    if (d.action === "remove") {
      if (!has) { rejected.push({ action: d.action, block: d.block, reason: "not in pipeline" }); continue; }
      if (CORE_BLOCKS.has(d.block) || !(tool?.removable)) {
        rejected.push({ action: d.action, block: d.block, reason: "core/non-removable block" });
        continue;
      }
      const next = pipeline.filter((e) => e.block !== d.block);
      if (tryValidated(next, d, "removal breaks the graph")) {
        applied.push({ action: "remove", block: d.block, why: d.why });
      }
      continue;
    }

    if (d.action === "add") {
      if (disabled.has(d.block)) {
        rejected.push({ action: d.action, block: d.block, reason: "OPERATOR explicitly disabled this module in the wizard (hard rail)" });
        continue;
      }
      if (!tool?.addable) { rejected.push({ action: d.action, block: d.block, reason: "not an addable tool" }); continue; }
      if (has) { rejected.push({ action: d.action, block: d.block, reason: "already present" }); continue; }
      if (tool.appliesTo && tool.appliesTo !== kind) {
        rejected.push({ action: d.action, block: d.block, reason: `not applicable to ${kind} family` });
        continue;
      }
      if (tool.requiresEnv?.some((k) => !process.env[k])) {
        rejected.push({ action: d.action, block: d.block, reason: `provider key missing (${tool.requiresEnv.join(",")})` });
        continue;
      }
      const { clean } = validateParams(tool, d.params ?? {});
      const entry: PipelineEntry = { block: d.block, params: Object.keys(clean).length ? clean : undefined };
      let at = -1;
      for (const a of tool.anchorAfter ?? []) {
        const i = pipeline.findIndex((e) => e.block === a);
        if (i >= 0) { at = i + 1; break; }
      }
      if (at < 0) { rejected.push({ action: d.action, block: d.block, reason: "no placement anchor present" }); continue; }
      const next = [...pipeline.slice(0, at), entry, ...pipeline.slice(at)];
      if (tryValidated(next, d, "addition breaks the graph")) {
        applied.push({ action: "add", block: d.block, params: clean, why: d.why });
      }
      continue;
    }

    // set_params
    if (!has) { rejected.push({ action: d.action, block: d.block, reason: "not in pipeline" }); continue; }
    if (!tool || tool.params.length === 0) {
      rejected.push({ action: d.action, block: d.block, reason: "no tunable params declared for this block" });
      continue;
    }
    const { clean, rejectedKeys } = validateParams(tool, d.params ?? {});
    if (Object.keys(clean).length === 0) {
      rejected.push({ action: d.action, block: d.block, reason: `no valid params (rejected: ${rejectedKeys.join(",") || "none provided"})` });
      continue;
    }
    const next = pipeline.map((e) =>
      e.block === d.block ? { block: e.block, params: { ...(e.params ?? {}), ...clean } } : e,
    );
    if (tryValidated(next, d, "param change breaks the graph")) {
      applied.push({ action: "set_params", block: d.block, params: clean, why: d.why });
      if (rejectedKeys.length) {
        rejected.push({ action: d.action, block: d.block, reason: `out-of-toolbox keys dropped: ${rejectedKeys.join(",")}` });
      }
    }
  }

  // Final invariant pass on the winning pipeline.
  enforceInvariants(pipeline);
  try {
    validatePipeline(pipeline.map((e) => ({ block: e.block, params: e.params })));
  } catch (e) {
    // Should be unreachable (incremental gates) — fall back to the floor.
    log(`architect: FINAL validation failed (${e instanceof Error ? e.message : e}) — keeping the floor pipeline`);
    return {
      pipeline: base,
      report: {
        at: Date.now(), summary: plan.summary, applied: [], antiRepetition: plan.antiRepetition,
        rejected: [...rejected, { action: "all", block: "*", reason: "final validation failed — floor kept" }],
        missingCapabilities: plan.missingCapabilities, groundingActions: plan.groundingActions,
      },
    };
  }

  return {
    pipeline,
    report: {
      at: Date.now(),
      summary: plan.summary,
      applied,
      rejected,
      antiRepetition: plan.antiRepetition,
      missingCapabilities: plan.missingCapabilities,
      groundingActions: plan.groundingActions,
      schedule: plan.schedule,
      budgetAllocation: plan.budgetAllocation,
    },
  };
}

/* ------------------------------ The agent ------------------------------ */

function renderToolbox(kind: "narrated" | "loop", extra: Tool[] = []): string {
  return [...ARCHITECT_TOOLBOX, ...extra].filter((t) => !t.appliesTo || t.appliesTo === kind)
    .map((t) => {
      const params = t.params
        .map((p) => {
          const bounds =
            p.type === "number" ? ` (${p.min}-${p.max})`
            : p.type === "enum" || p.type === "enum_list" ? ` (${(p.options ?? []).join("|")})`
            : "";
          return `    - ${p.key} [${p.type}${bounds}]: ${p.describe}`;
        })
        .join("\n");
      const caps = [t.addable ? "addable" : "", t.removable ? "removable" : "core"].filter(Boolean).join(", ");
      return `  ${t.block} (${caps}) — ${t.purpose}\n    WHEN: ${t.whenToUse}${params ? `\n${params}` : ""}`;
    })
    .join("\n");
}

function dnaDigestFull(dna?: StyleDNA | null): string {
  if (!dna) return "NO STYLE DNA (ungrounded channel)";
  return [
    `confidence ${dna.confidence}${dna.groundingGaps?.length ? ` | GROUNDING GAPS: ${dna.groundingGaps.join("; ")}` : ""}`,
    `subject: ${dna.recurringSubject}`,
    `setting: ${dna.setting}`,
    `grade: ${dna.colorGrade}`,
    dna.narrative
      ? `narrative: style=${dna.narrative.scriptStyle} | pacing=${dna.narrative.pacing} | delivery=${dna.narrative.delivery}`
      : "",
    `audio: ${dna.audio?.genre} | ${dna.audio?.bpmRange?.join("-")} BPM | ${dna.audio?.instrumentation?.join(", ")}`,
    `variationAxes (the ONLY allowed video-to-video variation): ${dna.variationAxes?.join("; ")}`,
    `visualAvoid: ${dna.visualAvoid?.slice(0, 5).join("; ")}`,
    `seo titleFormula: ${dna.seo?.titleFormula}`,
  ].filter(Boolean).join("\n");
}

/**
 * Run the architect: interrogate the channel identity against the toolbox and
 * return a validated, applied pipeline + the full decision report.
 */
export async function architectPipeline(input: ArchitectInput): Promise<ArchitectResult | null> {
  const log = input.log ?? (() => {});
  const kind = familyKind(input.family);

  const current = input.pipeline
    .map((e) => `  ${e.block}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`)
    .join("\n");

  const prompt = [
    `You are the PIPELINE ARCHITECT for a faceless YouTube automation studio. A new channel has been`,
    `grounded (research → Style DNA → Show Bible) and carries a TEMPLATE pipeline. Your job: make the`,
    `pipeline fit THIS channel — every module either earns its place for this identity or goes; every`,
    `tunable knob is set from the identity, not left at template defaults. You serve a VAST variety of`,
    `channels — reason from THIS channel's identity, never from habit.`,
    ``,
    `CHANNEL: "${input.channelName}" | family: ${input.family} | niche: ${input.niche ?? "?"}`,
    `persona: ${input.persona ?? "?"}`,
    ``,
    `STYLE DNA (the frozen identity — your ground truth):`,
    dnaDigestFull(input.dna),
    ``,
    input.bible
      ? `SHOW BIBLE: ${input.bible.positioning}\nvibe: ${input.bible.vibe}\nAVOID in this space: ${input.bible.avoidInSpace?.slice(0, 5).join("; ")}`
      : "NO SHOW BIBLE",
    ``,
    `GROUNDING EVIDENCE: ${input.competitorCount ?? 0} competitor channels scraped; quality bar has ${input.qualityBar?.dimensions?.length ?? 0} dimensions (target ${input.qualityBar?.target ?? "?"}).`,
    ``,
    `CURRENT PIPELINE (the validated floor — change only what identity justifies):`,
    current,
    ...(input.disabledBlocks?.length
      ? [``, `OPERATOR HARD CONSTRAINTS: the operator explicitly DISABLED these modules in the wizard — you may NOT add them, regardless of identity fit: ${input.disabledBlocks.join(", ")}.`]
      : []),
    ...(input.voiceCasting
      ? [``, `VOICE CASTING (real auditions were performed and judged by an audio model): WINNER = ${input.voiceCasting.name} (${input.voiceCasting.character}) — ${input.voiceCasting.why}. If this channel deserves the premium voice tier, set narration_tts ttsProvider="elevenlabs" AND elevenVoiceId="${input.voiceCasting.voiceId}".`]
      : []),
    ...(input.probeReport && !input.probeReport.ok
      ? [``, `⚠ PROBE RENDER FAILED — a real 60s end-to-end test of THIS pipeline just ran and broke:` +
          `\nfailed block: ${input.probeReport.failedBlock ?? "?"}\nerror: ${(input.probeReport.error ?? "").slice(0, 400)}` +
          (input.probeReport.notes ? `\nnotes: ${input.probeReport.notes.slice(0, 300)}` : "") +
          `\nYour PRIMARY job in this pass is to FIX this: adjust the responsible module's params (or swap/remove the module) so the next probe succeeds. Every decision must serve the fix.`]
      : []),
    ...(input.probeReport?.ok
      ? [``, `🔍 PROBE RENDER SUCCEEDED — now CRACK DOWN. A real 60s test video exists and was reviewed by a model that WATCHED AND LISTENED to it. Judge everything below against what this channel is SUPPOSED to be (the DNA above) and TUNE ruthlessly — every gap between intent and output is yours to close with set_params/add/remove/swap decisions:` +
          (input.probeReport.feel
            ? `\nFEEL (native watch, 1-10): mood coherence ${input.probeReport.feel.moodMatch ?? "?"} | pacing ${input.probeReport.feel.pacing ?? "?"} | music fit ${input.probeReport.feel.musicFit ?? "?"}\nwatch summary: ${(input.probeReport.feel.summary ?? "").slice(0, 300)}`
            : "") +
          (input.probeReport.defects?.length ? `\nDEFECTS SEEN: ${input.probeReport.defects.slice(0, 6).join(" | ").slice(0, 400)}` : "") +
          (input.probeReport.thumbnailCritique ? `\nTHUMBNAIL CRITIQUE (vision, vs the DNA spec): ${input.probeReport.thumbnailCritique.slice(0, 350)}` : "") +
          (input.probeReport.seo
            ? `\nSEO THE PROBE ACTUALLY PRODUCED: title="${input.probeReport.seo.title ?? ""}" | tags=${(input.probeReport.seo.tags ?? []).slice(0, 10).join(",")}` +
              `\n→ Audit vs the DNA titleFormula and the bible's bans: if the title pattern, register, or tags drift off-identity, fix metadata params (baseTags) and name the drift in groundingActions.`
            : "") +
          `\nLow feel scores have OWNERS: mood→music prompt/gen_footage style or footage params; pacing→sentenceGapSec/ttsSpeed/insert caps; music fit→music params. Tune the owner, not a bystander. Be CRITICAL — "fine" is not the bar, the channel's quality bar is.`]
      : []),
    ``,
    `YOUR TOOLBOX (the ONLY modules and params that exist — bounds are enforced):`,
    renderToolbox(kind, input.forgedTools),
    ``,
    `INTERROGATE THE IDENTITY (answer each through your decisions):`,
    `1. Which optional modules does THIS content actually need (data viz? quotes? portraits? shorts?) — and which present ones don't fit and should be REMOVED?`,
    `2. Pacing: what sentence gap / speaking rate / chapter treatment realises the DNA's pacing+delivery?`,
    `3. ANTI-REPETITION (a hard requirement — videos must not feel same-y over 50 uploads): topic policy, music trackCount, insert/quote caps, and anything else that protects variety. The DNA variationAxes tell you what may vary.`,
    `4. Music: provider/model/trackCount that realises the audio DNA.`,
    `5. Length/structure: does the template length fit this niche's watch pattern?`,
    `6. GROUNDING: if confidence is low, gaps exist, or competitor evidence is thin — order the repair in groundingActions (e.g. "re-run niche research: thumbnail references off-niche"). Do NOT configure confidently on weak evidence.`,
    `7. MISSING TOOLS: if this channel needs a capability the toolbox lacks (e.g. map animations, recipe cards, code-snippet renders, whiteboard) put it in missingCapabilities — NEVER bend an ill-fitting module instead.`,
    `8. SCHEDULE: propose the upload schedule (frequency + weekdays 0=Sun..6=Sat) this niche's watch pattern rewards (the operator's explicit choice overrides yours).`,
    `9. BUDGET ALLOCATION: one sentence — where this channel's per-video budget earns the most (e.g. "spend on generated signature clips + premium voice; keep inserts lean").`,
    ``,
    `RULES: be conservative — only changes the identity JUSTIFIES, with a concrete "why" each. Numbers within bounds. params for add/set_params only from the listed keys. Quality bar is the standard: configure to MEET it, and say in groundingActions what must heal before the channel can.`,
    ``,
    `Return STRICT JSON {"summary":string,"decisions":[{"action":"add"|"remove"|"set_params","block":string,"paramsJson"?:string,"why":string}],"antiRepetition":string[],"missingCapabilities":[{"name","description","wouldEnable"}],"groundingActions":string[],"schedule"?:{"frequency":"daily"|"weekly"|"biweekly","days":number[]},"budgetAllocation"?:string}.`,
    `IMPORTANT: paramsJson is a JSON-ENCODED OBJECT STRING of the param values, e.g. "{\\"sentenceGapSec\\":1.6,\\"ttsSpeed\\":0.94}" — every add/set_params decision MUST carry its concrete values there (a set_params with no paramsJson is rejected).`,
  ].join("\n");

  try {
    const raw = await agentJson({
      role: "showrunner",
      schema: planSchema,
      log: (m) => log(m),
      maxTokens: 3000,
      temperature: 0.4,
      prompt,
    });
    const plan: ArchitectPlan = {
      summary: raw.summary ?? "",
      decisions: (raw.decisions ?? []).map((d) => {
        let params: Record<string, unknown> | undefined;
        if (d.paramsJson) {
          try {
            const parsed = JSON.parse(d.paramsJson) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              params = parsed as Record<string, unknown>;
            }
          } catch {
            log(`architect: unparseable paramsJson for ${d.block} (op will carry no params)`);
          }
        }
        return { action: d.action, block: d.block, params, why: d.why };
      }),
      antiRepetition: raw.antiRepetition ?? [],
      missingCapabilities: raw.missingCapabilities ?? [],
      groundingActions: raw.groundingActions ?? [],
      schedule: raw.schedule,
      budgetAllocation: raw.budgetAllocation,
    };
    log(`architect: plan — ${plan.decisions.length} decision(s), ${plan.missingCapabilities.length} missing capability(ies), ${plan.groundingActions.length} grounding action(s)`);
    return applyArchitectPlan(input.pipeline, plan, { family: input.family, disabledBlocks: input.disabledBlocks, extraTools: input.forgedTools, log });
  } catch (e) {
    log(`architect: agent failed (${e instanceof Error ? e.message : e}) — keeping the floor pipeline`);
    return null;
  }
}
