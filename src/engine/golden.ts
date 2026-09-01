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

import { CHANNEL_INCEPTION_CATALOG_MODULES } from "./channelInceptionContracts";

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
 * GOLDEN_SPINE â€” the catalog of executable stages available to a channel.
 * A channel does not inherit every block in this list: the production compiler
 * maps only its selected executable entries to their editorial catalog owners.
 * This is the all-family overview used by the UI; `compileCatalogExecutionFlow`
 * is the authoritative per-channel path. Golden qualification is a separate,
 * proof-gated decision.
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
  { stage: "intel", blocks: ["competitor_research", "topic_select", "serialized_program_episode_context", "quiz_topic_plan"], note: "Pick topics from real outliers + competitor signal, learning-weighted; an admitted serialized route seals Topic Select's atomic completion into one bounded, route/run/topic-bound continuity receipt before any downstream consumer can run; QuizYear alternatively rotates a curated CC0 Wikidata topic registry with a durable provenance receipt." },
  { stage: "brief", blocks: ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec", "curriculum_episode_seed", "story_spine", "episode_graph", "narrative_series_visual_controls", "self_contained_story_plan", "self_contained_story", "learning_contract", "children_show_bible", "casefile_source_packet", "casefile_evidence_shot_map", "source_bound_story_spine", "editorial_evidence_packet", "cinematic_case_sequence_draft", "cinematic_case_sequence_finalize", "cinematic_case_sequence", "synthetic_scenario", "scenario_visual_treatment", "short_strategy"], note: "Show Bible crew and timed story spine; curriculum_episode_seed locks a child-editor-approved age band, one objective, vocabulary/actions, assessment, and original recurring world/characters before Story Spine planning, and emits only a private review receipt; episode_graph locks causal beat-to-scene continuity before render; narrative_series_visual_controls can bind a sealed Series Plan, Episode Graph/Story Spine, and already-accepted character adapters into provider-free shot controls for a future exact serialized route—it neither trains, renders, admits, nor publishes; self_contained_story_plan uses a bounded, critic-approved native storyboard before self_contained_story seals it to its route, topic, and matching renderer; learning_contract turns an approved objective into source-linked demonstrations and retrieval practice; children_show_bible binds that earlier intent into its graph-and-lesson proof; casefile_source_packet admits only an operator-supplied, primary-source- and rights-bound Case Packet with fresh Case Packet and source-use-ledger-bound editorial approval, and can emit only a private human-review draft; casefile_evidence_shot_map additionally binds every factual claim to reviewed current Scene Manifest / ShotPlan targets under an explicit no-gore/no-unsupported-recreation policy; source_bound_story_spine carries those exact reviewed claim/source/citation/treatment bindings into every timed Story Spine shot without generating facts or admitting a family; editorial_evidence_packet provides the smaller shared source/claim/snapshot core for supervised factual explainers while Casefile keeps its separate rights and reconstruction rails; cinematic_case_sequence_draft converts that evidence into source-bound, faceless mannequin multi-shot coverage; cinematic_case_sequence_finalize accepts only a real editor’s matching signature before strict cinematic admission and Novita generation; synthetic_scenario locks an explicitly fictional, assumption-led scenario before writing; scenario_visual_treatment immediately seals the route-derived non-real visual policy before script or visual work; collage Shorts lock claim/source/beat/motion evidence before render." },
  { stage: "write", blocks: ["script_gen", "hook_craft"], note: "Hook-first, CRAFT_RULES applied." },
  { stage: "guard", blocks: ["qa_script", "originality_gate", "compliance_check", "quiz_topic_safety", "quiz_critic_spec", "scenario_disclosure_gate"], note: "Quality + originality + compliance floor; QuizYear contributes deterministic topic-safety and game-format critic receipts; synthetic scenarios must disclose their illustrative assumptions before narration." },
  { stage: "voice", blocks: ["narration_tts"], note: "Voice = #1 retention factor; tiered provider per niche." },
  { stage: "sound", blocks: ["music_program_plan", "music"], note: "A route-sealed original-music program locks one episode’s instrumental and loop-visual intent before the channel-scoped score or long-form music product is generated." },
  { stage: "visual", blocks: ["scene_planner", "keyframes", "loop_clips", "upscale", "stock_footage", "entity_imagery", "gen_footage", "signature_clips", "studio_asset_resolve", "visual_matter", "visual_matter_references", "novita_render_images", "studio_ltx_adapter_resolve", "novita_render_video", "scene_compiler", "whiteboard_scribe", "motion_comic", "lore_short", "quiz_year", "documotion_short", "shorts_spinoff", "documentary_short_candidates"], note: "The family selects only the visual engine and QA chain it needs. Cinematic first resolves only its owner-scoped, approved Studio camera/motion/prompt recipes, then plans any genuinely new Visual Matter. After accepted keyframe QA it may select one approved, runtime-pinned standard LTX LoRA; the direct worker independently verifies the exact model-manifest digest before spend. It never exposes raw LoRA weights or IC-LoRA guides to generic prompting, and IC-LoRAs stay gated to their future dedicated Comfy control worker. Cinematic can optionally add a bounded, direct-Novita text-to-image Visual Matter QA-reference pack after its mood/cast/setting/storyboard plan. The pack is not primary-keyframe image conditioning. The deterministic Scene Compiler turns a reviewed scene manifest into a local 16:9 master, and documentary Shorts render natively at 9:16. shorts_spinoff/documentary_short_candidates (P2-9) are the shorts catalog module's planning-only Short-window selection — they execute late in the real timeline but are owned here per CATALOG_EXECUTION_BINDINGS.shorts, not by ship." },
  { stage: "layer", blocks: ["studio_postproduction_asset_resolve", "captions", "quote_overlays", "intro_card", "visual_inserts"], note: "Conditional word-level captions, overlays and data-viz. The Studio resolver can reuse only approved, module-specific audio direction, quote-card grammar, motion-graphics treatment, and a closed title-to-body transition choice; it cannot override story, sources, timing, cuts, or accessibility." },
  { stage: "build", blocks: ["timeline_assemble", "assemble"], note: "Narrated EDL or loop assembly, never both. Narrated assembly accepts only the Studio's closed hard-cut, crossfade, or dip-to-black title transition and each path has real render-parity coverage. NOTE (P2-10): this spine block id \"assemble\" is lofi's loop-assembly step — it has no dedicated GOLDEN_MODULES row and is folded into the `lofi` catalog entry's executableIds (see goldenExecution.ts CATALOG_EXECUTION_BINDINGS.lofi). Do not confuse it with the unrelated catalog key `assemble` below (also stage \"build\"), which documents the separate build-stage EDL/Timeline engine used by narrated content." },
  { stage: "package", blocks: ["package_to_opening_plan", "thumbnail_gen", "metadata", "quiz_metadata"], note: "SEO metadata plus a required thumbnail description first seal a package-to-opening plan, then flow into one universal Nano Banana scene route with deterministic Style-DNA typography and one publishing gate. Production QA rebinds the plan to exact cover bytes, a retained reviewed opening frame, and the final master; that is structural evidence, not a fabricated semantic-equality claim. QuizYear retains a source-grounded metadata package while every channel shares the same final thumbnail provider." },
  { stage: "verify", blocks: ["qa_assets", "qa_shots", "short_scene_qa", "length_check", "qa_visual", "child_content_safety"], note: "Required asset/shot checks, portrait scene-safe-area proof, deterministic final quality gate, and an additional children-learning human-review admission gate where applicable." },
  { stage: "ship", blocks: ["quiz_short_release", "upload_draft", "emit_bundle", "crosspost", "notify", "cleanup"], note: "PRIVATE-first upload + multilang reuse + optional distribution + scoped cleanup. quiz_short_release is a post-QA, certificate-only QuizYear handoff that binds certified fact/source and opening evidence to final visual/audio QA, then permits only a private human-review draft; it is not an automatic channel-admission or publishing path. NOTE (P2-9): planning-only Short window selection (shorts_spinoff / documentary_short_candidates) is NOT owned by ship — goldenExecution.ts's CATALOG_EXECUTION_BINDINGS assigns those two executables to the `shorts` catalog module (stage: visual); they were moved to the visual stage row to match." },
];

/**
 * VOICE_DOCTRINES — per-niche voice ARCHETYPES: how a channel of this kind
 * should SOUND, beyond what it says. A history channel narrates like a
 * storyteller but teaches like a great teacher; a finance channel is a calm
 * teacher-advisor; a social-chaos channel fires the loudest verified fact
 * first. Consumed by hookcraft (cold-open device + register) and scriptGen
 * (whole-narration tone). The channel's own Style-DNA narrative register
 * still OUTRANKS this — the doctrine is the archetype baseline beneath it.
 */
export interface VoiceDoctrine {
  /** Archetype label, e.g. "narrator-teacher". */
  voice: string;
  /** How the narration should sound — fed to every script prompt. */
  tone: string;
  /** Cold-open doctrine — fed to hookcraft's device selection. */
  hookStyle: string;
}

/** Ordered matchers — earlier entries win (e.g. "sleep" → guide, not health). */
const DOCTRINE_MATCHERS: { keywords: string[]; doctrine: VoiceDoctrine }[] = [
  {
    keywords: ["meditation", "sleep", "ambient", "lofi", "calm", "relax"],
    doctrine: {
      voice: "gentle-guide",
      tone:
        "A soft, unhurried guide speaking to one person: long gentle sentences, second person, generous " +
        "pauses, zero urgency — the voice itself is the product.",
      hookStyle: "No shock devices; a quiet you-stakes or serene scene invitation; the promise is the feeling.",
    },
  },
  {
    keywords: ["scandal", "celebrity", "gossip", "drama", "meltdown", "social media", "internet", "chaos", "commentary"],
    doctrine: {
      voice: "chaos-commentator",
      tone:
        "Outrageous but receipts-true: short jabbing sentences, incredulous energy, says the quiet part out " +
        "loud — yet every claim stays sourced and verifiable; punch at the machine and the powerful, never " +
        "at victims; irony allowed, invention never.",
      hookStyle:
        "Fire the single LOUDEST verified fact in the first sentence — no warmup, no context first. " +
        "Receipt and shock devices, fast pace, biggest number or most absurd detail up front.",
    },
  },
  {
    keywords: ["crime", "mystery", "investigation", "conspiracy", "fraud", "exposé", "expose"],
    doctrine: {
      voice: "investigator",
      tone:
        "Controlled tension and procedural precision: facts land like evidence exhibits, withhold-then-reveal, " +
        "no editorializing the conclusion before the proof has been laid out.",
      hookStyle: "Open on the most damning piece of evidence or the moment before discovery; let it sit cold.",
    },
  },
  {
    keywords: ["history", "war", "empire", "ancient", "samurai", "medieval", "civilization", "dynasty"],
    doctrine: {
      voice: "narrator-teacher",
      tone:
        "A master storyteller who is also a great teacher: cinematic narration that keeps making the viewer " +
        "SMARTER — explain WHY it mattered, connect cause to effect, define period terms in plain words the " +
        "moment they appear, anchor scale with comparisons a modern viewer feels. The viewer should finish " +
        "able to RETELL what happened and why.",
      hookStyle:
        "Open cinematic (scene, flash-forward, countdown) but plant a teacherly promise: what the viewer " +
        "will UNDERSTAND by the end, not just witness.",
    },
  },
  {
    keywords: ["finance", "money", "invest", "economy", "market", "wealth", "tax", "real estate"],
    doctrine: {
      voice: "teacher-advisor",
      tone:
        "A calm, credible teacher of money: every number spoken precisely and immediately translated into " +
        "consequences-for-you terms; no hype, no urgency theater, no get-rich promises; build the viewer's " +
        "competence step by step like a great lecturer with skin in the game.",
      hookStyle:
        "Real numbers up front (receipt, result-first, wrong-way), then a clear learning promise: the " +
        "MECHANISM the viewer will understand by the end.",
    },
  },
  {
    keywords: ["ai risk", "ai takeover", "speculative", "sci-fi", "future", "singularity"],
    doctrine: {
      voice: "calm-analyst",
      tone:
        "Clinical, measured, unsettling precisely BECAUSE it is calm: real sourced events and data first, " +
        "speculation clearly framed as extrapolation, never breathless.",
      hookStyle: "A real, verifiable event stated flat — the dread comes from how ordinary it sounds.",
    },
  },
  {
    keywords: ["technology", "tech", "software", "gadget", "ai tools", "automation"],
    doctrine: {
      voice: "insider-explainer",
      tone:
        "A senior engineer who loves teaching: sharp, current, demystifying — explains how it ACTUALLY works " +
        "under the hood, kills hype with mechanism, concrete examples before abstractions.",
      hookStyle: "Proof-based: a concrete result, benchmark, or failure up front, then the how-it-works promise.",
    },
  },
  {
    keywords: ["health", "fitness", "nutrition", "medical", "glp", "longevity"],
    doctrine: {
      voice: "trusted-explainer",
      tone:
        "Warm clinical credibility: precise about studies, doses and numbers, zero fear-mongering, always " +
        "lands on what the viewer can actually DO; uncertainty stated honestly.",
      hookStyle: "Problem-agitation or wrong-way on a real, common mistake; the promise is actionable clarity.",
    },
  },
  {
    keywords: ["film", "movie", "cinema", "reel", "tv", "series", "show"],
    doctrine: {
      voice: "enthusiast-critic",
      tone:
        "A film-literate fan with verdicts: affection plus craft detail (the cut, the budget, the casting " +
        "fight), conversational and sharp, never a plot summary machine.",
      hookStyle: "A production receipt or behind-the-scenes moment that reframes the thing everyone has seen.",
    },
  },
  {
    keywords: ["business", "startup", "entrepreneur", "ecommerce", "marketing"],
    doctrine: {
      voice: "operator-mentor",
      tone:
        "Practical and case-driven, like someone who has run things: numbers + decisions + what it cost, " +
        "frameworks only AFTER the concrete story has earned them.",
      hookStyle: "Result-first or wrong-way with a real company and real figures; promise the decision lesson.",
    },
  },
  {
    keywords: ["stoic", "philosophy", "wisdom", "mindset"],
    doctrine: {
      voice: "quiet-mentor",
      tone:
        "Calm, intimate, unhurried authority speaking to ONE person: modern stakes first, ancient sources as " +
        "proof not decoration, never preachy, the power is in restraint.",
      hookStyle: "You-stakes on a modern moment, or a source's own startling words; quiet confidence, no shouting.",
    },
  },
  {
    keywords: ["motivation", "discipline", "success", "self improvement"],
    doctrine: {
      voice: "igniter",
      tone:
        "Direct, rhythmic, second-person: short driving sentences, concrete challenges over platitudes, " +
        "respect the viewer's intelligence while raising their pulse.",
      hookStyle: "You-stakes or wrong-way, present tense, the cost of staying the same made concrete.",
    },
  },
  {
    keywords: ["education", "explained", "learning", "facts", "science"],
    doctrine: {
      voice: "teacher",
      tone:
        "Clear, structured, visibly delighted by the subject: one idea at a time, a concrete example before " +
        "every abstraction, recap the aha moments as they land.",
      hookStyle: "Question-on-the-viewer's-actual-confusion or result-first demo; promise the understanding.",
    },
  },
  {
    keywords: ["story", "stories", "storytelling", "narrative"],
    doctrine: {
      voice: "dramatist",
      tone:
        "Pure narrative command: scene, character, tension, reveal — emotion carried by concrete detail, " +
        "never adjectives; the storyteller trusts the story.",
      hookStyle: "Cold-open scene or flash-forward at the most charged moment; no framing, just the world.",
    },
  },
];

