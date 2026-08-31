/**
 * Channel archetypes = named preset pipelines (block-list + default params) the
 * package builder copies onto a new channel. Pure data (no block imports) so it
 * is safe to import from both the builder task and the UI.
 *
 * Only `lofi-ambient` has all its blocks registered today; the narrated set
 * references Stage-3 blocks (script_gen / narration_tts / stock_footage /
 * timeline_assemble / qa_visual / hook_craft). A channel built on an un-ported
 * archetype is created as a DRAFT (validatePipeline rejects unknown blocks) and
 * becomes runnable when Stage 3 registers those blocks — no rework needed.
 */
import type { PipelineEntry } from "@/engine/types";

export interface Archetype {
  key: string;
  label: string;
  description: string;
  /** A|B|C|D|E archetype letter persisted on the channel. */
  template: string;
  /** Default voice id (Fish Audio) for narrated archetypes. */
  defaultVoiceId?: string;
  thumbnailTemplate: string;
  pipeline: PipelineEntry[];
}

// Lofi (Template C) — 100% CLOUD engine (fal.ai stills + i2v, no local CLI):
// scene → fal flux-pro still → fal i2v clip → seamless crossfade loop → Topaz
// upscale of the loop unit → Suno music → deblur-title assemble (stream_loop the
// unit under looped music). No narration, no separate intro card (the deblur
// title IS the intro). durationSec is the only knob to scale length.
const LOFI: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "music_program_plan" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 5 } },
  // Generate and seal the episode music before the visual loop. The current
  // distilled LTX loop does not condition on it, but the ordering gives the
  // future open-weight audio-to-video benchmark the exact mastered source
  // without re-generating audio or creating a hidden dependency.
  { block: "music", params: { provider: "suno" } },
  { block: "keyframes", params: { aspectRatio: "16:9", visualStyle: "lofi" } },
  // 10s i2v clip + 1.2s crossfade self-loop → the seam blends real moving frames
  // (not a near-frozen pop), which is the difference between a "real" seamless
  // lofi loop and an obvious AI one.
  { block: "loop_clips", params: { clipDurationSec: 10, visualStyle: "lofi", crossfadeSec: 2.5 } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 180, deblurIntro: true } }, // 3-min test; raise for production
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" }, // keep only the finished video + thumbnail; drop all intermediates
];

// Narrated base (Stage-3 blocks). Footage-driven; metadata + qa precede
// thumbnail/upload (which consume title + qaPassed). Crime adds a hook.
// intro_card (Remotion title card) + music run before timeline_assemble, which
// prepends the card over a music-only intro and beds the music low under the
// narration (see src/lib/ffmpeg.ts composeWithIntro).
const NARRATED: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select", params: { policy: "no_repeat" } },
  { block: "script_gen", params: { maxSeconds: 1800 } }, // ~30 min (long-form)
  { block: "qa_script" },
  { block: "originality_gate" },
  { block: "compliance_check" },
  // chapterCards: "Chapter N:" read on a card that gently fades in/out, with a 3s
  // pause before and after the heading. Sentence pauses lengthened (~1.35s).
  { block: "narration_tts", params: { sentenceGapSec: 1.35, sentenceGapJitter: 0.25, chapterCards: true, chapterPreSec: 3, chapterPostSec: 3 } },
  // Footage is TOPIC/DNA-matched by default. The serene-nature lock is a per-
  // niche/per-channel choice (NICHE_PRESETS.footageTheme or the wizard) — it was
  // a stoic-channel default that silently leaked onto every narrated channel and
  // made the relevance gate reject on-brand city/office/desk footage.
  { block: "stock_footage" },
  { block: "entity_imagery" },
  {
    block: "music",
    params: {
      provider: "mureka",
      prompt:
        "very calm, gentle ambient underscore — soft sustained strings and sparse, slow piano, warm and " +
        "contemplative, minimal and unobtrusive, low dynamics, no percussion, no drums, no build-ups, no vocals",
    },
  },
  { block: "intro_card", params: { introSec: 5 } },
  { block: "quote_overlays", params: { maxQuotes: 3, minQuoteWords: 6 } },
  // 15s held outro card; music fades over the full 15s, video stays on the card.
  { block: "timeline_assemble", params: { tailSec: 15, fadeOutSec: 2, audioFadeOutSec: 15, burnCaptions: true } },
  { block: "length_check", params: { minSeconds: 900, maxSeconds: 2100 } }, // 15-35 min
  { block: "captions" },
  { block: "metadata" },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" }, // keep only the finished video + thumbnail; drop all intermediates
];

