/**
 * Block metadata for the live pipeline view.
 *
 * The expected block list for a run is derived from its channel's `pipeline[]`.
 * When a channel has no pipeline configured we fall back to LOFI_BLOCK_IDS —
 * the canonical lofi block order (kept in sync with the LOFI_PIPELINE constant
 * in src/trigger/blocks/lofiBlocks.ts). We mirror just the id list here so the
 * client bundle never imports server/trigger code.
 */
export const LOFI_BLOCK_IDS: readonly string[] = [
  "competitor_research",
  "topic_select",
  "scene_planner",
  "keyframes",
  "loop_clips",
  "upscale",
  "music",
  "metadata",
  "assemble",
  "intro_card",
  "qa_light",
  "thumbnail_gen",
  "upload_draft",
  "notify",
];

/** Human labels for known block ids. Unknown ids fall back to a title-cased id. */
export const BLOCK_LABELS: Record<string, string> = {
  competitor_research: "Research",
  topic_select: "Topic Select",
  scene_planner: "Scene Planner",
  script_gen: "Script",
  hook_craft: "Hook",
  qa_script: "Script QA",
  narration_tts: "Narration",
  keyframes: "Keyframes",
  loop_clips: "Loop Clips",
  stock_footage: "Stock Footage",
  upscale: "Upscale",
  music: "Music",
  metadata: "Metadata",
  assemble: "Assemble",
  timeline_assemble: "Assemble (Timeline)",
  intro_card: "Intro Card",
  length_check: "Length Check",
  qa_light: "QA (Light)",
  qa_visual: "Visual QA",
  thumbnail_gen: "Thumbnail",
  upload_draft: "Upload Draft",
  notify: "Notify",
};

/** Title-case an unknown block id (snake_case → "Snake Case"). */
export function blockLabel(block: string): string {
  return (
    BLOCK_LABELS[block] ??
    block
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