/** Resolve the voice archetype for a niche string (fuzzy keyword match). */
export function resolveVoiceDoctrine(niche?: string): VoiceDoctrine | undefined {
  if (!niche) return undefined;
  const n = niche.toLowerCase();
  return DOCTRINE_MATCHERS.find((m) => m.keywords.some((k) => n.includes(k)))?.doctrine;
}

/**
 * ElevenLabs v3 audio-tag palettes per voice archetype — official v3 guidance:
 * tags must match what the voice can CREDIBLY perform (a meditative voice
 * won't convincingly shout; a professional voice shouldn't [giggle]). The
 * script writer may only use the archetype's palette on v3-voiced channels.
 */
export const V3_TAG_PALETTES: Record<string, string> = {
  "gentle-guide": "[whispers] [softly] [long pause] [pause] [inhales deeply] [exhales] [sighs]",
  "chaos-commentator": "[laughs] [chuckles] [sarcastic] [appalled] [surprised] [exhales] [pause]",
  investigator: "[pause] [long pause] [seriously] [slowly] [exhales]",
  "narrator-teacher": "[pause] [long pause] [thoughtful] [curious] [emphatic] [slowly]",
  "teacher-advisor": "[pause] [seriously] [thoughtful] [emphatic]",
  "calm-analyst": "[pause] [long pause] [seriously] [slowly] [exhales]",
  "insider-explainer": "[curious] [excited] [chuckles] [pause] [emphatic]",
  "trusted-explainer": "[softly] [seriously] [pause] [thoughtful] [exhales]",
  "enthusiast-critic": "[chuckles] [laughs] [excited] [curious] [sarcastic] [pause]",
  "operator-mentor": "[pause] [seriously] [chuckles] [emphatic] [thoughtful]",
  "quiet-mentor": "[pause] [long pause] [softly] [sighs] [thoughtful] [slowly]",
  igniter: "[emphatic] [pause] [exhales] [seriously]",
  teacher: "[curious] [excited] [pause] [emphatic] [chuckles] [thoughtful]",
  dramatist: "[pause] [long pause] [whispers] [sighs] [seriously] [surprised]",
};

/**
 * NARRATION PHYSICS — per-archetype delivery doctrine: what the voice must BE
 * (casting spec) and how it must MOVE (speed / stability / style / tag
 * density / sentence air). The operator's voice law (2026-06-13): stoic =
 * deep dark male, slow; finance = energetic-or-smooth male, faster; social
 * chaos = younger female, fast; meditation/gratitude = calm controlled
 * professional mature female, slow — extended to every archetype.
 *
 * Knobs (verified live on eleven_v3 2026-06-13): voice_settings.speed
 * 0.7-1.2 WORKS on v3 (also maps to Fish prosody.speed); stability is
 * DISCRETE on v3 (0.0 creative / 0.5 natural / 1.0 robust); style accepted.
 * Consumed by voicecraft (casting + render) and narration_tts (defaults).
 */
export interface NarrationPhysics {
  /** Casting spec — matched against profiled voice cards, judged on real audio. */
  cast: {
    gender: "male" | "female" | "any";
    age: "young" | "middle_aged" | "old" | "any";
    /** Required accent family (vendor-label match), e.g. "american" — a labeled mismatch disqualifies at prefilter. */
    accent?: string;
    /** The REQUIRED sound, judge-facing. */
    character: string;
  };
  /** Speaking-rate multiplier (eleven voice_settings.speed AND Fish prosody.speed). */
  speed: number;
  /** v3 stability: 0.0 creative | 0.5 natural | 1.0 robust. */
  stability: 0 | 0.5 | 1;
  /** Style exaggeration 0..1 — keep low; raises instability and latency. */
  style?: number;
  /** How densely the writer may deploy the archetype's V3 tag palette. */
  tagDensity: "none" | "sparse" | "moderate" | "rich";
  /** Default silence between sentences (sec) — the archetype's air. */
  sentenceGap: number;
}

export const NARRATION_PHYSICS: Record<string, NarrationPhysics> = {
  "quiet-mentor": {
    cast: { gender: "male", age: "middle_aged", accent: "american", character: "VERY deep, dark, low-register male — the deepest credible voice available; unhurried gravel, intimate quiet authority. NEUTRAL AMERICAN accent ONLY: a British or any regional accent DISQUALIFIES regardless of quality. Never bright, never hurried" },
    speed: 0.95, stability: 1, tagDensity: "sparse", sentenceGap: 0.9,
  },
  "teacher-advisor": {
    cast: { gender: "male", age: "middle_aged", character: "confident male money-teacher: either crisp energetic tenor or smooth low-key trust — clear diction, zero hype-shout" },
    speed: 1.1, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.35,
  },
  "chaos-commentator": {
    cast: { gender: "female", age: "young", character: "younger female, bright and quick, sassy receipts-energy; incredulous but articulate" },
    speed: 1.15, stability: 0.5, style: 0.3, tagDensity: "rich", sentenceGap: 0.22,
  },
  "gentle-guide": {
    cast: { gender: "female", age: "middle_aged", character: "calm, controlled, professional mature female; warm low register, slow even breath — the voice IS the product" },
    speed: 0.85, stability: 1, tagDensity: "moderate", sentenceGap: 1.25,
  },
  "narrator-teacher": {
    cast: { gender: "male", age: "middle_aged", character: "warm storyteller baritone with teacherly clarity; cinematic but never breathless" },
    speed: 1.0, stability: 0.5, tagDensity: "moderate", sentenceGap: 0.55,
  },
  investigator: {
    cast: { gender: "male", age: "middle_aged", character: "low, controlled, deliberate; evidence-exhibit calm with an unsettling edge" },
    speed: 0.97, stability: 1, tagDensity: "sparse", sentenceGap: 0.7,
  },
  "calm-analyst": {
    cast: { gender: "any", age: "middle_aged", character: "neutral, clinical, measured; unsettling precisely because it stays flat" },
    speed: 1.0, stability: 1, tagDensity: "sparse", sentenceGap: 0.6,
  },
  "insider-explainer": {
    cast: { gender: "any", age: "young", character: "bright, current, engaged senior-engineer energy; demystifies at speed without gabbling" },
    speed: 1.1, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.3,
  },
  "trusted-explainer": {
    cast: { gender: "any", age: "middle_aged", character: "warm clinical credibility; precise, kind, zero fear-mongering" },
    speed: 1.05, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.45,
  },
  "enthusiast-critic": {
    cast: { gender: "male", age: "middle_aged", character: "film-literate fan with verdicts: lively, conversational, affectionately sharp" },
    speed: 1.1, stability: 0.5, style: 0.25, tagDensity: "moderate", sentenceGap: 0.35,
  },
  "operator-mentor": {
    cast: { gender: "male", age: "middle_aged", character: "confident operator who has run things: direct, case-driven, numbers land like decisions" },
    speed: 1.08, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.4,
  },
  igniter: {
    cast: { gender: "male", age: "middle_aged", character: "driving, rhythmic second-person push; raises the pulse without shouting" },
    speed: 1.1, stability: 0.5, style: 0.3, tagDensity: "moderate", sentenceGap: 0.3,
  },
  teacher: {
    cast: { gender: "any", age: "middle_aged", character: "clear, friendly, visibly delighted by the subject; one idea at a time" },
    speed: 1.05, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.45,
  },
  dramatist: {
    cast: { gender: "any", age: "middle_aged", character: "rich expressive narrative command: scene, tension, reveal — emotion in concrete detail" },
    speed: 1.0, stability: 0.5, style: 0.35, tagDensity: "moderate", sentenceGap: 0.6,
  },
};

/** Default physics when no archetype resolves — measured documentary neutral. */
export const DEFAULT_NARRATION_PHYSICS: NarrationPhysics = {
  cast: { gender: "any", age: "middle_aged", character: "warm, clear, documentary-grade narrator" },
  speed: 1.05, stability: 0.5, tagDensity: "sparse", sentenceGap: 0.55,
};

/** Resolve the narration physics for a niche (via its voice archetype). */
export function narrationPhysicsFor(niche?: string): NarrationPhysics & { archetype: string } {
  const doctrine = resolveVoiceDoctrine(niche);
  const key = doctrine?.voice ?? "";
  const phys = NARRATION_PHYSICS[key];
  return phys ? { ...phys, archetype: key } : { ...DEFAULT_NARRATION_PHYSICS, archetype: key || "default" };
}

/**
 * FOOTAGE DOCTRINE — what each kind of channel NEEDS from its b-roll beyond the
 * subject: MOTION character and camera energy. A calm stoic/meditation channel
 * needs slow, steady, locked-off or gently-drifting shots — NOT shaky handheld
 * or fast drone/aerial sweeps (which 4K stock is heavily skewed toward, since
 * that's what gets shot in 4K). A chaos/hype channel wants the opposite. Used
 * by footagecraft to (a) bias the search queries and (b) gate each clip on a
 * deterministic motion score, so footage matches the channel's pace, not just
 * its topic. `maxMotion` is the ceiling on the avg low-res inter-frame luma
 * difference (ffmpeg tblend-difference YAVG): calm ≈ low, dynamic ≈ high.
 */
export interface FootageDoctrine {
  /** Desired energy: calm (slow/static) | moderate (cinematic-steady) | dynamic (fast/energetic). */
  motion: "calm" | "moderate" | "dynamic";
  /** Motion-score ceiling (avg inter-frame luma diff). Clips above it are rejected. */
  maxMotion: number;
  /** Terms to weave into queries (the desired look/movement). */
  prefer: string[];
  /** Terms to keep OUT of queries AND scenes the gate rejects (wrong energy). */
  avoid: string[];
}

const CALM_AVOID = ["drone", "aerial", "fast", "timelapse", "hyperlapse", "fast-paced", "whip pan", "action", "racing", "shaky", "handheld chase", "frenetic", "speeding"];
const CALM_PREFER = ["slow motion", "static shot", "locked off", "gentle drift", "still", "calm", "slow", "tranquil"];

