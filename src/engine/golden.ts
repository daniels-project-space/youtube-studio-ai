/**
 * THE GOLDEN PIPELINE â€” the single tuning surface for what EVERY channel inherits.
 *
 * The block engine (designer.ts + families.ts) still builds each channel's concrete
 * pipeline, but the *intent* â€” the canonical stage order, the spoken-craft rules,
 * and per-niche defaults â€” lives here so refining the "golden base" is a one-file
 * edit that lifts every channel at once. Per-channel customization then layers on
 * top via: family delta (visual engine) â†’ param overrides â†’ Show Bible crew brief
 * â†’ analytics learning loop.
 */

/**
 * CRAFT_RULES â€” research-backed retention craft injected into every script prompt
 * (short, long, per-section, hook). Channel-agnostic; the Show Bible adds the
 * channel-specific doctrine on top. Sources: faceless-retention studies 2026
 * (hook<7s, <15-word sentences, one idea/60-90s, mid-video pattern break).
 */
export const CRAFT_RULES = [
  "RETENTION CRAFT (apply throughout, this is non-negotiable):",
  "- HOOK: the first 1-2 spoken lines must hook within ~7 seconds â€” a curiosity gap, a bold/contrarian claim, a pattern interrupt, or direct second-person address (\"you\"). No slow throat-clearing or \"in this video\" intros.",
  "- SENTENCES: short and spoken â€” average UNDER 15 words. Vary rhythm. No run-ons.",
  "- ONE IDEA AT A TIME: deliver one clear, complete idea roughly every 60-90 seconds; always move forward, never stall or pad.",
  "- MIDPOINT RE-HOOK: around the middle, insert a deliberate pattern break â€” a pointed question to the viewer, a vivid concrete example, or a tonal shift â€” to recover the attention dip where audiences usually drop.",
  "- DIRECT ADDRESS: speak to \"you\" where natural; make abstract ideas concrete and felt before explaining them.",
].join("\n");

/**
 * GOLDEN_SPINE â€” the canonical ordered stages every narrated channel inherits.
 * Documentation + reference for designer.ts alignment (the visual stage swaps per
 * family). Not executed directly; the block engine remains the orchestrator.
 */
export interface GoldenStage {
  /** Stage group label. */
  stage: string;
  /** Block id(s) that fulfil it (family may swap the visual engine). */
  blocks: string[];
  /** Why it's in the spine. */
  note: string;
}

