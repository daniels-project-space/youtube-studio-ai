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

/** Hook-specific guidance for the dedicated hook/opening generation step. */
export const HOOK_RULES =
  "Write a scroll-stopping HOOK that lands in the first ~7 seconds: open a curiosity gap, " +
  "make a bold or contrarian claim, or address the viewer directly with \"you\". No preamble, " +
  "no \"in this video\", no restating the title â€” drop the viewer straight into tension or intrigue.";

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
  { stage: "package", blocks: ["thumbnail_gen", "metadata"], note: "SEO + thumbnail (N-variant + CTR pick when enabled)." },
  { stage: "verify", blocks: ["qa_visual", "qa_refine"], note: "Critic ValidationSpec â†’ refine loop." },
  { stage: "ship", blocks: ["upload_draft", "emit_bundle", "crosspost", "notify"], note: "PRIVATE-first upload + multilang reuse + multi-platform + shorts." },
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
  /** Optional per-niche thumbnail engine override (else the family default). */
  thumbnailer?: "claude_flux" | "ideogram" | "title_card";
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
  // claude_flux on lofi unlocks the real-scene thumbnail path (run keyframe + title).
  lofi: { targetSeconds: 3600, scriptStyle: "meditation", thumbnailer: "claude_flux" },
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
  stories: { targetSeconds: 720, scriptStyle: "crime", crew: ["director", "cinematographer", "editor", "critic"], thumbnailer: "claude_flux", insertTypes: ["big_stat"] },
  health: { targetSeconds: 480, scriptStyle: "generic", crew: ["director", "editor", "critic"], thumbnailer: "claude_flux", insertTypes: ["big_stat", "bar_compare"] },
  business: { targetSeconds: 420, scriptStyle: "generic", crew: ["director", "editor", "critic"], thumbnailer: "claude_flux", insertTypes: ["big_stat", "line_chart", "bar_compare", "lower_third"] },
};

export function nichePreset(key?: string): NichePreset | undefined {
  return key ? NICHE_PRESETS[key] : undefined;
}
