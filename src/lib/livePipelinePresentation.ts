/**
 * Browser-safe presentation model for a persisted production run. It does not
 * infer execution: every count comes from a recorded run stage, while planned
 * blocks without a receipt remain waiting.
 */
export type LivePipelinePhase =
  | "foundation"
  | "narrative"
  | "visual"
  | "assembly"
  | "release";

export type LivePipelinePhaseState = "complete" | "active" | "blocked" | "waiting";

export type LivePipelineStageSnapshot = {
  status?: string;
  cost?: number;
};

export type LivePipelineNodeSnapshot = {
  block: string;
  stage?: LivePipelineStageSnapshot;
};

export type LivePipelinePhaseSummary = {
  phase: LivePipelinePhase;
  label: string;
  state: LivePipelinePhaseState;
  total: number;
  verified: number;
  running: number;
  blocked: number;
  waiting: number;
};

export const LIVE_PIPELINE_PHASE_LABEL: Record<LivePipelinePhase, string> = {
  foundation: "Foundation",
  narrative: "Story",
  visual: "Visual production",
  assembly: "Assembly",
  release: "Audience & release",
};

const VISUAL_BLOCKS = new Set([
  "scene_planner",
  "keyframes",
  "loop_clips",
  "upscale",
  "stock_footage",
  "entity_imagery",
  "gen_footage",
  "signature_clips",
  "studio_asset_resolve",
  "studio_reusable_media_resolve",
  "visual_matter",
  "visual_matter_references",
  "novita_render_images",
  "studio_ltx_adapter_resolve",
  "novita_render_video",
  "scene_compiler",
  "whiteboard_scribe",
  "motion_comic",
  "lore_short",
  "quiz_year",
  "documotion_short",
  "shorts_spinoff",
  "documentary_short_candidates",
]);

const ASSEMBLY_BLOCKS = new Set([
  "studio_postproduction_asset_resolve",
  "timeline_assemble",
  "assemble",
  "captions",
  "quote_overlays",
  "intro_card",
  "visual_inserts",
  "length_check",
]);

const RELEASE_BLOCKS = new Set([
  "package_to_opening_plan",
  "metadata",
  "quiz_metadata",
  "thumbnail_gen",
  "qa_assets",
  "qa_shots",
  "short_scene_qa",
  "qa_visual",
  "child_content_safety",
  "quiz_short_release",
  "upload_draft",
  "emit_bundle",
  "crosspost",
  "notify",
  "cleanup",
]);

const NARRATIVE_BLOCKS = new Set([
  "director_brief",
  "dp_brief",
  "editor_brief",
  "composer_brief",
  "critic_spec",
  "curriculum_episode_seed",
  "script_gen",
  "hook_craft",
  "qa_script",
  "originality_gate",
  "compliance_check",
  "narration_tts",
  "story_spine",
  "episode_graph",
  "source_bound_story_spine",
  "narrative_series_visual_controls",
  "self_contained_story_plan",
  "self_contained_story",
  "music_program_plan",
  "music",
  "composer_brief",
  "editorial_evidence_packet",
  "casefile_source_packet",
  "casefile_evidence_shot_map",
  "synthetic_scenario",
  "scenario_visual_treatment",
  "cinematic_case_sequence_draft",
  "cinematic_case_sequence_finalize",
  "cinematic_case_sequence",
]);

export function livePipelinePhaseForBlock(block: string): LivePipelinePhase {
  if (RELEASE_BLOCKS.has(block)) return "release";
  if (ASSEMBLY_BLOCKS.has(block)) return "assembly";
  if (VISUAL_BLOCKS.has(block)) return "visual";
  if (NARRATIVE_BLOCKS.has(block)) return "narrative";
  return "foundation";
}

function stateForPhase(summary: Omit<LivePipelinePhaseSummary, "state">): LivePipelinePhaseState {
  if (summary.blocked > 0) return "blocked";
  if (summary.running > 0) return "active";
  if (summary.verified === summary.total) return "complete";
  return "waiting";
}

/** Summarise real stage receipts by the human-scale production journey. */
export function summarizeLivePipelinePhases(
  nodes: LivePipelineNodeSnapshot[],
): LivePipelinePhaseSummary[] {
  const summary = new Map<LivePipelinePhase, Omit<LivePipelinePhaseSummary, "state">>();

  for (const node of nodes) {
    const phase = livePipelinePhaseForBlock(node.block);
    const current = summary.get(phase) ?? {
      phase,
      label: LIVE_PIPELINE_PHASE_LABEL[phase],
      total: 0,
      verified: 0,
      running: 0,
      blocked: 0,
      waiting: 0,
    };
    current.total += 1;
    const status = node.stage?.status;
    if (status === "ok" || status === "skipped") current.verified += 1;
    else if (status === "running") current.running += 1;
    else if (status === "failed" || status === "canceled" || status === "factual_review_blocked") current.blocked += 1;
    else current.waiting += 1;
    summary.set(phase, current);
  }

  return (Object.keys(LIVE_PIPELINE_PHASE_LABEL) as LivePipelinePhase[])
    .map((phase) => summary.get(phase))
    .filter((item): item is Omit<LivePipelinePhaseSummary, "state"> => item !== undefined)
    .map((item) => ({ ...item, state: stateForPhase(item) }));
}

export function describeLivePipelinePhase(summary: LivePipelinePhaseSummary): string {
  if (summary.state === "complete") {
    return `${summary.label}: ${summary.verified} of ${summary.total} stages verified`;
  }
  if (summary.state === "active") {
    return `${summary.label}: ${summary.running} stage${summary.running === 1 ? "" : "s"} running, ${summary.verified} verified`;
  }
  if (summary.state === "blocked") {
    return `${summary.label}: ${summary.blocked} stage${summary.blocked === 1 ? "" : "s"} needs attention`;
  }
  return `${summary.label}: waiting for ${summary.waiting} planned stage${summary.waiting === 1 ? "" : "s"}`;
}