export const FOOTAGE_DOCTRINE: Record<string, FootageDoctrine> = {
  "quiet-mentor":   { motion: "calm",     maxMotion: 6.0,  prefer: CALM_PREFER,                                         avoid: CALM_AVOID },
  "gentle-guide":   { motion: "calm",     maxMotion: 5.0,  prefer: ["very slow", "still water", "gentle drift", "soft light", "locked off", "slow motion"], avoid: CALM_AVOID },
  "narrator-teacher":{ motion: "moderate", maxMotion: 9.0,  prefer: ["cinematic", "slow push in", "sweeping but steady", "epic landscape"], avoid: ["shaky", "whip pan", "frenetic", "fast cut"] },
  "investigator":   { motion: "calm",     maxMotion: 6.5,  prefer: ["slow", "static", "moody", "locked off", "dim"],    avoid: CALM_AVOID },
  "calm-analyst":   { motion: "calm",     maxMotion: 6.5,  prefer: ["slow", "clinical", "steady", "static"],            avoid: CALM_AVOID },
  "teacher-advisor":{ motion: "moderate", maxMotion: 9.5,  prefer: ["clean", "steady", "modern", "bright but calm"],    avoid: ["shaky", "frenetic", "whip pan"] },
  "trusted-explainer":{ motion: "moderate", maxMotion: 9.0, prefer: ["clean", "steady", "clinical", "calm"],            avoid: ["shaky", "frenetic"] },
  "insider-explainer":{ motion: "moderate", maxMotion: 11.0, prefer: ["modern", "sharp", "dynamic but steady", "tech"], avoid: ["shaky"] },
  "enthusiast-critic":{ motion: "moderate", maxMotion: 11.0, prefer: ["cinematic", "lively", "stylish"],               avoid: ["shaky", "amateur"] },
  "operator-mentor":{ motion: "moderate", maxMotion: 10.0, prefer: ["clean", "professional", "steady"],                avoid: ["shaky"] },
  "chaos-commentator":{ motion: "dynamic", maxMotion: 99.0, prefer: ["fast", "energetic", "punchy", "dynamic"],        avoid: [] },
  "igniter":        { motion: "dynamic",  maxMotion: 99.0, prefer: ["intense", "fast", "powerful", "dynamic"],         avoid: [] },
  "dramatist":      { motion: "moderate", maxMotion: 10.0, prefer: ["cinematic", "dramatic", "atmospheric"],           avoid: ["shaky amateur"] },
  "teacher":        { motion: "moderate", maxMotion: 9.5,  prefer: ["clear", "clean", "steady", "bright"],             avoid: ["shaky"] },
};

/** Measured-neutral default when no archetype resolves. */
export const DEFAULT_FOOTAGE_DOCTRINE: FootageDoctrine = {
  motion: "moderate", maxMotion: 10.0, prefer: ["cinematic", "steady"], avoid: ["shaky", "frenetic"],
};

/** Resolve the footage doctrine for a niche (via its voice archetype). */
export function footageDoctrineFor(niche?: string): FootageDoctrine & { archetype: string } {
  const key = resolveVoiceDoctrine(niche)?.voice ?? "";
  const d = FOOTAGE_DOCTRINE[key];
  return d ? { ...d, archetype: key } : { ...DEFAULT_FOOTAGE_DOCTRINE, archetype: key || "default" };
}

/**
 * CINEMATIC DOCTRINE — how a GENERATED-cinematic channel (cinecraft) should
 * LOOK and move: the visual style/medium, the grade, the camera grammar, and
 * the edit pace. Lets the character-video engine adapt across the full range of
 * channels (gritty true-crime vs epic history vs stylized fantasy vs clean
 * explainer) instead of assuming photoreal period-drama. Resolved per niche via
 * the voice archetype; the brief can override any field.
 */
export interface CinematicDoctrine {
  /** Visual medium/style, e.g. "photoreal cinematic", "2D anime", "3D animated", "graphic-novel ink". */
  style: string;
  /** Grade / lighting / atmosphere. */
  look: string;
  /** Camera-language tendencies (movement + framing the director favors). */
  cameraGrammar: string;
  /** Shot/edit energy. */
  pace: "slow" | "measured" | "dynamic";
}

export const CINEMATIC_DOCTRINE: Record<string, CinematicDoctrine> = {
  investigator:        { style: "photoreal cinematic", look: "dark gritty high-contrast noir, cold desaturated, deep shadow", cameraGrammar: "slow push-ins, locked-off tension, evidentiary close-ups", pace: "slow" },
  "chaos-commentator": { style: "photoreal cinematic with bold graphic overlays", look: "punchy saturated, harsh flash, tabloid energy", cameraGrammar: "fast whip-pans, snap zooms, handheld", pace: "dynamic" },
  "narrator-teacher":  { style: "photoreal cinematic", look: "epic warm tungsten, painterly volumetric light, period-accurate", cameraGrammar: "sweeping crane + slow dolly, wide establishing then push-in", pace: "measured" },
  "calm-analyst":      { style: "photoreal cinematic, restrained", look: "clean cold clinical, controlled contrast", cameraGrammar: "static + slow precise moves", pace: "slow" },
  "quiet-mentor":      { style: "photoreal cinematic, minimal", look: "moody chiaroscuro, candlelit warmth, sparse", cameraGrammar: "slow drift, intimate framing, stillness", pace: "slow" },
  "teacher-advisor":   { style: "clean photoreal or light 3D", look: "bright credible, modern, soft contrast", cameraGrammar: "steady dolly, clear medium shots, simple inserts", pace: "measured" },
  "trusted-explainer": { style: "clean photoreal or light 3D", look: "warm clinical, friendly, even light", cameraGrammar: "steady, clear, calm", pace: "measured" },
  "insider-explainer": { style: "sleek 3D / photoreal tech", look: "sharp modern, cool accent light, glassy", cameraGrammar: "smooth gimbal, parallax reveals, macro detail", pace: "dynamic" },
  "enthusiast-critic": { style: "photoreal cinematic", look: "stylish lively, rich contrast", cameraGrammar: "expressive moves, cut-on-action", pace: "dynamic" },
  "operator-mentor":   { style: "clean photoreal", look: "professional, confident, even", cameraGrammar: "steady, decisive framing", pace: "measured" },
  igniter:             { style: "photoreal cinematic, heightened", look: "intense, high-contrast, dramatic rim light", cameraGrammar: "driving push-ins, low angles, energy", pace: "dynamic" },
  dramatist:           { style: "photoreal or painterly cinematic", look: "atmospheric, emotional, rich shadow", cameraGrammar: "scene-led blocking, reveal-timed moves", pace: "measured" },
  teacher:             { style: "clean photoreal or 3D animated", look: "bright clear delighted, inviting", cameraGrammar: "clear medium shots, gentle moves, demonstrative inserts", pace: "measured" },
  "gentle-guide":      { style: "soft photoreal or painterly", look: "serene, warm, diffuse, dreamlike", cameraGrammar: "very slow drift, wide calm framing", pace: "slow" },
};

/** Measured photoreal default when no archetype resolves. */
export const DEFAULT_CINEMATIC_DOCTRINE: CinematicDoctrine = {
  style: "photoreal cinematic",
  look: "rich cinematic grade, motivated lighting, shallow depth of field",
  cameraGrammar: "wide establishing then a slow push-in, steady moves",
  pace: "measured",
};

/** Resolve the cinematic doctrine for a niche (via its voice archetype). */
export function cinematicDoctrineFor(niche?: string): CinematicDoctrine & { archetype: string } {
  const key = resolveVoiceDoctrine(niche)?.voice ?? "";
  const d = CINEMATIC_DOCTRINE[key];
  return d ? { ...d, archetype: key } : { ...DEFAULT_CINEMATIC_DOCTRINE, archetype: key || "default" };
}

/**
 * GOLDEN_MODULES — the golden template, module by module, as shown on the
 * studio's "Golden Pipeline" tab. One entry per module of the spine with the
 * honest story of HOW it works and which gates are intended to protect it.
 * `status: "reference"` is an editorial reference flag only: it means a proof
 * sample exists in this catalog. `status: "registered"` means the block exists
 * in the registry but has no owner-facing intake or admitted standalone route.
 * Neither label confers execution or production certification. Production promotion is fail-closed in
 * goldenExecution.ts and requires registered Golden-certified manifests plus a
 * machine-readable proof receipt covering every gate.
 * Order = display order: reference modules lead, then the spine in stage order.
 */
export type CatalogModuleStatus = "reference" | "registered" | "active";

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
  /**
   * EDITORIAL LABEL ONLY — this is NOT a runtime gate. `"reference"`,
   * `"registered"`, and `"active"` record a curator's judgment for this
   * catalog page; they have no bearing on whether the module actually executes
   * in production. `"registered"` is deliberately used for a registered block
   * with no owner-facing intake or admitted standalone route. The only
   * things that enforce anything at runtime are block registration
   * (registerAllBlocks -> runner.ts:208 block.run(ctx)) plus each block's own
   * fail-closed checks. Golden certification — the layer that WOULD give
   * `status` teeth (GOLDEN_PROMOTION_PROOFS, compileGoldenExecutionFlow,
   * selectGoldenProductionModules in goldenExecution.ts) — has zero production
   * call sites as of this audit (2026-08); see
   * docs/GOLDEN_MODULE_AUDIT_2026-08.md P2-11. Do not read `status: "active"`
   * as "verified running in prod" — read it as "editorially promoted on this
   * page."
   */
  status: CatalogModuleStatus;
}