// Deterministic scene-compiler base. It intentionally keeps the established
// text, narration, music, metadata, quality and upload rails, but replaces
// stock/generative footage and the legacy timeline assembler with a single
// locally-rendered scene grammar. `episode_graph` turns the timed Story Spine
// into causal, sourced scene nodes; `scene_compiler` is the only pixel producer.
const ILLUSTRATED_EXPLAINER: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select", params: { policy: "no_repeat" } },
  { block: "script_gen", params: { style: "illustrated_explainer", maxSeconds: 300 } },
  { block: "qa_script" },
  { block: "originality_gate" },
  { block: "compliance_check" },
  { block: "narration_tts", params: { sentenceGapSec: 0.8, sentenceGapJitter: 0.15 } },
  { block: "story_spine", params: { targetShotSec: 6 } },
  { block: "episode_graph" },
  {
    block: "music",
    params: {
      provider: "mureka",
      prompt: "original light instrumental underscore, clear and unobtrusive, no vocals, no sudden impacts",
    },
  },
  { block: "scene_compiler", params: { aspect: "16:9" } },
  { block: "length_check", params: { minSeconds: 60, maxSeconds: 900 } },
  { block: "captions" },
  { block: "metadata" },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" },
];

// A deliberately separate product lane. The renderer is shared with the
// illustrated explainer, but the contract requires a declared age band,
// original canon, one learning objective, child-safety evidence, and human
// editorial approval. The upload block independently refuses public/scheduled
// release for this family.
const CHILDREN_LEARNING: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select", params: { policy: "no_repeat", targetSeconds: 180 } },
  // A fresh, child-editor-signed intent constrains every later story/graph
  // artifact. It is an invocation seed, never a channel-level auto-create key.
  { block: "curriculum_episode_seed" },
  { block: "script_gen", params: { style: "children_learning", maxSeconds: 180 } },
  { block: "qa_script" },
  { block: "originality_gate" },
  { block: "compliance_check" },
  { block: "narration_tts", params: { sentenceGapSec: 0.9, sentenceGapJitter: 0.1 } },
  { block: "story_spine", params: { targetShotSec: 6 } },
  { block: "episode_graph", params: { audience: "children" } },
  { block: "learning_contract" },
  // This is an operator-supplied, fingerprint-bound child-editor admission.
  // It is a per-episode seed, never an automatic channel-creation shortcut.
  { block: "children_show_bible" },
  { block: "child_content_safety" },
  {
    block: "music",
    params: {
      provider: "mureka",
      prompt: "original gentle playful instrumental underscore, no lyrics, no sudden impacts, narration-first mix",
    },
  },
  { block: "scene_compiler", params: { aspect: "16:9", audience: "children" } },
  { block: "length_check", params: { minSeconds: 60, maxSeconds: 360 } },
  { block: "captions" },
  { block: "metadata" },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft", params: { publishMode: "draft", madeForKids: true } },
  { block: "notify" },
  { block: "cleanup" },
];