export const GOLDEN_SPINE: GoldenStage[] = [
  { stage: "intel", blocks: ["competitor_research", "outlier_research", "topic_select"], note: "Pick topics from real outliers + competitor signal, learning-weighted." },
  { stage: "brief", blocks: ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"], note: "Show Bible crew â€” addable per channel." },
  { stage: "write", blocks: ["script_gen", "hook_craft"], note: "Hook-first, CRAFT_RULES applied." },
  { stage: "guard", blocks: ["qa_script", "originality_gate", "compliance_check"], note: "Quality + originality + compliance floor." },
  { stage: "voice", blocks: ["narration_tts"], note: "Voice = #1 retention factor; tiered provider per niche." },
  { stage: "visual", blocks: ["stock_footage", "entity_imagery", "keyframes", "loop_clips"], note: "Family delta swaps the engine here." },
  { stage: "layer", blocks: ["captions", "quote_overlays", "intro_card"], note: "Word-level captions + overlays." },
  { stage: "build", blocks: ["timeline_assemble", "length_check"], note: "Remotion assembly + length gate." },
  { stage: "package", blocks: ["thumbnail_gen", "metadata"], note: "SEO metadata + BANANA thumbnail (one-pass Nano Banana Pro, judge-gated)." },
  { stage: "verify", blocks: ["qa_visual", "qa_refine"], note: "Critic ValidationSpec â†’ refine loop." },
  { stage: "ship", blocks: ["upload_draft", "emit_bundle", "crosspost", "notify"], note: "PRIVATE-first upload + multilang reuse + multi-platform + shorts." },
];

/**
 * GOLDEN_MODULES — the golden template, module by module, as shown on the
 * studio's "Golden Pipeline" tab. One entry per module of the spine with the
 * honest story of HOW it works and which gates protect it. `status: "golden"`
 * marks a module certified at the golden bar (operator-approved output quality,
 * judge-gated, no silent fallbacks) — the thumbnail engine is the first.
 * Order = display order: golden modules lead, then the spine in stage order.
 */
export type GoldenModuleStatus = "golden" | "active";

export interface GoldenModule {
  key: string;
  /** Spine stage this module belongs to. */
  stage: string;
  title: string;
  /** What powers it (engine/provider/library). */
  engine: string;
  /** How it actually works, honestly, in 2-4 sentences. */
  how: string;
  /** The QA gates that protect its output. */
  gates: string[];
  status: GoldenModuleStatus;
}

export const GOLDEN_MODULES: GoldenModule[] = [
  {
    key: "thumbnail",
    stage: "package",
    title: "Thumbnail — Banana Engine",
    engine: "Nano Banana Pro (gemini-3-pro-image-preview), one-pass design-native render",
    how:
      "A rich design brief — channel identity, signature type treatment, a scene that literally enacts the " +
      "topic, a 2-3 line headline with one HUGE payoff word, badge — renders the COMPLETE thumbnail in a " +
      "single pass: dimensional material typography, photo-cutout collage, hero at 55-75% of frame, text " +
      "never covering faces, exact spelling. A vision judge scores six dimensions; one feedback retry, then " +
      "loud failure into the heal loop. ~15s and ~$0.13 per render, standalone in src/lib/banana.ts.",
    gates: ["exact-spelling textOk", "faceClear", "punch ≥ 7", "styleMatch ≥ 7", "storyMatch ≥ 7", "uiClean"],
    status: "golden",
  },
  {
    key: "topic-intel",
    stage: "intel",
    title: "Topic Intel",
    engine: "Self-hosted outlier intel + competitor research + learning-weighted topic_select",
    how:
      "Scrapes the niche's outlier videos and competitor uploads into a free self-hosted databank, blends " +
      "the analytics learning loop's weights, and picks fresh topics inside the channel identity (topic " +
      "pool, banned words) while avoiding everything already done or planned.",
    gates: ["dedupe vs done + planned topics", "identity constraints"],
    status: "active",
  },
  {
    key: "show-bible",
    stage: "brief",
    title: "Show Bible + Crew",
    engine: "Showrunner + addable crew blocks (director / DP / editor / composer / critic)",
    how:
      "The Show Bible distills the channel's frozen Style DNA into working doctrine; per-video crew briefs " +
      "set visual grammar, cut rhythm and score palette, and the critic authors a ValidationSpec the verify " +
      "stage enforces. Missing crew throws — no silent skips.",
    gates: ["crew throws on missing inputs", "per-video ValidationSpec authored"],
    status: "active",
  },
  {
    key: "script",
    stage: "write",
    title: "Script + Hook",
    engine: "Hookcraft cold-open engine + latest Gemini Pro narration (gemini-3.1-pro-preview)",
    how:
      "The cold open comes FIRST: hookcraft writes three device-diverse candidates (cold-open scene, " +
      "receipt, contrarian verdict, …) that must be SPECIFICALLY about the topic, runs a deterministic " +
      "craft lint (first sentence ≤7s, banned filler openers, concrete anchor, <15-word sentences), then a " +
      "judge gates punch/specificity/curiosity/voiceMatch ≥7 with one feedback retry — loud failure, never " +
      "a could-open-any-video line. The latest Gemini Pro then writes the narration continuing from it " +
      "under CRAFT_RULES (one idea per 60-90s, midpoint re-hook), in the Show Bible's register.",
    gates: ["hook lint (≤7s, no filler, concrete)", "punch ≥ 7", "specificity ≥ 7", "curiosity ≥ 7", "voiceMatch ≥ 7", "qa_script"],
    status: "active",
  },
  {
    key: "guard",
    stage: "guard",
    title: "Guard Gates",
    engine: "qa_script + originality_gate + compliance_check",
    how:
      "Three gates between script and spend: craft QA against the rules, an originality pass so the channel " +
      "never re-treads itself or competitors, and a compliance floor before any paid generation starts.",
    gates: ["craft", "originality", "compliance"],
    status: "active",
  },
  {
    key: "narration",
    stage: "voice",
    title: "Narration",
    engine: "Tiered TTS per niche (Fish w/ prosody control)",
    how:
      "Voice is the #1 retention factor: per-niche voice mapping, prosody/speed control, and word-level " +
      "timing that the caption and assembly stages consume downstream. No silent fallback voice — a dead " +
      "provider fails loud.",
    gates: ["duration sanity", "loud failure (no fallback voice)"],
    status: "active",
  },
  {
    key: "visuals",
    stage: "visual",
    title: "Visuals",
    engine: "Family-swapped: stock footage / entity imagery / flux keyframes / boomerang loops",
    how:
      "The family delta picks the visual engine per channel: curated stock + entity imagery for narrated " +
      "essays, generated keyframes + image-to-video for cinematic families, seamless boomerang loops + " +
      "Topaz upscale for lofi. Style DNA grounds every query and prompt.",
    gates: ["per-artifact qa_visual", "coverage contract vs cut sheet"],
    status: "active",
  },
  {
    key: "inserts",
    stage: "layer",
    title: "Data-Viz Inserts",
    engine: "Remotion motion graphics (visual_inserts)",
    how:
      "Script-synced data visualizations — big stats, line charts, bar comparisons — selected per niche and " +
      "rendered in Remotion, timed to the narration. The integrity gate only visualizes numbers the " +
      "narration actually speaks, verbatim.",
    gates: ["verbatim-number integrity"],
    status: "active",
  },
  {
    key: "layer",
    stage: "layer",
    title: "Captions + Overlays",
    engine: "Word-level captions, quote overlays, intro card (Remotion)",
    how:
      "Word-timed captions, quote overlays and the intro card are composited over the edit, styled by the " +
      "channel's DNA typography so every layer stays on brand.",
    gates: ["timing sync vs narration"],
    status: "active",
  },
  {
    key: "assemble",
    stage: "build",
    title: "Assembly",
    engine: "Remotion timeline + ffmpeg master",
    how:
      "The cut sheet drives assembly: per-section footage, inserts and captions on one timeline over the " +
      "mastered audio mix, then a hard length gate against the niche target and a black-segment guard.",
    gates: ["length_check", "black-segment guard"],
    status: "active",
  },
  {
    key: "metadata",
    stage: "package",
    title: "SEO Metadata",
    engine: "Niche-databank title/description/tag generator",
    how:
      "Keyword-first titles built on curiosity-gap formulas (numbers, brackets, pronouns), descriptions " +
      "with the keyword in the first 25 words, tags drawn from the niche's scraped databank.",
    gates: ["banned words", "length limits"],
    status: "active",
  },
  {
    key: "verify",
    stage: "verify",
    title: "Verify + Heal",
    engine: "Per-artifact qa_visual + critic ValidationSpec + self-heal loop",
    how:
      "Every artifact is vision-checked — the thumbnail at real 168px browse size against scraped top " +
      "competitors — and the critic's ValidationSpec is enforced. Failures route back through the heal " +
      "loop with defect hints instead of shipping degraded output.",
    gates: ["ValidationSpec", "mobile-size legibility", "reference comparison"],
    status: "active",
  },
  {
    key: "ship",
    stage: "ship",
    title: "Ship",
    engine: "YouTube upload (PRIVATE-first) + Ayrshare crosspost + Telegram",
    how:
      "Uploads land PRIVATE on paused channels — autopilot only goes public when the operator flips Active. " +
      "Bundles emit for multilang reuse, crossposting is one API key away, and Telegram carries budget " +
      "alerts and completion notifications.",
    gates: ["PRIVATE-first safety", "budget alert"],
    status: "active",
  },
];

/**
 * Per-niche defaults â€” the smart starting point each niche gets before per-channel
 * overrides. Keep light; the designer + concept synth fill the rest.
 */
export interface NichePreset {
  /** Default target spoken length (seconds) for a standard upload. */
  targetSeconds: number;
  /** Script tone passed to scriptGen `style`. */
  scriptStyle: string;
  /**
   * Optional per-niche crew roster (overrides the family default FAMILY_CREW).
   * Role keys: director | cinematographer | editor | composer | critic.
   * Omit â†’ use the family's default crew. (family itself stays catalog-driven via
   * nicheCatalog.defaultFamily â€” not duplicated here.)
   */
  crew?: string[];
  /**
   * Optional per-niche thumbnail engine override. "banana" (the engine —
   * src/lib/banana.ts) is the default everywhere; "title_card" is the only
   * explicit operator alternative (deterministic ffmpeg card).
   */
  thumbnailer?: "banana" | "title_card";
  /** Optional per-niche footage theme (e.g. "nature" hard-locks serene b-roll). */
  footageTheme?: string;
  /**
   * Script-synced motion-graphics inserts this niche benefits from
   * (visual_inserts block): big_stat | line_chart | bar_compare. Omit â†’ none.
   * The Insert Director still only visualizes numbers the narration speaks.
   */
  insertTypes?: ("big_stat" | "line_chart" | "bar_compare" | "annotated_line" | "lower_third")[];
}

export const NICHE_PRESETS: Record<string, NichePreset> = {
  // lofi rides the real-scene thumbnail path (run keyframe + title overlay) —
  // any non-title_card engine unlocks it, so the banana default is right.
  lofi: { targetSeconds: 3600, scriptStyle: "meditation" },
  educational: { targetSeconds: 480, scriptStyle: "generic", insertTypes: ["big_stat", "bar_compare"] },
  finance: { targetSeconds: 600, scriptStyle: "generic", insertTypes: ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"] },
  technology: { targetSeconds: 420, scriptStyle: "generic", insertTypes: ["big_stat", "bar_compare"] },
  lifestyle: { targetSeconds: 360, scriptStyle: "generic" },
  food: { targetSeconds: 300, scriptStyle: "generic" },
  travel: { targetSeconds: 420, scriptStyle: "generic" },
  entertainment: { targetSeconds: 420, scriptStyle: "generic" },
  psychology: { targetSeconds: 600, scriptStyle: "generic" },
  crime: { targetSeconds: 720, scriptStyle: "crime", insertTypes: ["big_stat"] },
  history: { targetSeconds: 720, scriptStyle: "generic", insertTypes: ["big_stat", "annotated_line"] },
  motivation: { targetSeconds: 60, scriptStyle: "shorts" },
  // Stoicism previously had a voice mapping but no preset at all. The serene-
  // nature footage lock lives HERE now (per-niche), not on the narrated archetype.
  stoicism: { targetSeconds: 900, scriptStyle: "generic", footageTheme: "nature" },
  // 2026 breakout niches â€” drama leans on the crime style's tension/withhold-reveal.
  // Crew tailored per niche: drama wants narrative+visuals+pacing (no music director);
  // explainers run a lean director+editor+critic crew (cheaper, focused).
  stories: { targetSeconds: 720, scriptStyle: "crime", crew: ["director", "cinematographer", "editor", "critic"], insertTypes: ["big_stat"] },
  health: { targetSeconds: 480, scriptStyle: "generic", crew: ["director", "editor", "critic"], insertTypes: ["big_stat", "bar_compare"] },
  business: { targetSeconds: 420, scriptStyle: "generic", crew: ["director", "editor", "critic"], insertTypes: ["big_stat", "line_chart", "bar_compare", "lower_third"] },
};

export function nichePreset(key?: string): NichePreset | undefined {
  return key ? NICHE_PRESETS[key] : undefined;
}
