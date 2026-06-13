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
    status: "golden",
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
    gates: ["hook lint (≤7s, no filler, concrete)", "punch / specificity / curiosity / voiceMatch / promise-by-15s ≥ 7", "grounded fact-check (search-verified claims, false = rejected)", "loop payoff verified by qa_script", "midpoint re-hook verified"],
    status: "golden",
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
    status: "golden",
  },
  {
    key: "visuals",
    stage: "visual",
    title: "Visuals",
    engine: "Family-swapped: FEDERATED stock (Pexels + Pixabay + Coverr + Videvo, 4K-first) / entity imagery / flux keyframes / boomerang loops",
    how:
      "The family delta picks the visual engine per channel: federated stock + entity imagery for narrated " +
      "essays, generated keyframes + image-to-video for cinematic families, seamless boomerang loops + " +
      "Topaz upscale for lofi. Stock now fans out across every configured provider in parallel and pulls the " +
      "highest-resolution file each offers (up to UHD) so the 1080p canvas downscales crisply and Ken-Burns " +
      "push-ins stay sharp. A multi-frame relevance gate samples start / middle / end of each candidate and " +
      "rejects the clip if ANY frame drifts off-theme or shows a watermark, logo or burned-in caption. Style " +
      "DNA grounds every query and prompt; a cross-video ledger keeps footage unique between uploads.",
    gates: ["multi-frame relevance + watermark gate (>=7)", "per-artifact qa_visual", "coverage contract vs cut sheet", "cross-video dedup"],
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
    status: "golden",
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
