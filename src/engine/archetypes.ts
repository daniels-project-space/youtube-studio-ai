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

const LOFI: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 5 } },
  { block: "keyframes", params: { aspectRatio: "16:9", resolution: "2k", visualStyle: "lofi" } },
  { block: "loop_clips", params: { clipDurationSec: 5, visualStyle: "lofi" } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "music", params: { provider: "mureka" } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 90 } },
  { block: "intro_card", params: { introMode: "overlay" } },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
];

// Narrated base (Stage-3 blocks). Footage-driven; metadata + qa precede
// thumbnail/upload (which consume title + qaPassed). Crime adds a hook.
const NARRATED: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "script_gen" },
  { block: "qa_script" },
  { block: "narration_tts" },
  { block: "stock_footage" },
  { block: "entity_imagery" },
  { block: "timeline_assemble" },
  { block: "intro_card", params: { introMode: "overlay" } },
  { block: "length_check" },
  { block: "metadata" },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
];

export const ARCHETYPES: Record<string, Archetype> = {
  "lofi-ambient": {
    key: "lofi-ambient",
    label: "Lofi / ambient",
    description:
      "Looping AI-generated visuals under generated music. No narration. (Fully implemented.)",
    template: "C",
    thumbnailTemplate: "title_card",
    pipeline: LOFI,
  },
  "narrated-essay": {
    key: "narrated-essay",
    label: "Narrated essay",
    description:
      "Researched script → narration → footage + b-roll, narration-synced cuts.",
    template: "A",
    defaultVoiceId: "sleepless_historian",
    thumbnailTemplate: "claude_flux",
    pipeline: NARRATED,
  },
  "crime-narrative": {
    key: "crime-narrative",
    label: "Crime / mystery narrative",
    description:
      "Hook-forward narrated story with tension pacing and footage cuts.",
    template: "B",
    defaultVoiceId: "psychological",
    thumbnailTemplate: "claude_flux",
    pipeline: [
      { block: "competitor_research" },
      { block: "topic_select" },
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
    thumbnailTemplate: "claude_flux",
    pipeline: [
      { block: "topic_select" },
      { block: "script_gen", params: { style: "shorts", maxSeconds: 50 } },
      { block: "hook_craft" },
      { block: "narration_tts" },
      { block: "stock_footage", params: { aspect: "9:16" } },
      { block: "entity_imagery", params: { aspect: "9:16" } },
      { block: "timeline_assemble", params: { aspect: "9:16", captions: true } },
      { block: "length_check", params: { maxSeconds: 60 } },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
    ],
  },
  meditation: {
    key: "meditation",
    label: "Meditation / sleep",
    description: "Long calm narration over slow ambient visuals + music.",
    template: "E",
    defaultVoiceId: "psychological",
    thumbnailTemplate: "claude_flux",
    pipeline: [
      { block: "topic_select" },
      { block: "script_gen", params: { style: "meditation" } },
      { block: "narration_tts", params: { pace: "slow" } },
      { block: "stock_footage" },
      { block: "entity_imagery" },
      { block: "timeline_assemble" },
      { block: "length_check" },
      { block: "metadata" },
      { block: "thumbnail_gen" },
      { block: "qa_visual" },
      { block: "upload_draft" },
      { block: "notify" },
    ],
  },
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

export function getArchetype(key: string): Archetype {
  return ARCHETYPES[key] ?? ARCHETYPES["lofi-ambient"];
}