export const ARCHETYPES: Record<string, Archetype> = {
  "lofi-ambient": {
    key: "lofi-ambient",
    label: "Lofi / ambient",
    description:
      "Looping AI-generated visuals under generated music. No narration. (Fully implemented.)",
    template: "C",
    thumbnailTemplate: "banana",
    pipeline: LOFI,
  },
  "narrated-essay": {
    key: "narrated-essay",
    label: "Narrated essay",
    description:
      "Researched script → narration → footage + b-roll, narration-synced cuts.",
    template: "A",
    defaultVoiceId: "sleepless_historian",
    thumbnailTemplate: "banana",
    pipeline: NARRATED,
  },
  "illustrated-explainer": {
    key: "illustrated-explainer",
    label: "Illustrated causal explainer",
    description:
      "Timed story spine → Episode Graph → deterministic maps, diagrams, panels and original vector characters; no image/video generation provider.",
    template: "A",
    defaultVoiceId: "narrator_teacher",
    thumbnailTemplate: "banana",
    pipeline: ILLUSTRATED_EXPLAINER,
  },
  "children-learning": {
    key: "children-learning",
    label: "Original supervised children’s learning show",
    description:
      "Age-banded original learning story rendered through a deterministic scene grammar; private draft only pending child-content editorial approval.",
    template: "A",
    defaultVoiceId: "gentle_guide",
    thumbnailTemplate: "banana",
    pipeline: CHILDREN_LEARNING,
  },
  "crime-narrative": {
    key: "crime-narrative",
    label: "Crime / mystery narrative",
    description:
      "Hook-forward narrated story with tension pacing and footage cuts.",
    template: "B",
    defaultVoiceId: "psychological",
    thumbnailTemplate: "banana",
    pipeline: [
      { block: "competitor_research" },
      { block: "topic_select", params: { policy: "no_repeat" } },
      { block: "script_gen", params: { style: "crime" } },
      { block: "hook_craft" },
      ...NARRATED.slice(4),
    ],
  },
  shorts: {
    key: "shorts",
    label: "Shorts (vertical)",
    description: "Short hook-driven vertical video with fast cuts + captions.",
    template: "D",
    defaultVoiceId: "sleepless_historian",
    thumbnailTemplate: "banana",
    pipeline: [
      { block: "topic_select" },
      { block: "script_gen", params: { style: "shorts", maxSeconds: 50 } },
      { block: "hook_craft" },
      { block: "originality_gate" },
      { block: "compliance_check" },
      { block: "narration_tts" },
      { block: "stock_footage", params: { aspect: "9:16" } },
      { block: "entity_imagery", params: { aspect: "9:16" } },
      {
        block: "music",
        params: {
          provider: "mureka",
          prompt: "energetic minimal underscore, light beat, no vocals",
        },
      },
      { block: "intro_card", params: { introSec: 2, aspect: "9:16" } },
      { block: "timeline_assemble", params: { aspect: "9:16", captions: true, tailSec: 1 } },
      { block: "length_check", params: { maxSeconds: 60 } },
      { block: "captions" },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
      { block: "cleanup" },
    ],
  },
  "documentary-collage-short": {
    key: "documentary-collage-short",
    label: "Documentary collage Short",
    description:
      "Source-backed, native 9:16 documentary collage built from locked narration beats and portrait scene QA.",
    template: "D",
    defaultVoiceId: "sleepless_historian",
    thumbnailTemplate: "banana",
    pipeline: [
      { block: "competitor_research" },
      { block: "topic_select", params: { targetSeconds: 52 } },
      { block: "script_gen", params: { style: "documentary_short", maxSeconds: 52, endWithSummary: true } },
      { block: "hook_craft" },
      { block: "qa_script" },
      { block: "originality_gate" },
      { block: "compliance_check" },
      { block: "short_strategy", params: { format: "direct", targetSeconds: 52 } },
      { block: "documotion_short", params: { styleId: "archival_collage", targetSeconds: 52 } },
      { block: "short_scene_qa" },
      { block: "length_check", params: { minSeconds: 20, maxSeconds: 60 } },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
      { block: "cleanup" },
    ],
  },
  "lore-short": {
    key: "lore-short",
    label: "Lore micro-documentary",
    description:
      "First-person 'Histories & Lore' micro-doc: one narrator over painted concept art with genuine 3D depth camera moves, cut to the voice.",
    template: "A",
    defaultVoiceId: "sleepless_historian",
    thumbnailTemplate: "banana",
    // SELF-CONTAINED: `lore_short` writes the beat sheet, paints it, animates
    // it and cuts it to its own narration, so there is deliberately no
    // script_gen / narration_tts / footage / timeline_assemble chain here.
    // compliance_check gates the TOPIC before the paid engine runs;
    // originality_gate judges the narration the engine wrote, so it sits after.
    pipeline: [
      { block: "competitor_research" },
      { block: "topic_select", params: { targetSeconds: 54 } },
      { block: "compliance_check" },
      { block: "lore_short", params: { subStyle: "cinematic", targetSeconds: 54 } },
      { block: "originality_gate" },
      { block: "length_check", params: { minSeconds: 25, maxSeconds: 150 } },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
      { block: "cleanup" },
    ],
  },
  "quiz-year": {
    key: "quiz-year",
    label: "Guess the year quiz",
    description:
      "Multiple-choice 'guess the year': a CC0 Wikidata fact, four year options, a depleting timer, then the correct option locks in.",
    template: "A",
    thumbnailTemplate: "banana",
    // SELF-CONTAINED: `quiz_year` sources its own facts, writes its own
    // questions and renders the finished video, so there is deliberately no
    // script_gen / narration_tts / footage / timeline_assemble chain here.
    //
    // topic_select IS kept, with a clear division of responsibility: it frames
    // the EPISODE (the title, the thumbnail promise, the crew brief — all of
    // which consume `topic`), while the ROUNDS are chosen by quiz_year from
    // Wikidata by notability. An LLM never picks a fact and never picks a year.
    //
    // originality_gate is omitted: the questions are deliberately templated
    // around third-party facts, which is what this format IS rather than a
    // plagiarism signal. compliance_check still gates before the engine runs.
    pipeline: [
      { block: "competitor_research" },
      { block: "topic_select", params: { targetSeconds: 80 } },
      { block: "compliance_check" },
      // No `categories` param → the block uses the full default mix, so a
      // channel created from this archetype gets a genuinely mixed trivia video
      // (years, capitals, currencies, symbols, general knowledge) rather than
      // eight rounds of the same question type. `topic` still steers only the
      // guess-the-year share of the mix.
      { block: "quiz_year", params: { topic: "science_discovery", targetSeconds: 80 } },
      { block: "length_check", params: { minSeconds: 25, maxSeconds: 400 } },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
      { block: "cleanup" },
    ],
  },
  meditation: {
    key: "meditation",
    label: "Meditation / sleep",
    description: "Long calm narration over slow ambient visuals + music.",
    template: "E",
    defaultVoiceId: "psychological",
    thumbnailTemplate: "banana",
    pipeline: [
      { block: "topic_select" },
      { block: "script_gen", params: { style: "meditation" } },
      { block: "originality_gate" },
      { block: "compliance_check" },
      { block: "narration_tts", params: { pace: "slow" } },
      { block: "stock_footage" },
      { block: "entity_imagery" },
      {
        block: "music",
        params: {
          provider: "mureka",
          prompt:
            "very calm ambient sleep music, soft pads, slow, peaceful, no drums, no vocals",
        },
      },
      { block: "intro_card", params: { introSec: 6 } },
      { block: "timeline_assemble", params: { tailSec: 4, fadeOutSec: 3 } },
      { block: "length_check" },
      { block: "captions" },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
      { block: "cleanup" },
    ],
  },
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

export function getArchetype(key: string): Archetype {
  return ARCHETYPES[key] ?? ARCHETYPES["lofi-ambient"];
}