export const GOLDEN_MODULES: GoldenModule[] = [
  // Channel setup is now modeled as family-aware mini-module contracts. They
  // remain reference-only until resumable executors and immutable proof
  // receipts exist; catalog presence must not be confused with qualification.
  ...CHANNEL_INCEPTION_CATALOG_MODULES,
  {
    key: "episode-graph",
    stage: "brief",
    title: "Episode Graph — Causal Scene Plan",
    engine: "Typed Story Spine bridge → provider-free Episode Graph + deterministic Scene Manifest",
    how:
      "Turns an approved timed story spine into a stable causal graph: every beat is timed, source-linked, attached to a " +
      "character and setting catalog, and given a visual purpose before any renderer runs. The module is deliberately a planner, " +
      "not a script or media generator. It emits a content-addressed Scene Manifest that downstream renderers must honor. " +
      "Implemented by src/engine/episodeGraph.ts and src/trigger/blocks/episodeGraphBlocks.ts.",
    gates: [
      "full narration-to-beat coverage",
      "causal edge between every adjacent beat",
      "canonical character and setting continuity",
      "source references on every factual beat",
      "children-learning graphs require curriculum evidence and an explicit resolution",
    ],
    status: "reference",
  },
  {
    key: "self-contained-story",
    stage: "brief",
    title: "Self-Contained Story — Sealed Renderer Handoff",
    engine:
      "Provider-free approved native plan → route, lane, program-brief, and topic-bound immutable renderer receipt",
    how:
      "The registered self_contained_story_plan → self_contained_story pair is a shared handoff for visual engines that otherwise own both " +
      "planning and paid rendering. The first step has one bounded non-Google text-plan/critique reservation; the second seals the accepted " +
      "native plan to an already admitted channel-program route, content lane, program brief, and topic. The certified automatic whiteboard " +
      "and motion-comic routes, plus Lore's registered benchmark-pending route, require that exact planner → sealing → matching-renderer sequence. The pair itself still neither selects or " +
      "admits a route, renders media, nor publishes.",
    gates: [
      "critic-approved typed native plan only",
      "exact matching family, content lane, frozen route, program brief, and topic",
      "the matching renderer must already be required by the admitted route; sealing cannot admit it",
      "provider-free: no render, spend, or publication authority",
      "a registered route can still remain blocked by its independent renderer/runtime benchmark admission",
    ],
    status: "active",
  },
  {
    key: "casefile-documentary",
    stage: "brief",
    title: "Casefile Documentary — Source-First Evidence Grammar",
    engine: "Provider-independent Case Packet → primary-source / rights / editorial-admission receipt → cited evidence grammar",
    how:
      "A reusable true-crime / investigation foundation rather than an automatic crime-channel switch. The registered " +
      "casefile_source_packet block requires every claim to name an exact primary-source URL/provenance, every ledger source to declare " +
      "citation-versus-visual use, non-public visual assets to carry matching rights evidence, and a fresh reviewer-identified approval " +
      "bound to the exact Case Packet and source-use ledger fingerprints. It emits only a private human-review draft receipt plus cited evidence grammar; active " +
      "allegations, graphic details, doxxing, actionable wrongdoing, stale/mismatched review, and missing evidence fail closed. No automatic " +
      "channel family consumes it yet.",
    gates: [
      "primary-source URL/provenance for every claim",
      "exhaustive citation-versus-visual source-use ledger",
      "matching rights/usage evidence for every non-public visual asset",
      "fresh reviewer-identified approval bound to the exact Case Packet and source-use ledger fingerprints",
      "active allegations, graphic detail, doxxing, and actionable wrongdoing blocked",
      "reconstructions require a visible disclosure",
      "every evidence scene carries an on-screen citation",
      "private human-editorial-review draft only; no automatic family admission",
    ],
    status: "reference",
  },
  {
    key: "casefile-evidence-shot-map",
    stage: "brief",
    title: "Casefile Evidence Shot Map — Claim-to-Visual Review",
    engine:
      "Provider-free admitted Casefile Source Packet + current Scene Manifest + current Story Spine ShotPlan → reviewer-signed factual claim map",
    how:
      "A reusable dark-documentary / true-crime quality handoff, not an automatic channel route. The registered " +
      "casefile_evidence_shot_map block requires every factual Case Packet claim to bind to one or more current scene and/or shot ids, " +
      "with a closed visual-treatment vocabulary of map, timeline, document abstraction, or a narrowly declared neutral reenactment. " +
      "Every binding names claim-supported source ids including an admitted primary source, keeps an on-screen citation, and is reviewed " +
      "against the exact source-packet, Scene Manifest, and ShotPlan fingerprints. The only reconstruction path requires the existing " +
      "illustrated-reconstruction declaration and exact visible disclosure; no gore or unsupported recreation can be represented in the map. " +
      "It emits a private human-review-only receipt and no automatic crime, documentary, or cinematic family consumes it.",
    gates: [
      "every factual claim maps exactly once to one or more current Scene Manifest and/or ShotPlan ids",
      "every mapped visual names claim-supported evidence including a declared primary source and a visible citation",
      "Scene Manifest and canonical ShotPlan fingerprints must match the editor-reviewed map",
      "closed treatment vocabulary: map, timeline, document abstraction, or declared neutral reenactment only",
      "no-gore and no-unsupported-recreation policy must both be explicitly true",
      "neutral reenactment requires illustrated-reconstruction declaration plus exact visible disclosure",
      "fresh reviewer approval bound to both the source-packet and canonical shot-map fingerprints",
      "private human-editorial-review receipt only; no automatic family admission or public/scheduled release",
    ],
    status: "reference",
  },
  {
    key: "source-bound-story-spine",
    stage: "brief",
    title: "Source-Bound Story Spine — Timed Evidence Handoff",
    engine:
      "Provider-free admitted Casefile source packet + reviewed evidence-shot map + current timed Story Spine → exact claim/source/citation/treatment handoff",
    how:
      "This reusable boundary does not write a fact, create a prompt, render media, or admit a channel. It verifies that every " +
      "timed Story Spine shot remains covered by a current reviewer-signed Casefile binding, then carries the exact claim ids, admitted " +
      "primary-source ids, on-screen citations, treatments, scenes, beats, sentences, and shot ids into a content-addressed private " +
      "handoff. Downstream cinematic direction can use it to preserve evidence while changing visual grammar rather than silently " +
      "turning a researched narrative into generic b-roll.",
    gates: [
      "source packet, source-admission, evidence map, and map-admission fingerprints must all be current and matching",
      "the reviewed ShotPlan fingerprint must equal the timed Story Spine shot list",
      "every claim binding retains an admitted primary-source id, visible citation, approved treatment, and real timed shot coverage",
      "unknown, orphaned, or stale Story Spine shot ids fail closed",
      "private human-editorial-review-only handoff; no automatic family, render, spend, or publication authority",
    ],
    status: "reference",
  },
  {
    key: "editorial-evidence-packet",
    stage: "brief",
    title: "Editorial Evidence Packet — Shared Factual Core",
    engine: "Provider-free reviewed sources + approved claims + immutable snapshot hashes → factual-visual source binding",
    how:
      "A reusable supervised foundation for factual illustrated explainers and data-led formats. The registered " +
      "editorial_evidence_packet block accepts only a fresh human-reviewed packet whose claim/source links and immutable source snapshots " +
      "match its content fingerprint. When an Episode Graph receives both this packet and a reviewed Evidence Visual Manifest, it rejects " +
      "any source name, URL, or snapshot mismatch before Scene Compiler rendering and retains the exact factual source on the affected beat. " +
      "It intentionally does not inherit Casefile's separate source-use rights, crime sensitivity, reconstruction, or claim-to-shot policies.",
    gates: [
      "unique reviewed source and claim identifiers with no unknown claim-source reference",
      "immutable source snapshot SHA-256 for every source",
      "fresh reviewer-identified approval bound to the exact packet fingerprint",
      "factual visual source name, URL, and snapshot must exactly match the shared packet before Scene Compiler admission",
      "private human-editorial-review only; no automatic factual-channel, render, spend, or publication admission",
      "Casefile source-use rights and reconstruction safeguards remain independently required for Casefile work",
    ],
    status: "reference",
  },
  {
    key: "cinematic-case-sequence",
    stage: "brief",
    title: "Cinematic Case Sequence — Evidence-Led Multi-Shot Direction",
    engine:
      "Admitted Casefile evidence map + Story Spine → reviewer-signed causal coverage units → exact Novita scene plan / EDL / visual-review locks",
    how:
      "The production bridge for a Fern-grade investigative treatment: each narrated causal beat becomes two to four purpose-specific " +
      "shots—spatial anchor, anonymous mannequin action or relationship, cited evidence insert, and consequence/reaction—rather than a " +
      "rotating b-roll carousel. Original faceless mannequin roles retain a distinct wardrobe silhouette, palette, prop, and movement profile; " +
      "they are never likenesses of real people. Every camera move, lens, scale, tension state, and cut has an explicit narrative reason. " +
      "The renderer preserves ordered scene identity across Novita batches and timeline_assemble uses the signed EDL directly; qa_visual samples " +
      "the exact identity/reveal/contradiction windows. It remains private human-editorial-review-only and does not make crime automatic.",
    gates: [
      "every causal beat has continuous two-to-four-shot coverage of its exact Story Spine window",
      "cold opens, investigations, contradictions, and reveals use geography/person/evidence scale variation—not modulo camera cycling",
      "question → pressure/uncertainty → reversal/release/residue tension grammar and cut rationale must be explicit",
      "every factual claim stays bound to an admitted source, cited treatment, and current scene/shot map",
      "anonymous mannequins are faceless, non-likeness roles with distinct wardrobe/silhouette/prop/movement locks",
      "no gore, unsupported recreation, or fact-inventing visual treatment; neutral reconstruction carries its exact disclosure",
      "fresh cinematic-editor approval binds source packet, evidence map, prompt/camera/cut/timing content fingerprint",
      "ordered renderer receipt and EDL must match every scene id and timing before assembly",
      "private human-editorial-review only; no automatic family admission or public release",
    ],
    status: "reference",
  },
  {
    key: "learning-contract",
    stage: "brief",
    title: "Learning Contract — Objective to Retrieval Practice",
    engine: "Episode Graph → typed objective, source-linked demonstration, recap, retrieval-practice, and human-review handoff",
    how:
      "Extracts the learning objective already present in an approved Episode Graph and locks which source-backed beats demonstrate it, " +
      "how the final beat recaps it, and what a learner should be asked afterward. It does not claim subject-matter accreditation or " +
      "invent a curriculum; the receipt binds a human review checklist to the exact graph fingerprint. This one contract is reusable by " +
      "supervised children’s learning now and future language / visual-STEM renderers. Implemented by src/engine/learningContract.ts.",
    gates: [
      "objective must be present in one or more Episode Graph beats",
      "demonstration and recap beats must belong to the active causal graph",
      "source references must resolve to the active graph source ledger",
      "children contracts require curriculum or primary evidence and child-safe retrieval wording",
      "stale receipt / graph fingerprint mismatch fails closed",
    ],
    status: "reference",
  },
  {
    key: "children-show-bible",
    stage: "brief",
    title: "Children’s Show Bible — Curriculum, Identity, and Participation",
    engine: "Operator-authored age band + one measurable objective + original recurring world/character identity + five-stage child-participation admission",
    how:
      "A reusable supervised-learning format contract rather than an automatic children’s channel. The registered " +
      "children_show_bible block binds an explicit age band, one observable objective/assessment, original recurring character and world " +
      "locks, and familiar problem → guided attempt → varied repetition → participation → resolution/recall to the active Episode Graph and " +
      "Learning Contract. A reviewer-identified human child-editor approval must match the exact content, graph, and lesson fingerprints. It " +
      "blocks obvious borrowed/IP-identifying terms but does not pretend to be trademark clearance; the human editor makes the affirmative " +
      "original-identity decision. The receipt is private-review-only and does not alter the existing children-learning family’s publishing policy.",
    gates: [
      "bounded declared toddler / preschool / early-primary age band",
      "exactly one observable, measurable learning objective tied to every graph beat and the Learning Contract",
      "original recurring guide/world identity locks must exactly match the active Episode Graph catalog",
      "obvious borrowed/IP-identifying identity terms blocked; human child editor affirms original identity",
      "full causal graph coverage in familiar problem → guided attempt → varied repetition → participation → resolution/recall order",
      "varied repetition changes at least two dimensions; participation and recall use the locked assessment/retrieval prompts",
      "fresh child-editor approval bound to the exact bible, Episode Graph, and Learning Contract fingerprints",
      "private human child-editor-review receipt only; no automatic family admission or public/scheduled release",
    ],
    status: "reference",
  },
  {
    key: "scene-compiler",
    stage: "visual",
    title: "Scene Compiler — Deterministic Illustration",
    engine: "Episode Graph Scene Manifest → local Remotion + FFmpeg master (zero remote media calls)",
    how:
      "Renders original maps, diagrams, panels, simple character puppets, screen cards, and transitions from the locked Scene Manifest, " +
      "then uses the standard audio assembly path for narration and score. It is intentionally separate from cinematic Novita: the " +
      "compiler is the reusable, deterministic visual lane for explainers and supervised learning content; cinematic retains its attested " +
      "Novita render-farm chain. Implemented by src/remotion/sceneCompiler and src/trigger/blocks/sceneCompilerBlocks.ts.",
    gates: [
      "manifest fingerprint and causal coverage match the story spine",
      "audited 16:9 master profile only",
      "narration/video duration agreement",
      "final master must contain audio and video streams",
      "manifest declares zero external provider calls",
    ],
    status: "reference",
  },
  {
    key: "child-content-safety",
    stage: "verify",
    title: "Children’s Learning Safety — Human Review Receipt",
    engine: "Deterministic audience, language, curriculum, and release-mode admission gate",
    how:
      "Admits only the supervised children-learning lane after the Episode Graph and deterministic Scene Manifest agree on a child-directed " +
      "learning objective. It emits a typed receipt that permits a private draft for human editorial approval—never an automated public or " +
      "scheduled release. Implemented by src/trigger/blocks/childrenSafetyBlocks.ts and enforced again at upload_draft.",
    gates: [
      "children audience declared across graph and scene manifest",
      "curriculum source plus explicit learning objective",
      "age-language and commercial-pressure checks",
      "only the audited zero-provider scene renderer admitted",
      "private draft and human editorial approval required",
    ],
    status: "reference",
  },
  {
    key: "loreshort",
    stage: "visual",
    title: "Lore Short — Loreshort Engine",
    engine:
      "Loreshort — Gemini first-person lore script + attested Novita stills + per-line cast-voice TTS + attested Novita LTX image-to-video depth camera moves + FREE ffmpeg 2K finish",
    how:
      "A single figure narrates history in FIRST PERSON (GoT \"Histories & Lore\" style): one Gemini-Pro call writes a paced " +
      "narration arc plus per-beat layered-depth SCENE prompts; Nano Banana paints each beat; ElevenLabs voices each line " +
      "separately so every shot is cut to its exact spoken length. A vision pass reads each painting and writes a motion brief " +
      "(subject + particles + a DEPTH camera move, scaled to honest intensity), which drives image-to-video into a GENUINE 3D " +
      "shot — real perspective and parallax, never a 2D pan. A title card plays before the " +
      "narration; ffmpeg fits each shot to its beat, dissolves, titles and grades. Self-describing (LORESHORT_MODULE contract), " +
      "fail-proof (retries, no cross-engine fallback), fully resumable. src/lib/loreshort.ts. " +
      "WIRED: the engine's providers are now INJECTED (LoreShortDeps), and the `lore_short` block " +
      "(src/trigger/blocks/loreShortBlocks.ts, registered in src/engine/blocks.ts) supplies the attested Novita render farm for " +
      "both stills (createAttestedNovitaImageGenerator) and the i2v camera move (generateI2V -> renderNovitaI2V), the channel's " +
      "cast voice instead of a hardcoded ElevenLabs id, and an R2 putObjectFromFile sink instead of the nginx docroot copy. " +
      "Every receipt accumulates with `+=`. Real-ESRGAN is NOT purchased: the block pins the engine's free ffmpeg 2K lane. " +
      "Calling craftLoreShort with no deps still runs the original standalone Replicate/ElevenLabs/nginx path unchanged.",
    gates: [
      "required inputs validated (topic / narrator / title / kicker / slug)",
      "de-branded visuals (content-policy safe)",
      "intensity-aware motion — depth camera leads, never forced",
      "title card BEFORE narration",
      "no cross-engine fallback — retry same engine or fail loud",
      "genuine-3D camera move (not a 2D pan)",
      "beat sheet settled by the Director at TEXT prices, then frozen to a content-addressed R2 checkpoint — a rejected draft never costs a render",
      "all paid stills and clips run through the attested Novita farm with per-call receipts",
    ],
    status: "reference",
  },
  {
    key: "novita-render-farm",
    stage: "visual",
    title: "Novita Render Farm",
    engine:
      "Direct Trigger-controlled Novita RTX 4090 spot workers — Z-Image keyframes followed by sealed LTX-2.5 image-to-video, one exact shot job per worker, durable R2 manifests, and verified worker teardown",
    how:
      "Only after an approved script, timed shot plan, and keyframe review, the Trigger controller creates a sealed direct worker " +
      "for each admitted image or LTX take. Z-Image Turbo supplies the reference still; LTX-2.5 then receives that exact R2 still " +
      "and its locked camera/motion prompt. The cinematic profile is Lightricks/LTX-2.5 distilled with FP8-cast plus CPU offload, " +
      "640×352 stage one → native latent x2 1280×704 at 25fps. Every worker writes a content-addressed R2 receipt, settles before " +
      "the stage returns, and is deleted/verified by the lifecycle controller. The retired VPS/HTTP bridge cannot launch work. " +
      "Video remains fail-closed until the exact LTX-2.5 RTX 4090 profile is present in the local benchmark allow-list.",
    gates: [
      "keyframe text/logo/wardrobe/continuity review completes before any LTX spend",
      "LTX accepts only the exact LTX-2.5 640×352 → 1280×704 x2 RTX 4090 profile and a local benchmark admission",
      "video frames always 8n+1 — rounded, never truncated silently",
      "every shot needs a motion cue — cameraMove !== 'static' or a non-empty motion field",
      "width/height must be a multiple of 32 (VAE tiling requirement)",
      "an explicit signed cost envelope and live RTX 4090 capacity admission precede every worker start",
      "no cross-engine or legacy-bridge fallback — a failed take is repaired or fails loud",
      "all started workers settle and verify deletion before the parent stage returns",
      "R2-backed idempotent receipts prevent a recovery from double-rendering",
    ],
    status: "active",
  },
  {
    key: "imagecraft-novita",
    stage: "visual",
    title: "Imagecraft (Novita Z-Image)",
    engine:
      "Imagecraft — direct Novita Z-Image Turbo BF16 reference stills on RTX 4090 spot workers, with profile-bound 1280×736, 1920×1088, or 2048×1152 output, R2 provenance, and verified autoclose",
    how:
      "The director's exact prompt, lens, scale, seed, continuity locks, and signed budget enter the direct Trigger controller. " +
      "It starts a single-purpose worker only after capacity and cost admission, persists the reference image and receipt to R2, " +
      "runs quality/keyframe review, then deletes the worker. Those accepted stills are the only permitted reference inputs for " +
      "the LTX-2.5 image-to-video branch; there is no live nginx/VPS bridge or retired Imagecraft implementation in this route.",
    gates: [
      "the exact Z-Image Turbo revision, profile geometry, signed cost envelope, and live RTX 4090 capacity are admitted before start",
      "keyframe review rejects text, logos, wardrobe, continuity, and composition defects before any LTX take can be purchased",
      "no cross-engine or legacy-bridge fallback — a failed still is repaired or fails loud",
      "R2 receipt fingerprints make recovery idempotent rather than double-rendering",
      "every started worker is reaped and deletion-verified before its parent wave settles",
    ],
    status: "reference",
  },
  {
    key: "videocraft-novita",
    stage: "visual",
    title: "Videocraft (Novita LTX-2.5 x2)",
    engine:
      "Videocraft — LTX-2.5 distilled image-to-video on an exact RTX 4090 spot profile: 640×352 stage one → native latent-space x2 refinement → 1280×704 final output, FP8-cast + CPU offload, with no model or hardware fallback.",
    how:
      "Each already-reviewed Z-Image still, camera move, motion cue, continuity lock, and duration is sealed into a one-shot direct " +
      "worker manifest. The worker verifies the digest-pinned LTX-2.5 components, probes the encoded 1280×704 MP4 at 25fps, and " +
      "returns exact scene order, frame geometry, GPU identity, and x2 evidence before timeline assembly. Accepted footage keeps the " +
      "same footageClips/footageKeys handoff, while the cinematic manifest preserves the source-to-shot binding. The legacy bridge " +
      "and retired videocraft module cannot be used as an alternative path. This module is deliberately not a production admission " +
      "until a sealed live RTX 4090 benchmark records the exact profile in the local allow-list.",
    gates: [
      "accepted Z-Image keyframes bind identity, wardrobe, props, text/logo rejection, and first/last-frame continuity before LTX starts",
      "FFmpeg temporal-dynamism, pacing, black/dead-air, and final-master QA reject a clip that does not move or cut as planned",
      "video frames always 8n+1 — rounded, never truncated silently",
      "every shot needs a stillKey + motion cue (cameraMove !== 'static' or a non-empty motion field) — validate() fails loud",
      "only the local benchmark allow-list can unlock the exact LTX-2.5 RTX 4090 profile",
      "no cross-engine or old-bridge fallback — a failed take is repaired or fails loud",
      "R2-idempotent receipts plus all-settled worker teardown prevent double-rendering and ghost billing",
    ],
    status: "reference",
  },
  {
    key: "lofi",
    stage: "visual",
    title: "Lofi Loop — Novita Ambient Engine",
    engine:
      "A Style-DNA-locked Novita Z-Image Turbo still, independently reviewed by a non-Google vision provider, is the exact source frame for a certified Novita LTX-2.5 image-to-video loop. A bounded seam treatment, mastered music mix, and final visual evidence turn it into an ambient product.",
    how:
      "scene_planner selects an authored ambient scene; keyframes refuses production before paid work unless the channel supplies a recurring subject and setting plus a configured non-Google reviewer. It permits at most two Novita still attempts and reviews the accepted image for identity, visual motifs, physics, and baked-in text. That accepted still anchors two independently attested 15-second LTX FLF2V segments. loop_clips measures both the internal join and wraparound seam before upscale. assemble normalizes one intro unit and one plain body unit, then packet-loops those pixels under mastered music for the selected one-to-eight-hour runtime.",
    gates: [
      "production keyframes require a grounded Style DNA subject and setting before any paid image work",
      "production keyframes require Groq or FAL review; Google/Gemini is not an eligible reviewer",
      "the accepted still is reviewed for channel identity, motifs, indoor-weather physics, and no baked-in text",
      "one exact accepted still anchors both Novita LTX-2.5 image-to-video jobs; the camera is explicitly locked",
      "the source is exactly two nominal 15-second FLF2V segments; both receive the accepted still as their terminal keyframe",
      "the 30-second unit must pass internal-join and wraparound SSIM gates before upscale",
      "one-to-eight-hour masters repeat H.264 packets instead of re-encoding identical pixels for the whole runtime",
    ],
    status: "reference",
  },
  {
    key: "quiz",
    stage: "visual",
    title: "Quiz — Quizcraft (NOT BUILDABLE under current licensing — design reference only)",
    engine:
      "No implementation exists. This entry documents a design intent — trivia / flag-guess / music-guess → a " +
      "deterministic dataset-backed answer → an isolated Remotion composition — that three independent audit " +
      "passes (2026-08) each found unbuildable as specified. Nothing in this entry is wired: no executableIds, " +
      "no family, no content lane. `public/golden/quiz/*.{jpg,mp4}` are early visual-format proofs only, not " +
      "evidence the pipeline can produce this content lawfully or repeatably.",
    how:
      "All three capabilities were independently closed off, each on its own grounds, not one shared blocker: " +
      "TRIVIA — every open trivia dataset checked either carries CC BY-SA 4.0 (ShareAlike is structurally " +
      "incompatible with YouTube's Standard License / CC BY 3.0-only options), is NonCommercial-licensed, is " +
      "offline, is unlicensed scraped third-party content (e.g. Jeopardy!), or is itself LLM-generated (which " +
      "fails gate 1 below regardless of license — it launders hallucination risk through an unauditable third " +
      "party instead of removing it). FLAG-GUESS — no source of national flag artwork carries a genuine CC0 " +
      "dedication (the closest, flag-icons, is MIT-licensed software with an unrecorded, since-deleted artwork " +
      "provenance); separately, national flags/emblems are subject to Paris Convention Art. 6ter and national " +
      "statutes restricting commercial use independently of copyright, which a monetized channel triggers; the " +
      "\"195\" sovereign-state figure is also an unresolved political classification (Taiwan/Kosovo/Palestine/" +
      "etc.), and no confusable-pairs data exists anywhere to ground an honest EASY→IMPOSSIBLE ramp. MUSIC-GUESS " +
      "— the shipped proof render uses the actual Star Wars theme (John Williams, 1977), which directly " +
      "contradicts this entry's own former claim of a public-domain theme; no clearable-audio sourcing exists. " +
      "Building any of the three today, under any of the found sources, would mean shipping a legal claim this " +
      "codebase's own audit found to be false. Rebuilding this capability needs a product/legal decision — " +
      "e.g. a licensed flag/trivia dataset with sourcing accepted by the business, a resolved list of which " +
      "territories count, a curated (not automatic) difficulty methodology, and genuinely clearable music — " +
      "not an engineering fix.",
    gates: [
      "deterministic dataset answer (never model-guessed) — no compliant dataset found for trivia or flag-guess",
      "dedupe by question key — trivially satisfiable once a dataset exists, not itself a blocker",
      "per-capability timing + layout — proven achievable by the visual-format proof media, not a blocker",
      "isolated Remotion bundle — tractable new infra (second bundle entrypoint), not a blocker",
    ],
    status: "reference",
    // SUPERSEDED IN PART: the format was never the problem, only the content
    // sourcing was. See the `quiz-year` entry below for the one guess-the-year
    // capability that IS buildable and is now wired.
  },
  {
    key: "quiz-year",
    stage: "visual",
    title: "Quiz — Guess the Year (Wikidata)",
    engine:
      "quiz_year — CC0 Wikidata facts → four-option rounds → isolated Remotion bundle " +
      "(src/lib/quizYearFacts.ts, src/trigger/blocks/quizYearBlocks.ts:341's quiz_year block, " +
      "src/remotion/quiz/Root.tsx, src/lib/quizYearRender.ts)",
    how:
      "This is the guess-the-year format that survives the licensing analysis that closed the three sub-formats " +
      "in the `quiz` entry above. It needs NO third-party media at all: the only external input is Wikidata's " +
      "structured statements, released under CC0 1.0 — a genuine public-domain dedication with neither " +
      "attribution nor ShareAlike obligation (the exact property every trivia dataset in the prior audit " +
      "lacked). Nothing is scraped, no artwork or audio is reused, and every frame is typography rendered " +
      "locally by Remotion. THE ANSWER IS NEVER MODEL-GUESSED: the year is read from a Wikidata time value, " +
      "the phrasing model's response schema has no year field to populate, any phrasing containing a " +
      "four-digit number is rejected in favour of a deterministic template, and assertAnswerIntegrity re-checks " +
      "QID + year immediately before render. Three real data-integrity failure modes found by live probing are " +
      "gated deterministically: entities carrying multiple conflicting dates are dropped (Q49740 'Skyrim' has " +
      "P577 values in both 2009 and 2011 — a question with two defensible answers is broken), any four-digit " +
      "year in the label/description that disagrees with the structured year is treated as an unresolved " +
      "contradiction and dropped (Q94501: data 1998 vs description '1997 ... video game'), and time values " +
      "coarser than year precision are dropped. Each round shows the sourced year plus THREE GENERATED DECOYS; " +
      "decoys carry provenance: 'generated-decoy' in the type system and are never cited, never recorded as " +
      "facts, and proven by assertOptionIntegrity to be incapable of being the correct option. Cost is the " +
      "smallest in the catalog — facts are free, the render is local, and the only spend is a bounded text " +
      "phrasing pass per round, critique-looped on WORDING only and frozen into a content-addressed checkpoint.",
    gates: [
      "deterministic dataset answer (never model-guessed) — SATISFIED: year read from a Wikidata time value; LLM schema has no year field",
      "no four-digit number in question text — rejected phrasings fall back to a deterministic template",
      "exactly one sourced option among four; decoys type-tagged and provably never correct",
      "single unambiguous year per subject (multi-date entities dropped)",
      "label/description year must agree with the structured year",
      "date precision ≥ year (precision 9)",
      "sensitive/tragedy content excluded by default (allowlisted topics + term filter)",
      "isolated Remotion bundle — src/remotion/quiz/index.ts, separate from src/remotion/index.ts",
    ],
    // WIRED, not yet Golden-certified: no signed promotion receipt from a real
    // end-to-end run exists. Fact sourcing has been verified live against the
    // real endpoint; a full pipeline run has not been performed.
    status: "active",
  },
  {
    key: "quiz-short-private-release",
    stage: "ship",
    title: "QuizShort — Registered Private-Release Block (No Owner Intake)",
    engine:
      "quiz_short_release — certified QuizYear fact/source receipts + final visual/audio QA + opening evidence → private human-review receipt",
    how:
      "This is a registered post-QA private-release checkpoint for a future owner-selected portrait QuizShort intake, not a channel format or admitted creator route. " +
      "It performs no planning, rendering, provider call, spend, or publication; it only validates that an already-rendered 9:16 master retains the exact certified facts, source OCR, opening/motion evidence, and final visual/audio QA before allowing a private human-review draft. " +
      "There is currently no owner-facing intake for it, so it cannot be selected from the creator flow and cannot make ordinary QuizYear executable as a Short.",
    gates: [
      "registered private-release block only — no owner-facing intake or admitted standalone route",
      "same certified QuizYear facts and source OCR must bind to the final master",
      "final visual QA, scored audio QA, and retained opening/motion evidence must all pass",
      "private human-review draft only; no provider work, automatic production, public/scheduled release, or cross-posting",
    ],
    status: "registered",
  },
  {
    key: "thumbnail",
    stage: "package",
    title: "Thumbnail — Banana Engine",
    engine: "Text-free Flash scene + deterministic Style-DNA typography",
    how:
      "A bounded concept pass separates a literal story scene from a 2-3 line payoff headline. A Flash image " +
      "provider receives only the typed, text-free scene and reserved safe zone; local FFmpeg then renders the " +
      "exact copy using the channel's executable motif (carved, torn strip, paint smear, neon, ransom tiles, " +
      "and the other Style-DNA treatments), palette, badge and layout. One post-render mobile/reference judge " +
      "may block publishing but never regenerates or substitutes a generic card. Observed provider/model usage " +
      "is charged from counters rather than a stale flat estimate.",
    gates: ["structural text-free provider request", "deterministic spelling + bounded layout", "faceClear", "punch ≥ 7", "styleMatch ≥ 7", "storyMatch ≥ 7", "uiClean"],
    status: "reference",
  },
  {
    key: "package-opening-proof",
    stage: "package",
    title: "Package → Opening Evidence",
    engine: "Typed package plan → exact cover bytes → reviewed opening/master receipt",
    how:
      "Before thumbnail generation, the title, thumbnail description, topic, active route, and declared opening " +
      "anchor are frozen into one content-addressed package plan. The cover request carries that plan fingerprint. " +
      "During production QA, the plan is checked again, then bound to the exact uploaded cover bytes, the final-master " +
      "hash and duration, and one retained visual-review frame inside the opening window. Retries reload and hash the " +
      "cover again before dispatch. This is deliberately structural evidence: it proves the same package and reviewed " +
      "opening travel together; it does not pretend to infer semantic equivalence from pixels.",
    gates: [
      "title, cover brief, topic, route and opening anchor are immutable before cover spend",
      "cover request hash carries the package-plan fingerprint",
      "production receipt binds exact cover bytes, final master and a retained opening-review frame",
      "missing or altered cover bytes reject retry-time release verification",
      "legacy/unmeasurable runs emit an explicit bounded omission, never a fabricated claim",
      "structural evidence only — not a substitute for semantic or retention review",
    ],
    status: "reference",
  },
  {
    key: "topic-intel",
    stage: "intel",
    title: "Topic Intel — Topicraft",
    engine: "Topicraft — evidence-cited topic BETS (outlier bank + Reddit + autocomplete + competitor gaps), judge-gated portfolio",
    how:
      "Topics are placed as BETS, not ideas: one Pro call writes a hero/hub/help portfolio where every " +
      "candidate is a complete promise unit (topic + angle + provisional title + thumbnail moment + hook " +
      "promise) and must CITE the real signal it rides — a cached outlier scan, a live Reddit discussion, " +
      "a real autocomplete query, or a competitor gap. A deterministic lint verifies every citation " +
      "against the supplied evidence, dedupes semantically vs everything done or planned (embeddings + " +
      "token overlap), and runs each provisional title through metacraft's title lint. A judge gates " +
      "demand/freshness/fit/packageability ≥7; winners ship with a judged bench and warm-start the " +
      "metadata, thumbnail and hook engines downstream. Two LLM calls per slate; loud failure; " +
      "quota-immune outlier reads.",
    gates: ["evidence citation verified vs real signals", "semantic dedupe vs done + planned", "metacraft title lint on every bet", "demand / freshness / fit / packageability ≥ 7", "banned words / stale years"],
    status: "reference",
  },
  {
    key: "serialized-program-episode-context",
    stage: "intel",
    title: "Serialized Episode Context — Immutable Continuity Receipt",
    engine: "Provider-free completed episode row → bounded route/run/topic-bound continuity projection",
    how:
      "Only an already-admitted serialized_program/v1 route can place this block, immediately after Topic Select. " +
      "Topic Select commits the finished serial episode and a compact continuity receipt in the same atomic row update; the bridge then reads only that completed row, validates its full frozen route seed, run, series identity, and topic, and exposes the receipt to existing crew, script, story, packaging, and QA calls. " +
      "It never reads live series state, chooses a route, calls a provider, renders media, spends, or publishes; non-serialized and historical runs remain unchanged when no receipt exists.",
    gates: [
      "route-owned placement exactly once after topic_select and before every continuity consumer",
      "atomic completion row contains a bounded, content-addressed receipt rather than a mutable series-state lookup",
      "full frozen route seed, run, series identity/count, topic, and topic-memory key must all match exactly",
      "tampered, stale-retry, cross-route, or cross-topic receipts fail closed before prompt use",
      "provider-free and cost-neutral: no model, render, route admission, or publication authority",
    ],
    status: "reference",
  },
  {
    key: "narrative-series-visual-controls",
    stage: "brief",
    title: "Narrative Series Visual Controls — Sealed Shot Continuity",
    engine: "Provider-free Series Plan + Episode Graph/Story Spine + accepted character-adapter receipt → per-shot continuity contract",
    how:
      "For a future exact serialized route only, this bridge reloads the owner-scoped immutable Series Plan and any already-accepted character-adapter receipts, then binds them to the completed Episode Graph and Story Spine. " +
      "It records a route/run-bound episode and shot-control receipt for later visual engines. It cannot train or download an adapter, invoke a provider or renderer, spend, select/admit a family, or publish; no current certified route includes it.",
    gates: [
      "serialized route seed, owner/channel, series-plan fingerprint, and episode topic must match exactly",
      "only a previously accepted reusable character-adapter receipt may be referenced",
      "Episode Graph, Story Spine, cast/location continuity, first/last frame, and camera-motion controls are sealed before a visual engine sees them",
      "missing, stale, cross-owner, or mismatched persistence records fail closed",
      "provider-free bridge only; training, rendering, admission, and publication remain separate gates",
    ],
    status: "reference",
  },
  {
    key: "show-bible",
    stage: "brief",
    title: "Show Bible + Crew",
    engine:
      "Standalone Crew module — crew as DATA: a declarative role registry (director / cinematographer / editor / composer / critic) + a pure resolveCrew over the channel's Show Bible (authored doctrines) + a CustomizationSurface (role toggles + 6 style presets). Critic authors the ValidationSpec the verify stage enforces",
    how:
      "The Show Bible distills the channel's frozen Style-DNA into per-role doctrine; the leveled-up Crew module " +
      "turns the crew into DATA. resolveCrew (pure, no LLM) reads which roles are ACTIVE for the channel (not every " +
      "channel needs every role — shorts drop the DP, meditation is composer-led, lofi runs director+composer only) " +
      "+ each active role's authored doctrine, via the CustomizationSurface (preset + per-channel overrides on " +
      "moduleConfig['show-bible']) — one resolver, ZERO per-role code branches. A role active without an authored " +
      "doctrine surfaces a typed warning (never a silent generic brief); the critic's doctrine becomes the " +
      "ValidationSpec verify enforces, and marketAwareCritic judges vs scraped real competitors. Standalone + " +
      "unit-tested; reuses VIDEO_CREW_ROLES + ShowBible (src/lib/crew, registered in MODULE_REGISTRY) so the " +
      "Architect/Director compose the crew straight from the card.",
    gates: [
      "crew is data (no per-role code branches)",
      "opt-in roles (resolveCrew never assumes a fixed crew)",
      "no silent gaps (role w/o doctrine → typed warning)",
      "critic doctrine → verify ValidationSpec",
      "per-account (preset + overrides) configurable",
    ],
    // Active while crew is leveled up member-by-member into wired sub-modules (Editor done →
    // Assembly; director/dp/composer/critic + dead-loop closures to follow). Re-golden when complete.
    status: "active",
  },
  {
    key: "script",
    stage: "write",
    title: "Script + Hook",
    engine: "Hookcraft cold-open engine + latest Gemini Pro narration (gemini-3.1-pro-preview)",
    how:
      "The cold open comes FIRST: hookcraft writes four device-diverse candidates (cold-open scene, " +
      "receipt, contrarian verdict, flash-forward, result-first, …) that must be SPECIFICALLY about the " +
      "topic, built on the researched 0-30s retention arc — capture and confirm the clicked promise in " +
      "0-5s, explicit payoff promise by ~15s (52% vs 44% retention), stakes + open loop by 30s. A " +
      "deterministic craft lint (first sentence ≤7s, banned filler/disclaimer openers, concrete anchor, " +
      "<15-word sentences) runs before a judge gates punch/specificity/curiosity/voiceMatch/promise ≥7 " +
      "with one feedback retry — loud failure, never a could-open-any-video line. The latest Gemini Pro " +
      "then writes the narration continuing from it under CRAFT_RULES, in the Show Bible's register, as a " +
      "STORY JOURNEY (Calm-style): arrival ritual → experience-before-explanation movements carried by ONE " +
      "image → integration into the viewer's day → a landing with a quotable takeaway. Episodic programs " +
      "get formal series support (phase-aware curriculum, previous-episode thread, next-episode seed).",
    gates: ["hook lint (≤7s, no filler, concrete)", "punch / specificity / curiosity / voiceMatch / promise-by-15s ≥ 7", "grounded fact-check (search-verified claims, false = rejected)", "loop payoff verified by qa_script", "midpoint re-hook verified", "measured hook window: a real shot/beat transition inside the first ~10s of actual audio timeline (hookcraft.ts measureHookWindow, additive to the estimated-duration lint — never requires an on-screen text card that early)"],
    status: "reference",
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
    title: "Narration — Voicecraft",
    engine: "Voicecraft — profiled voice bank + archetype casting law + narration physics + audio-judged cold open (ElevenLabs v3 / Fish)",
    how:
      "The operator's real ElevenLabs voices are LISTENED to by an audio model and distilled into profiled " +
      "voice cards (gender / age-feel / register / pace / energy / texture / best-fit archetypes) in a Convex " +
      "bank. Casting is law, not vibes: each archetype carries a casting spec (stoic = deep dark male, slow; " +
      "finance = energetic-or-smooth male, faster; social chaos = younger female, fast; meditation = calm " +
      "professional mature female, slow) that prefilters the bank deterministically before the judge AUDITIONS " +
      "the top cards on their real audio and gates the winner ≥7 — no fit fails loud with voice-library " +
      "candidates to add. Delivery rides NARRATION_PHYSICS: per-archetype speaking rate (v3 voice_settings." +
      "speed, verified live), v3 stability, style, tag density and sentence air. Before every full-script " +
      "spend a cold-open probe is rendered once and judged on register / pace / tag performance / cleanliness " +
      "≥7 with one seed-bumped retry — a wrong cast dies in ~250 characters, not after the whole paid render.",
    gates: ["casting spec prefilter (gender / age / register law)", "audition judge ≥ 7 on real audio", "cold-open gate: register / pace / performance / clean ≥ 7", "loud failure (no fallback voice)"],
    status: "reference",
  },
  {
    key: "music",
    stage: "sound",
    title: "Music — Scorecraft",
    engine: "Channel-scoped multi-track score with bounded provider routing and exact usage accounting",
    how:
      "The selected family decides whether music is a supporting bed or the product itself. The executable " +
      "module generates only the configured number of distinct tracks, crossfades them into one mastered " +
      "mix, persists the mix before downstream assembly, and accounts for accepted provider work exactly. " +
      "It is selected only for channels whose concrete pipeline contains the music block.",
    gates: ["bounded track count", "provider receipt accounting", "persisted mix before assembly", "no implicit per-channel selection"],
    status: "active",
  },
  {
    key: "visuals",
    stage: "visual",
    title: "Visuals",
    engine: "Family-swapped: FOOTAGECRAFT standalone stock engine (federated Pexels + Pixabay, 4K-ONLY, concurrent) / entity imagery / flux keyframes / boomerang loops",
    how:
      "The family delta picks the visual engine per channel: federated stock + entity imagery for narrated " +
      "essays, generated keyframes + image-to-video for cinematic families, seamless boomerang loops + " +
      "Topaz upscale for lofi. Stock now fans out across every configured provider in parallel and pulls the " +
      "highest-resolution file each offers (up to UHD) so the 1080p canvas downscales crisply and Ken-Burns " +
      "push-ins stay sharp. A multi-frame relevance gate samples start / middle / end of each candidate and " +
      "rejects the clip if ANY frame drifts off-theme or shows a watermark, logo or burned-in caption. Style " +
      "DNA grounds every query and prompt; a cross-video ledger keeps footage unique between uploads. The stock " +
      "engine is the standalone src/lib/footagecraft.ts module (channel+topic-aware query-gen, concurrent download + " +
      "gate, cloud-worker temp -> R2 only, never a dev box).",
    gates: ["multi-frame relevance + watermark gate (>=7)", "per-artifact qa_visual", "coverage contract vs cut sheet", "cross-video dedup"],
    status: "active",
  },
  {
    key: "studio-assets",
    stage: "visual",
    title: "Studio Asset Library",
    engine: "Owner-scoped reusable camera, motion, prompt, presentation, character-adapter, and control-guide records",
    how:
      "The Studio keeps approved reusable visual language as evidence-bound records, so a compatible channel can " +
      "reuse a proven camera grammar, overlay, transition, motion graphic, or accepted character adapter instead " +
      "of rediscovering it every run. Every entry remains owner-, channel-, and where needed series-bound; missing " +
      "or incompatible evidence creates a new reviewed candidate rather than borrowing another channel's material. " +
      "A selected clay, brick-built, anime-inspired, or drawn treatment is compiled into the canonical Visual Matter " +
      "revision, character and setting sheets, storyboard/motion locks, and visual-review criteria; it does not claim " +
      "a treatment renderer is admitted. " +
      "Standard LTX LoRAs are separately pinned and benchmarked, while IC-LoRA controls remain visibly gated to a " +
      "future dedicated Comfy/LTX worker with a sealed workflow and per-shot guide.",
    gates: [
      "owner/channel/series scope — no cross-channel borrowing",
      "approval evidence + exact compatibility before reuse",
      "canonical visual-treatment plan bound into prompts, continuity, and visual QA — not an automatic renderer claim",
      "pinned model/runtime + benchmark before a standard LoRA",
      "IC controls require a sealed Comfy workflow + guide; direct LTX is blocked",
    ],
    status: "registered",
  },
  {
    key: "cinematic",
    stage: "visual",
    title: "Cinematic — Cinecraft",
    engine: "Cinecraft — generated character/location-consistent cinematic shots (Nano Banana hero-anchor + Higgsfield Soul + Seedance/Kling i2v)",
    how:
      "The cinematic family GENERATES the screen instead of sourcing it — the Cipher / \"ago.\" true-crime / history look, " +
      "where the same people, places and objects recur across many reconstructed shots. extractSubjects pulls the story's " +
      "essential characters + recurring locations + key objects; each is designed into a Nano Banana reference sheet and " +
      "becomes the ONE canonical anchor. A director pass scripts each beat with real camera grammar (move, lens, mood, " +
      "transition) in the channel's CINEMATIC_DOCTRINE style. The consistency LAW: every keyframe is the subject's hero " +
      "image as a DIRECT reference, the prompt leads with the identity lock and names the distinctive features (never a " +
      "generic re-description — that's what made early renders \"four different people\"), a vision gate re-rolls drift, " +
      "then Seedance/Kling animates the locked keyframe. Establishing + multi-subject shots supported; any style. Operator " +
      "approves the hero before any Soul. Standalone src/lib/cinecraft.ts (480 L), visual-only (a pipeline adds audio + assembly). " +
      "cinecraft.ts ITSELF IS RETIRED, NOT PENDING (P1-10 resolved, superseded): its render path is hard-disabled at the source " +
      "(hasCinecraft() returns a literal false, src/lib/cinecraft.ts:47-52) because designSubject/trainSoul/renderShot all drive the " +
      "retired PAID Higgsfield CLI; that renderer must never be reopened. The file survives as a type/catalog surface only " +
      "(ShotSpec, src/lib/crew/cinematographer.ts:16). The hero-anchor consistency LAW described above IS nevertheless enforced in " +
      "production, by an equivalent renderer-neutral module rather than by cinecraft: the `visual_matter` block " +
      "(src/engine/visualMatter.ts + src/trigger/blocks/visualMatterBlocks.ts) emits per-character `identityLock`, per-setting " +
      "`continuityLock`, and storyboard review criteria which the Z-Image -> qa_assets -> LTX -> qa_shots chain HARD-REQUIRES " +
      "(requireVisualMatter throws, src/trigger/blocks/novitaRenderBlocks.ts:452-456; consumed at :550, :610, :808, :888). " +
      "When explicitly enabled for a cinematic run, the separate `visual_matter_references` block uses the admitted direct-Novita " +
      "Z-Image text-to-image path to create a bounded R2 pack with exact byte/request/worker-receipt binding. `qa_assets` and " +
      "`qa_shots` alone load those pixels as comparison anchors. Direct Z-Image remains text-only: this does not claim image-to-image " +
      "or reference-image conditioning of primary keyframes. With no opt-in, the identity locks remain enforced by the normal vision " +
      "quality floor and bounded repair path; no non-thumbnail media is routed through the thumbnail provider.",
    gates: ["planning identity anchor via visual_matter (not the retired Soul)", "optional bounded, byte/receipt-bound direct-Novita QA reference pack", "vision identity floor with bounded repair re-rolls (qa_assets)", "per-kind lock: identityLock (person) / continuityLock (place)", "no claimed direct-Z-Image image conditioning"],
    status: "reference",
  },
  {
    key: "documotion",
    stage: "visual",
    title: "Documentary — Documotion",
    engine: "Documotion — themeable documentary-collage motion engine (Remotion + Banana stills & typography + real OSM geo, narration-first planner, vision still-verifier)",
    how:
      "The motion-graphics family for narrated documentary and true-crime: archival sepia collage, a detective evidence-board " +
      "with red string, a robbery-noir heist reconstruction — each a channel WORLD in one style registry. The planner is " +
      "narration-first: it writes the voiceover as one coherent arc, then composes each beat from a CAPABILITY palette " +
      "(parallax portrait, a real rendered geo_map from OSM streets and buildings, 2.5D depth-parallax camera-through-photo " +
      "with rack focus, evidence board, object drop, a designed quote card). A style biases that mix, it never whitelists it, " +
      "so new looks emerge from config. Every closing card is bespoke Nano Banana letterpress typography, not a web font. The " +
      "LAW: all text, the red string and the pins are ENGINE OVERLAYS, never baked into an image. A still-verifier renders one " +
      "frame per shot and a vision judge scores it, applying typed fixes until it passes. Standalone src/lib/documotion.ts, " +
      "visual-only (a pipeline wraps narration, music, thumbnail and title around the body).",
    gates: ["still-verifier type / cutout / composition / style / cohesion >= 7", "HARD legibility gate: no overlapping text (deterministic pass, self-corrects)", "text is an overlay, never baked into images", "narration-cue match + tonal label lint"],
    status: "reference",
  },
  {
    key: "motioncraft",
    stage: "layer",
    title: "Motion Graphics — Motioncraft",
    engine:
      "Motioncraft — an LLM reads the script, decides which beats earn a motion graphic, picks the best free tool per beat, and renders each (MapLibre · Remotion · Nano Banana · p5.js)",
    how:
      "A standalone motion layer for any narrated video. analyzeForMotion reads the whole script with the tool " +
      "catalog and returns a short list of opportunities — it EARNS each graphic (3-6 per video, never one per line), " +
      "routes every one to the best tool, and extracts the content. geo_map renders a real location from OSM streets " +
      "in MapLibre with a gold target push-in; data_stats animates only the numbers the narration actually speaks, " +
      "verbatim, in Remotion; hero_title renders a thumbnail-grade Nano Banana scene, lifts a depth-parallax cutout " +
      "(Marigold + feathered alpha) and flies a camera through it in Remotion with a kinetic title overlaid — never " +
      "baked in; generative paints a drifting intel-network background in p5.js. One tool contract (__ready / __dur / " +
      "__frame / __settle) drives a single generic Playwright capture, so new tools plug in with zero rework. Clips are " +
      "timed to each narration cue and per-clip failures stay isolated. Was standalone in src/lib/motioncraft.ts (246 L), visual-only. " +
      "DELETED, NOT PENDING (P1-11 resolved by P2-7): src/lib/motioncraft.ts had zero pipeline importers (it was always \"catalog-only\" " +
      "in goldenExecution.ts CATALOG_EXECUTION_BINDINGS) and was removed outright as confirmed-dead in commit 183ee6a. Of its four " +
      "tools, only data_stats' verbatim-number animation has a real successor: it is DUPLICATED, not consumed, by the production " +
      "Insert module (src/trigger/blocks/insertBlocks.ts:22,72,107, catalog key \"inserts\"), which is the one actually wired and " +
      "gated. The other three demonstrated tools do NOT have a like-for-like successor and their own implementations are now gone " +
      "outright with the file: geo_map's live MapLibre/OSM street-tile renderer, hero_title's Marigold depth-cutout + kinetic-title " +
      "camera-through-photo treatment, and generative's p5.js drifting intel-network background are all permanently deleted code. " +
      "(The wired documotion.ts module separately and independently built its OWN real-place map reveal (geo_map shot kind, pulling " +
      "live OSM street data via src/lib/geoMap.ts) and its OWN single-image depth-cutout camera-through-photo move (depth_parallax " +
      "shot kind) -- similar creative ideas achieving a similar effect, but distinct, independently-authored code, not motioncraft's; " +
      "generative's p5.js procedural background technique has no equivalent anywhere else in the repo and is the one capability with " +
      "nothing standing in for it at all.) The only surviving evidence of what all four looked like is the proof media at " +
      "public/golden/motioncraft/{map,stats,hero,crew}.mp4.",
    gates: ["the LLM earns each graphic (3-6 / video, never per line)", "best-tool routing per beat", "verbatim numbers only (stats)", "no text baked into the hero image — the title is a crisp overlay", "per-clip failure isolated"],
    status: "reference",
  },
  {
    key: "speech-tv",
    stage: "visual",
    title: "Motivation Speech — Speechcraft",
    engine:
      "Speechcraft — real public speeches → word-level transcript → best-segment plan → a self-contained Remotion vintage-broadcast composition (VintageFilter grain/scanlines/desaturation + KaraokeCaptions word-sync + ChannelBug segment marker + MotionCues), with a letterboxed CinematicSpeech variant, cloud-rendered",
    how:
      "The motivational-speech repost look: real speech footage is wrapped in a vintage broadcast frame — " +
      "desaturated, blue-tinted, film-grained, vignetted — with a top-right segment 'channel bug' (n/total + " +
      "progress ring), word-by-word captions that snap in exactly when each word is spoken, and motion graphics " +
      "(animated underlines, spike line-graphs, icon pops, pixelated step-boxes, lower-thirds, VHS glitch cuts) " +
      "that mount ONLY within their [start,end] window so each stays on screen for exactly as long as it is " +
      "script-relevant. Driven by a typed contract — words + segments + an LLM cue-track — so the source/" +
      "transcribe/cue-gen stages plug in later with zero rework. One opaque H.264 render via " +
      "src/lib/remotionRender.ts (renderMotivationalSpeech) into both a full-frame MotivationalSpeech look and a " +
      "letterboxed CinematicSpeech variant. Proof: the Steve Jobs 2005 Stanford commencement, motivation-edited. " +
      "NOT REACHABLE FROM THE PIPELINE (P1-12): renderMotivationalSpeech (src/lib/remotionRender.ts:360) has zero callers anywhere " +
      "in src/trigger or src/engine -- invocable only via a manual Remotion CLI render, not the production pipeline. The library " +
      "exists; a production adapter does not yet.",
    gates: [
      "caption highlight synced to word-level timings",
      "segment channel bug matches plan boundaries",
      "deterministic from a typed plan (no per-frame LLM)",
      "cues clamped to their [start,end] window",
    ],
    status: "reference",
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
    title: "Captions + Presentation",
    engine: "Word-level captions, quote overlays, intro card, and approved Studio presentation recipes (Remotion/FFmpeg)",
    how:
      "Word-timed captions, quote overlays and the intro card are composited over the edit, styled by the " +
      "channel's DNA typography so every layer stays on brand. The Studio may also reuse an approved, exact " +
      "module-specific audio direction, quote-card grammar, data-insert treatment, or closed title-to-body " +
      "transition—never an arbitrary filter or a replacement for the episode's timing, story, or accessibility plan.",
    gates: ["timing sync vs narration", "approved module-specific recipe only", "closed assembly transition set"],
    status: "active",
  },
  {
    key: "assemble",
    stage: "build",
    title: "Assembly — EDL Engine",
    engine:
      "Standalone Assembly module — a typed Timeline/EDL (planTimeline, the brain) rendered deterministically (renderTimeline over the ffmpeg primitives, the hands), per-account via a CustomizationSurface (10 knobs · 6 style presets), idempotent + heal-aware",
    how:
      "Assembly is split BRAIN from HANDS. planTimeline emits a pure, inspectable, hashable Timeline (segments + " +
      "ducked audio + overlays + length band + a declared heal checkpoint); renderTimeline executes it over the " +
      "ffmpeg primitives with VALIDATE-BEFORE-SPEND (length band, footage coverage, overlay windows — fail loud, " +
      "never render an off-length/dead-air cut), CONTENT-ADDRESSED IDEMPOTENCY (a retry re-uses cached output, never " +
      "double-renders), HEAL from the declared checkpoint (not a regex on hints), and NO SILENT SKIPS (a dropped " +
      "card/overlay is a typed warning the verify stage gates on). Every style choice — cut energy, aspect, intro/" +
      "outro, music-duck profile, captions on/off, vertical reframe — comes from the channel's CustomizationSurface: " +
      "one preset (documentary / essay / hype / shorts / meditation / lofi) configures the whole module, and the " +
      "'essay' preset reproduces the legacy renderer EXACTLY (parity). Its title-to-body hard cut, crossfade, and " +
      "dip-to-black paths are each real-render parity checked, rather than being display-only configuration. One model " +
      "serves narrated AND lofi. Standalone + unit-tested (6 suites) with a real ffmpeg smoke render proving the " +
      "body/compose/caption path; the module " +
      "guides the Architect/Director (src/lib/assembly, registered in MODULE_REGISTRY).",
    gates: [
      "validate-before-spend (length band · coverage · overlay windows)",
      "content-addressed idempotency (no double-render)",
      "heal from a declared checkpoint (no regex)",
      "no silent skips (dropped overlays → typed warnings)",
      "'essay' preset == legacy renderer (parity)",
      "hard cut / crossfade / dip-to-black each render-parity checked",
    ],
    status: "reference",
  },
  {
    key: "metadata",
    stage: "package",
    title: "SEO Metadata",
    engine: "Metacraft — autocomplete-grounded candidates (latest Gemini Pro) + claims lint + feed judge",
    how:
      "Seven title candidates across distinct frames, grounded in LIVE YouTube autocomplete (what people " +
      "actually type) and the niche's real top titles. A deterministic lint then enforces what the old " +
      "rules only asked for: every number and name in the title must exist in the fact-checked script " +
      "(grounded = verified, transitively), the payoff lands inside the first ~50 chars (mobile " +
      "truncation), no filler starts, register-aware hype rules. A feed judge gates clickScore ≥7 under " +
      "the title-promise contract; the runner-up is stored for CTR-swap learning. THE QUOTE opens the " +
      "description, auto-chapters land at upload, and a comment-seeding pinned comment is emitted.",
    gates: ["claims grounded in fact-checked script", "direct ≥ 7 (no setup prefixes, 40-70 chars)", "clickScore ≥ 7 vs the real feed", "payoff in first ~50 chars", "title-promise contract", "banned words / register"],
    status: "reference",
  },
  {
    key: "verify",
    stage: "verify",
    title: "Artifact + Shot Gates",
    engine: "qa_assets + qa_shots + short_scene_qa + length_check",
    how:
      "Inputs are checked before final-master certification: source assets and individual generated shots must meet their " +
      "lane-specific requirements, Shorts must retain their safe-area scene evidence, and duration must be exact. Failed " +
      "artifacts feed typed repair hints into the bounded self-heal loop instead of being silently shipped. The final-master " +
      "review itself is shown separately so its video-quality, narration-semantic and certificate proof do not disappear " +
      "inside this broader asset-check card.",
    gates: [
      "asset and shot evidence must satisfy the active lane before mastering",
      "Shorts retain safe-area / scene evidence where required",
      "exact duration gates fail closed; child safety remains a separate dedicated module",
      "bounded typed self-heal; no silent skip or blind re-render",
    ],
    status: "active",
  },
  {
    key: "final-master-story-coverage",
    stage: "verify",
    title: "Final Master — Visual Quality + Narrated Story Coverage",
    engine: "qa_visual → full final-master transcript audit → content-addressed Story Spine coverage sidecar",
    how:
      "The final-master quality stage binds broad visual review, the exact reviewed video hash, a complete timestamped " +
      "narration transcript, and the validated Story Spine. Every narrated beat is checked against the final master with " +
      "ordered timing; each beat needs at least 85% token and timing coverage, while the duration-weighted total needs 95%. " +
      "The detailed audit is retained as a content-addressed certificate sidecar and is rechecked before a retry can publish. " +
      "It proves narration-semantic story delivery only—not that every planned shot was visually realized.",
    gates: [
      "production visual score must meet the lane floor before certificate creation",
      "final-master narration transcript and timing must bind to the exact reviewed master",
      "every narrated beat needs ≥85% token and timing coverage; total duration-weighted coverage ≥95%",
      "coverage audit is content-addressed, retained with the certificate, and revalidated on retry",
      "narration-semantic coverage only — never a fabricated visual-shot realization claim",
    ],
    status: "reference",
  },
  {
    key: "whiteboard",
    stage: "visual",
    title: "Whiteboard — Drawn Cinema (synced scribe)",
    engine: "whiteboardSync — route-sealed non-Google storyboard + bounded attested Novita still scenes + Fish narration, Whisper-aligned and drawn in time with the voice.",
    how:
      "The automatic whiteboard route runs the shared bounded non-Google storyboard producer and critic before self_contained_story seals " +
      "its accepted board. whiteboardSync (block whiteboard_scribe) then renders each panel as a STACK OF LAYERS — composed line-art " +
      "SCENES (no baked text) plus marker-font LABELS — each carrying a verbatim narration CUE and a box. Fish TTS speaks the script; " +
      "local Whisper force-aligns it to word timestamps so every " +
      "cue becomes a millisecond. A deterministic renderer traces the real ink of each layer and reveals it under a moving hand " +
      "AT its cue, one layer at a time, paced to ink with a minimum draw time and a guaranteed HOLD before each panel cuts; a " +
      "persistent topic header + frame are drawn once, words letter in reading order, then ffmpeg muxes the narration. No video " +
      "model is used; bounded spend is attested Novita image work plus Fish TTS. Resolution remains route/renderer-configured (1080p / 2K).",
    gates: ["route-sealed critic-approved storyboard before renderer admission", "cue → ms via Whisper word-alignment (interpolated)", "per-layer pixels (no segmentation): nothing shown before its cue", "minimum draw time + guaranteed panel HOLD: nothing pops or cuts early", "number-integrity: labels grounded in the narration", "final-master visual/audio review before draft upload"],
    status: "active",
  },
  {
    key: "comic",
    stage: "visual",
    title: "Comic — Motion-Comic Page Engine",
    engine: "motionComic — route-sealed non-Google structured story → text-free attested panel art → ElevenLabs multi-voice → vision anchors/keep-clear regions → deterministic Python comic-page render.",
    how:
      "The automatic motion-comic route runs the shared bounded non-Google storyboard producer and critic before self_contained_story " +
      "seals the accepted plan. The engine (src/lib/motionComic.ts + scripts/mc_page_render.py) preserves closed, typed visual fields for " +
      "subject, object, environment, era, physical action and relations; dialogue and printable prop copy have no art-provider field. " +
      "Character sheets and panels render as text-free 4:3 images with model-sheet references. The page renderer center-crops those images " +
      "into varied comic tiles, reserves negative space, and keeps faces away from edges. ElevenLabs voices each line; a vision letterer " +
      "supplies mouth targets, preferred anchors and keep-clear regions. Deterministic pixel placement fails rather than accepting overlap, " +
      "then Python/Pillow animates the page, hand reveal, camera tour and page turns before FFmpeg muxes voices and the optional score.",
    gates: ["route-sealed critic-approved storyboard before renderer admission", "closed visual schema: no dialogue/printed-copy route to art provider", "4:3 text-free art with edge-safe composition for tile crops", "keep-clear overlap = 0 or render fails", "adaptive readable bubble fit near the vision anchor", "tail targets the vision-reported mouth", "final-master visual/audio review before draft upload"],
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
  {
    key: "channel-planner",
    stage: "plan",
    title: "Channel Planner",
    engine: "plan-week-ahead Trigger task → contentPlan board (topic + thumbnail + description) + scheduled native-publish",
    how:
      "Pre-builds the next N videos for a channel — each item's topic, thumbnail and description staged into the " +
      "contentPlan board with a generating → ready → used lifecycle. A pinned scheduledAt becomes the video's native " +
      "YouTube publish date, so scheduled-mode channels release on a fixed calendar. The autopilot scheduler consumes " +
      "the next READY item — its exact topic — instead of picking fresh each run. " +
      "P2-8 catalog-count reconciliation (2026-08): this is the 28th explicit GOLDEN_MODULES entry, and the one not covered by " +
      "the audit's 27-row stage table -- its stage \"plan\" falls outside GOLDEN_SPINE's 12 stages, so the per-spine-stage audit " +
      "methodology never reached it. Binding: kind \"external-task\", executableId \"plan-week-ahead\" (goldenExecution.ts). Now " +
      "accounted for.",
    gates: [
      "topic + thumbnail + description pre-built per slot",
      "scheduledAt = native publish date",
      "status lifecycle (generating → ready → used)",
      "scheduler consumes next ready item",
    ],
    status: "active",
  },
  {
    key: "shorts",
    stage: "visual",
    title: "Shorts (vertical)",
    engine: "9:16 short-form archetype (template D; families.ts visualEngine label \"shorts_cuts\" is a designer-internal switch, not a registered block) + long-form → Short repurposer (shorts_spinoff / documentary_short_candidates)",
    how:
      "A dedicated vertical archetype: a sub-50s shorts-style script, hook_craft, the originality + compliance gates, " +
      "then narration and 9:16 footage / entity imagery assembled at a frenetic ~4s cadence with word-level karaoke " +
      "captions and no chapter cards. A separate repurposer can cut the hook window of any long-form into a 9:16 Short " +
      "and upload it PRIVATE alongside (default OFF). The whole vertical surface — aspect, subject reframe, caption " +
      "emphasis — is one assembly preset. " +
      "CORRECTION (P1-16): \"shorts_cuts\" (families.ts:97) is only the family's internal visualEngine LABEL -- there is no block " +
      "or file by that name; the archetype's own assembly runs through the standard timeline_assemble path, configured by this " +
      "preset. Separately, goldenExecution.ts's CATALOG_EXECUTION_BINDINGS.shorts actually maps this catalog key's executableIds " +
      "to the planning-only repurposer (shorts_spinoff / documentary_short_candidates), NOT to the primary vertical archetype " +
      "described above -- two materially different capabilities share this one catalog key; see goldenExecution.ts's shorts " +
      "binding note for the split.",
    gates: [
      "9:16 throughout (footage + imagery + assembly)",
      "originality + compliance gated",
      "word-level karaoke captions",
      "PENDING golden: validated proof render + verified subject-reframe",
    ],
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
   * Optional per-niche thumbnail engine override. Production channel families
   * always use "banana" (Style DNA + executable playbook). Deterministic title
   * cards are a draft-only rendering tool, not a production preset.
   */
  thumbnailer?: "banana";
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
