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
    key: "loreshort",
    stage: "visual",
    title: "Lore Short — Loreshort Engine",
    engine:
      "Loreshort — Gemini first-person lore script + Nano Banana art + ElevenLabs per-line TTS + image-to-video camera moves (Seedance-1-lite / LTX) + 4K Real-ESRGAN — two cost/quality lanes",
    how:
      "A single figure narrates history in FIRST PERSON (GoT \"Histories & Lore\" style): one Gemini-Pro call writes a paced " +
      "narration arc plus per-beat layered-depth SCENE prompts; Nano Banana paints each beat; ElevenLabs voices each line " +
      "separately so every shot is cut to its exact spoken length. A vision pass reads each painting and writes a motion brief " +
      "(subject + particles + a DEPTH camera move, scaled to honest intensity), which drives image-to-video into a GENUINE 3D " +
      "shot — real perspective and parallax, never a 2D pan. Two lanes: BUDGET (LTX-distilled + free ffmpeg 2K, ~$0.4/video) " +
      "and PREMIUM (Seedance-1-lite 480p → Real-ESRGAN 4K, ~$1.35/video, far richer figures). A title card plays before the " +
      "narration; ffmpeg fits each shot to its beat, dissolves, titles and grades. Self-describing (LORESHORT_MODULE contract), " +
      "fail-proof (data-URI inputs, no nginx dependency, retries, no cross-engine fallback), fully resumable. src/lib/loreshort.ts.",
    gates: [
      "required inputs validated (topic / narrator / title / kicker / slug)",
      "de-branded visuals (content-policy safe)",
      "intensity-aware motion — depth camera leads, never forced",
      "title card BEFORE narration",
      "no cross-engine fallback — retry same engine or fail loud",
      "genuine-3D camera move (not a 2D pan)",
    ],
    status: "golden",
  },
  {
    key: "novita-render-farm",
    stage: "visual",
    title: "Novita Render Farm",
    engine:
      "Novita 8×4090 spot-pod render farm — static modulo sharding, per-shot camera/director/script control, individual pod autoclose + spot-reclaim requeue, R2-backed idempotent resume (image + image-to-video)",
    how:
      "An editable shot list (script line, camera move, shot scale, lens, seconds, motion cue) is submitted straight into the " +
      "orchestrator's job schema — no translation layer. The image phase renders every shot's still on however many 4090 pods " +
      "are sharded (nshard, capped at 3 by the Novita account); each pod pushes its stills plus a `.done` marker to R2 and " +
      "self-deletes on completion. The video phase pipelines off the SAME R2 stills into image-to-video camera moves once they " +
      "land, converting seconds to the nearest valid 8n+1 frame count. A monitor loop verifies every pod's autoclose, " +
      "force-deletes stragglers, and RELAUNCHES any shard whose pod vanished to a spot reclaim — workers skip outputs already " +
      "in R2, so a requeue never double-renders. Output is drop-in producer-compatible with gen_footage (same footageClips / " +
      "footageKeys contract), so timeline_assemble works unmodified. Self-describing (NOVITA_RENDER_FARM_MODULE contract). " +
      "src/lib/novitaRenderFarm.ts; the render itself runs VPS-side (/root/ltx-build/novita/orchestrator.py), reached over " +
      "HTTP by the module, never spawned in Vercel/Trigger.",
    gates: [
      "video frames always 8n+1 — rounded, never truncated silently",
      "every shot needs a motion cue — cameraMove !== 'static' or a non-empty motion field",
      "width/height must be a multiple of 32 (VAE tiling requirement)",
      "shard count capped at 3 (Novita account pod limit) — validate() fails loud above it",
      "no cross-engine fallback — a failed shard retries the same pod pattern, then fails loud",
      "R2-backed idempotent resume — a spot-reclaim requeue never double-renders",
    ],
    status: "active",
  },
  {
    key: "imagecraft-novita",
    stage: "visual",
    title: "Imagecraft (Novita Z-Image)",
    engine:
      "Imagecraft — Z-Image base bf16 stills at 2048×1152 / 40 steps on Novita RTX 4090 spot pods (NAS-staged weights, slot-aware 3-pod queue, verified autoclose, R2-idempotent resume) via the live VPS render bridge",
    how:
      "A director shot list (per-shot prompt/lens/shotScale/seed + global style/negative/director/steps/cfg/width/height) is POSTed to the live nginx bridge and polled to done; inline sharpness/exposure QA re-renders weak stills pod-side. Self-describing (IMAGECRAFT_NOVITA_MODULE contract). src/lib/imagecraft-novita.ts.",
    gates: [
      "inline sharpness + exposure QA on every still — weak frames re-render pod-side, never ship",
      "width/height must be a multiple of 32 (VAE tiling requirement) — validate() fails loud",
      "shard count capped at 3 (Novita account pod limit) — no silent clamp",
      "no cross-engine fallback — a failed shard retries the same Z-Image pod pattern, then fails loud",
      "R2-idempotent resume — a requeue never double-renders",
      "per-pod verified autoclose — stragglers force-deleted, no ghost billing",
    ],
    status: "golden",
  },
  {
    key: "videocraft-novita",
    stage: "visual",
    title: "Videocraft (Novita LTX-2.3)",
    engine:
      "Videocraft — LTX-2.3 22B int8 image-to-video via Wan2GP at 1920×1088 / 40 steps / guidance 4.0 on Novita RTX 4090 spot pods, driving the 10-move camera grammar over Imagecraft's R2 stills (slot-aware 3-pod queue, verified autoclose, R2-idempotent resume)",
    how:
      "Each shot's rendered still + camera move + motion cue + seconds (rounded to 8n+1 frames) is POSTed to the live nginx bridge and polled to done; a freeze-detection QA gate rejects still-frame clips (the frozen-frame fix). Emits gen_footage-compatible footageClips/footageKeys, so timeline_assemble works unmodified. Self-describing (VIDEOCRAFT_NOVITA_MODULE contract). src/lib/videocraft-novita.ts.",
    gates: [
      "freeze-detection QA (the still-frame fix) — a clip that doesn't move is rejected and re-rendered, never shipped",
      "video frames always 8n+1 — rounded, never truncated silently",
      "every shot needs a stillKey + motion cue (cameraMove !== 'static' or a non-empty motion field) — validate() fails loud",
      "shard count capped at 3 (Novita account pod limit) — no silent clamp",
      "no cross-engine fallback — a failed shard retries the same LTX pod pattern, then fails loud",
      "R2-idempotent resume — a spot-reclaim requeue never double-renders",
    ],
    status: "golden",
  },
  {
    key: "lofi",
    stage: "visual",
    title: "Lofi Loop — Seaside Engine",
    engine:
      "Lofi — Nano Banana Pro still + Gemini-Vision grounded motion prompt + Kling v3 Omni pro 2×15s seamless loop + temporal de-warble + optional Topaz 4K — a coherent Ghibli sunny-seaside world",
    how:
      "A single Nano Banana Pro painting (gemini-3-pro-image-preview — the standard still engine because it " +
      "obeys negative rules like no-rain-inside; Flux is opt-in) from a coherent Ghibli seaside catalogue (beach cafe, seaside room, sunset " +
      "pier, hillside meadow) is brought to life as an HOURS-loopable lofi video. Each scene declares ranked " +
      "animation priorities + forbidden motion + spatial rules, and a Gemini-Vision pass writes the motion " +
      "prompt grounded in the actual painting, so clouds, water, foliage, a calm dark-haired host and her cat " +
      "all move while the distance stays still. The SEAMLESS loop is the 2×15s method: clip A animates freely, " +
      "clip B animates BACK to the origin frame, so the 30s unit's last frame == first frame and a plain " +
      "stream_loop has an invisible seam — never a crossfade or boomerang. The camera is locked twice over: a " +
      "hard tripod-lock clause on every Kling prompt (wind moves the subjects, never the viewpoint) AND a " +
      "motion-aware temporal de-warble that strips AI shimmer from the loop unit (seam preserved). No upscale " +
      "is baked in — Topaz 4K is a separate optional pass on the short loop unit. A deblur title intro + lofi " +
      "music finish it. Self-describing (LOFI_MODULE contract), fully resumable. src/lib/lofi.ts.",
    gates: [
      "required inputs validated (scene / channel / title / music / slug)",
      "motion ensured — ranked priorities + forbidden + spatial, ≥5 element types",
      "seamless 2×15s loop — last frame == first frame (no crossfade, no boomerang)",
      "static camera locked in-prompt (wind moves subjects, not the viewpoint)",
      "temporal de-warble removes AI camera shimmer (seam preserved)",
      "no baked-in upscale — native res; Topaz 4K is a separate optional pass",
    ],
    status: "golden",
  },
  {
    key: "quiz",
    stage: "visual",
    title: "Quiz — Quizcraft (standalone multi-type quiz engine)",
    engine:
      "Quizcraft — a standalone quiz-channel engine: trivia / flag-guess / music-guess → a deterministic dataset-backed answer → an isolated Remotion composition (depleting timer, answer reveal + image/poster), cloud-rendered",
    how:
      "One engine, three capabilities, all copyright-safe. TRIVIA asks a common-knowledge question, counts down a " +
      "depleting timer, then reveals the answer card plus a vision-verified image. FLAG-GUESS draws from 195 CC0 flags " +
      "on an EASY→IMPOSSIBLE ramp with a deterministic country reveal — a dataset can't hallucinate the answer. " +
      "MUSIC-GUESS plays a film's public-domain theme behind a countdown ring, then shows the poster + title. Every " +
      "question is answered from a dataset (never a model guess), deduped by key, and laid out by a per-capability " +
      "timing + layout pass. Renders through an ISOLATED Remotion bundle so a quiz render can't be broken by sibling " +
      "compositions. The proofs below are real first-try renders.",
    gates: [
      "deterministic dataset answer (never model-guessed)",
      "dedupe by question key",
      "per-capability timing + layout",
      "isolated Remotion bundle",
    ],
    status: "golden",
  },
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
      "approves the hero before any Soul. Standalone src/lib/cinecraft.ts, visual-only (a pipeline adds audio + assembly).",
    gates: ["hero-image identity anchor (not the soul)", "vision consistency gate \u2265 8 (re-roll on drift)", "per-kind lock: same person / place / object", "operator-approved hero before Soul"],
    status: "golden",
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
    status: "golden",
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
      "timed to each narration cue and per-clip failures stay isolated. Standalone src/lib/motioncraft.ts, visual-only.",
    gates: ["the LLM earns each graphic (3-6 / video, never per line)", "best-tool routing per beat", "verbatim numbers only (stats)", "no text baked into the hero image — the title is a crisp overlay", "per-clip failure isolated"],
    status: "golden",
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
      "letterboxed CinematicSpeech variant. Proof: the Steve Jobs 2005 Stanford commencement, motivation-edited.",
    gates: [
      "caption highlight synced to word-level timings",
      "segment channel bug matches plan boundaries",
      "deterministic from a typed plan (no per-frame LLM)",
      "cues clamped to their [start,end] window",
    ],
    status: "golden",
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
      "'essay' preset reproduces the legacy renderer EXACTLY (parity). One model serves narrated AND lofi. Standalone " +
      "+ unit-tested (6 suites) with a real ffmpeg smoke render proving the body/compose/caption path; the module " +
      "guides the Architect/Director (src/lib/assembly, registered in MODULE_REGISTRY).",
    gates: [
      "validate-before-spend (length band · coverage · overlay windows)",
      "content-addressed idempotency (no double-render)",
      "heal from a declared checkpoint (no regex)",
      "no silent skips (dropped overlays → typed warnings)",
      "'essay' preset == legacy renderer (parity)",
    ],
    status: "golden",
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
    key: "whiteboard",
    stage: "visual",
    title: "Whiteboard — Drawn Cinema (synced scribe)",
    engine: "whiteboardSync — narration-synced deterministic write-on: Gemini layered storyboard + 2K Nano-Banana scenes + Fish narration, Whisper-aligned, drawn by a real hand in time with the voice. ZERO render credits.",
    how:
      "The whiteboard family's self-contained visual engine (src/lib/whiteboardSync.ts, block whiteboard_scribe). Gemini-Pro " +
      "designs each panel as a STACK OF LAYERS — composed line-art SCENES (no baked text) + marker-font LABELS — each carrying " +
      "a verbatim narration CUE and a box. Fish TTS speaks the script; local Whisper force-aligns it to word timestamps so every " +
      "cue becomes a millisecond. A deterministic renderer traces the real ink of each layer and reveals it under a moving hand " +
      "AT its cue, one layer at a time, paced to ink with a minimum draw time and a guaranteed HOLD before each panel cuts; a " +
      "persistent topic header + frame are drawn once, words letter in reading order, then ffmpeg muxes the narration. No video " +
      "model = $0 render credits; spend is the 2K Banana art + Fish TTS. Resolution-configurable (1080p / 2K).",
    gates: ["storyboard retry until full beat coverage", "cue → ms via Whisper word-alignment (interpolated)", "per-layer pixels (no segmentation): nothing shown before its cue", "minimum draw time + guaranteed panel HOLD: nothing pops or cuts early", "number-integrity: labels grounded in the narration"],
    status: "golden",
  },
  {
    key: "comic",
    stage: "visual",
    title: "Comic — Motion-Comic 3D Engine",
    engine: "motionComic — a narrated comic that DRAWS ITSELF OUT IN 3D: Gemini story → Nano-Banana character-consistent panels at each tile's aspect → ElevenLabs multi-voice → vision letterer → Three.js comic-page render. ZERO render credits.",
    how:
      "A standalone engine (src/lib/motionComic.ts + the mc3d render path). Gemini-Pro writes a tight story; each panel renders " +
      "image-to-image from per-character MODEL SHEETS at the EXACT aspect ratio of the page tile it will occupy — so heads are " +
      "never cropped — composed with reserved caption space. ElevenLabs voices every line; a vision letterer derives each " +
      "speaker's mouth from a TIGHT face box (never a guessed point on a held gun or hand). A Three.js scene then tours an open " +
      "comic page with a real 3D camera — top-down establish, zoom into each empty panel, the HAND draws it in (the scribe " +
      "pixel-reveal ported to a GPU order-map shader), speech bubbles pop on cue, the page TURNS to a fresh sheet — rendered " +
      "headless and muxed with the voices + a Suno score. Bubbles are placed by HARD face-exclusion + adaptive sizing with an " +
      "elegant slim tail that stops at the face edge. No video model = $0 render credits.",
    gates: ["per-panel geometric check: bubble face_overlap = 0 (faces are a hard constraint)", "adaptive bubble sizing until it fits a face-free gap (clear_fit)", "elegant tail stops at the face edge — never crosses the face", "panels generated at the exact tile aspect — no cropped heads", "vision letterer scores clear / tail / proximity / legibility per bubble", "character consistency via model-sheet image-to-image"],
    status: "golden",
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
      "the next READY item — its exact topic — instead of picking fresh each run.",
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
    engine: "9:16 short-form archetype (template D) + shorts_cuts assembly + long-form → Short repurposer",
    how:
      "A dedicated vertical archetype: a sub-50s shorts-style script, hook_craft, the originality + compliance gates, " +
      "then narration and 9:16 footage / entity imagery assembled at a frenetic ~4s cadence with word-level karaoke " +
      "captions and no chapter cards. A separate repurposer can cut the hook window of any long-form into a 9:16 Short " +
      "and upload it PRIVATE alongside (default OFF). The whole vertical surface — aspect, subject reframe, caption " +
      "emphasis — is one assembly preset.",
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
