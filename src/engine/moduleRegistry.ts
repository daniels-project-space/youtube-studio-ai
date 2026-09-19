/**
 * MODULE_REGISTRY — the single catalog of base-module cards (pipeline block id →
 * self-describing card incl. its CustomizationSurface). ONE source of truth read by:
 *   - the onboarding + channel-settings UI  → render per-module toggles generically
 *   - resolveX (e.g. resolveAssembleParams)  → validate knob values
 *   - the future Pipeline Architect          → compose pipelines from capabilities
 * Register each base module here as it gets leveled up; the UI/Architect generalize for free.
 */
import type { CustomizationSurface } from "./customization";
import { ASSEMBLY_MODULE } from "@/lib/assembly/module";
import { CREW_MODULE } from "@/lib/crew/module";
import { EDITOR_MODULE } from "@/lib/crew/editor";
import { COMPOSER_MODULE } from "@/lib/crew/composer";
import { DIRECTOR_MODULE } from "@/lib/crew/director";
import { CRITIC_MODULE } from "@/lib/crew/critic";
import { CINEMATOGRAPHER_MODULE } from "@/lib/crew/cinematographerManifest";
import { CORE_MODULE_SURFACES } from "./moduleSurfaces";

/**
 * The bounded responsibility a module owns in an executable channel graph.
 *
 * This is deliberately capability metadata, not a second pipeline compiler:
 * the designer and executable manifests remain the authority for ordering,
 * providers, cost, and release admission. It gives the UI and a future
 * Pipeline Architect an honest way to explain why a fixed module is present
 * without pretending every block is an operator-tunable control.
 */
export type ModuleRole =
  | "research"
  | "planning"
  | "creative_direction"
  | "script"
  | "voice"
  | "visual"
  | "render"
  | "audio"
  | "assembly"
  | "package"
  | "thumbnail"
  | "review"
  | "safety"
  | "delivery"
  | "operations";

export interface ModuleCard {
  /** Module key (e.g. "assemble"). */
  key: string;
  title: string;
  stage: string;
  does?: string;
  /** Omitted only by source cards before they are registered below. */
  role?: ModuleRole;
  /** Per-account knobs / presets / capabilities the UI + Architect configure from. */
  customization?: CustomizationSurface;
}

/** A card in the authoritative registry always declares its responsibility. */
export interface RegisteredModuleCard extends ModuleCard {
  role: ModuleRole;
}

export type ModuleConfigurationScope = "runtime" | "new_channel";

function surfaceForScope(
  blockId: string,
  surface: CustomizationSurface,
  scope: ModuleConfigurationScope,
): CustomizationSurface {
  if (scope !== "new_channel" || blockId !== "narration_tts") return surface;
  return {
    ...surface,
    knobs: surface.knobs.map((knob) => knob.id === "ttsProvider"
      ? { ...knob, values: knob.values?.filter((value) => value !== "qwen3") }
      : knob),
  };
}

function fixedModule(
  key: string,
  title: string,
  role: ModuleRole,
  does: string,
): RegisteredModuleCard {
  return { key, title, stage: role.replaceAll("_", " "), role, does };
}

function registeredModule(card: ModuleCard, role: ModuleRole): RegisteredModuleCard {
  return { ...card, role };
}

/**
 * Non-configurable blocks remain first-class pipeline modules. They used to
 * vanish from this registry merely because they expose no UI knobs, which made
 * the "single registry" neither a real topology map nor a safe basis for
 * composing a new channel. Keep this list browser-safe: it describes existing
 * executable blocks but never imports their Trigger/provider implementations.
 */
export const FIXED_EXECUTION_MODULES: readonly RegisteredModuleCard[] = [
  fixedModule("captions", "Captions", "package", "Builds delivery captions from the timed narration."),
  fixedModule("casefile_evidence_shot_map", "Casefile evidence shot map", "planning", "Maps reviewed claims to source-bound shots."),
  fixedModule("casefile_source_packet", "Casefile source packet", "research", "Seals reviewed source evidence before a factual case can proceed."),
  fixedModule("chess_episode_graph", "Chess episode graph", "planning", "Locks the legal board-state sequence for a chess replay."),
  fixedModule("chess_narration_timing", "Chess narration timing", "review", "Measures chess narration against the replay timeline."),
  fixedModule("chess_replay_source", "Chess replay source", "research", "Validates the source game and its replay provenance."),
  fixedModule("chess_script", "Chess script", "script", "Builds the source-bound chess narration."),
  fixedModule("chess_script_integrity", "Chess script integrity", "safety", "Rejects a chess script that diverges from the legal game record."),
  fixedModule("child_content_safety", "Children's safety review", "safety", "Reviews a completed children lesson plan for private human review; it cannot edit or publish it."),
  fixedModule("children_show_bible", "Children's show bible", "planning", "Validates the reviewed series identity and participation pattern against an approved lesson; it does not choose curriculum or render."),
  fixedModule("children_video_treatment", "Children's video treatment", "creative_direction", "Sends the approved identity, learning action, and motion rules to visual and thumbnail modules; it does not render, review safety, or publish."),
  fixedModule("cinematic_case_sequence", "Cinematic case sequence", "planning", "Builds evidence-led cinematic coverage for a private-review case."),
  fixedModule("cinematic_case_sequence_draft", "Cinematic case draft", "planning", "Prepares the first evidence-led case sequence draft."),
  fixedModule("cinematic_case_sequence_finalize", "Cinematic case finalize", "review", "Finalizes a reviewed evidence-led case sequence."),
  fixedModule("cleanup", "Retention cleanup", "operations", "Expires temporary artifacts after the retention contract."),
  fixedModule("competitor_research", "Competitor research", "research", "Collects the bounded market evidence used for packaging and topic decisions."),
  fixedModule("compliance_check", "Compliance check", "safety", "Blocks policy or route violations before rendering."),
  fixedModule("crosspost", "Crosspost", "delivery", "Creates permitted secondary-platform delivery work after the master is approved."),
  fixedModule("curriculum_episode_seed", "Curriculum episode seed", "planning", "Admits one reviewed lesson intent; it does not script, render, or publish the episode."),
  fixedModule("documentary_short_candidates", "Documentary short candidates", "planning", "Selects source-bound vertical documentary candidates."),
  fixedModule("documentary_source_plan", "Documentary source plan", "research", "Seals official sources, claims, and beat evidence for a documentary short."),
  fixedModule("documotion_short", "DocuMotion short", "render", "Renders the source-bound vertical documentary master."),
  fixedModule("editorial_evidence_packet", "Editorial evidence packet", "research", "Packages factual claims, locators, and review evidence for editorial use."),
  fixedModule("emit_bundle", "Language bundle", "delivery", "Stores approved shared assets and fans them out to language siblings."),
  fixedModule("entity_imagery", "Entity imagery", "visual", "Resolves rights-safe named-entity imagery for the planned story."),
  fixedModule("episode_graph", "Episode graph", "planning", "Locks causal beats, continuity, sources, and the scene manifest."),
  fixedModule("gen_footage", "Generated footage", "render", "Generates route-compatible visual footage from the locked plan."),
  fixedModule("hook_craft", "Hook craft", "script", "Strengthens the opening promise before the script is rendered."),
  fixedModule("keyframes", "Keyframes", "visual", "Plans the exact visual anchors for a looping or cinematic render."),
  fixedModule("learning_contract", "Learning contract", "planning", "Locks the learning objective, demonstrations, and retrieval-practice checks."),
  fixedModule("motion_comic", "Motion comic", "render", "Renders the self-contained drawn-comic story engine."),
  fixedModule("music_program_plan", "Original music program", "planning", "Seals the instrumental and looping-visual direction before generation."),
  fixedModule("music_arrangement_plan", "Accepted music arrangement", "planning", "Seals the opt-in composer's authored arrangement for evaluation; does not generate audio or activate a production route."),
  fixedModule("narrative_series_visual_controls", "Series visual controls", "planning", "Carries approved serialized continuity controls into the visual plan."),
  fixedModule("notify", "Run notification", "operations", "Records the safe operator notification after a run changes state."),
  fixedModule("novita_render_images", "Novita image render", "render", "Renders attested keyframe images for the cinematic lane."),
  fixedModule("novita_render_video", "MiniMax H3 video render", "render", "Renders the attested H3 video sequence from approved keyframes."),
  fixedModule("originality_gate", "Originality gate", "safety", "Rejects an episode that does not meet the route's originality contract."),
  fixedModule("package_to_opening_plan", "Package-to-opening plan", "package", "Binds the thumbnail and opening promise to the approved package."),
  fixedModule("qa_assets", "Asset QA", "review", "Checks generated assets against the locked visual plan."),
  fixedModule("qa_script", "Script QA", "review", "Checks claims, pacing, and route-specific script requirements."),
  fixedModule("qa_shots", "Shot QA", "review", "Checks cinematic shots before postproduction assembly."),
  fixedModule("qa_visual", "Final visual QA", "review", "Independently reviews the final master before delivery."),
  fixedModule("quiz_critic_spec", "Quiz critic spec", "review", "Defines the deterministic factual checks for a QuizYear episode."),
  fixedModule("quiz_metadata", "Quiz metadata", "package", "Creates the title, description, and thumbnail brief for QuizYear."),
  fixedModule("quiz_short_release", "Quiz short release", "delivery", "Hands a reviewed QuizShort to its supervised release boundary."),
  fixedModule("quiz_topic_plan", "Quiz topic plan", "planning", "Selects the next curated QuizYear topic."),
  fixedModule("quiz_topic_safety", "Quiz topic safety", "safety", "Checks a quiz topic against its curated safety contract."),
  fixedModule("scenario_visual_treatment", "Scenario visual treatment", "planning", "Sets the disclosed fictional scenario's visual grammar."),
  fixedModule("scene_compiler", "Scene compiler", "render", "Builds the deterministic illustrated master from the scene manifest."),
  fixedModule("self_contained_story", "Self-contained story", "planning", "Seals the native storyboard consumed by a self-contained renderer."),
  fixedModule("self_contained_story_plan", "Self-contained story plan", "planning", "Builds the bounded story plan before the native storyboard."),
  fixedModule("serialized_program_episode_context", "Serialized episode context", "planning", "Carries the sealed program episode context into shared production modules."),
  fixedModule("short_scene_qa", "Short scene QA", "review", "Checks vertical framing, safe areas, and source provenance."),
  fixedModule("short_strategy", "Short strategy", "planning", "Sets the route-owned structure for a vertical short."),
  fixedModule("shorts_spinoff", "Shorts spinoff", "delivery", "Creates an approved short-form derivative after the master is complete."),
  fixedModule("signature_clips", "Signature clips", "visual", "Resolves channel-owned signature visual clips for reuse."),
  fixedModule("source_bound_story_spine", "Source-bound story spine", "planning", "Builds a timed story spine constrained by reviewed claims and sources."),
  fixedModule("story_spine", "Story spine", "planning", "Turns the approved script into timed causal beats and coverage needs."),
  fixedModule("studio_asset_resolve", "Studio asset resolve", "operations", "Finds channel-approved reusable visual recipes before rendering."),
  fixedModule("studio_ltx_adapter_resolve", "Legacy adapter resolve", "operations", "Resolves a retained adapter receipt for historical replay only."),
  fixedModule("studio_postproduction_asset_resolve", "Postproduction asset resolve", "operations", "Finds reusable postproduction assets within the channel policy."),
  fixedModule("studio_reusable_media_resolve", "Reusable media resolve", "operations", "Selects policy-approved reusable media for the current episode."),
  fixedModule("thumbnail_gen", "Nano Banana thumbnail", "thumbnail", "Generates the final, receipt-bound thumbnail from the approved package."),
  fixedModule("visual_matter_references", "Visual matter references", "visual", "Produces byte-bound visual-development references for review."),
];

const CORE_MODULE_ROLES: Readonly<Record<string, ModuleRole>> = {
  timeline_assemble: "assembly",
  "show-bible": "creative_direction",
  editor_brief: "creative_direction",
  composer_brief: "creative_direction",
  director_brief: "creative_direction",
  critic_spec: "creative_direction",
  dp_brief: "creative_direction",
  topic_select: "planning",
  metadata: "package",
  lore_short: "render",
  quiz_year: "render",
  script_gen: "script",
  narration_tts: "voice",
  stock_footage: "visual",
  music: "audio",
  intro_card: "visual",
  visual_inserts: "visual",
  quote_overlays: "visual",
  whiteboard_scribe: "render",
  length_check: "review",
  scene_planner: "planning",
  loop_clips: "render",
  upscale: "render",
  assemble: "assembly",
  visual_matter: "visual",
  synthetic_scenario: "planning",
  scenario_disclosure_gate: "safety",
  upload_draft: "delivery",
};

const CONFIGURABLE_MODULES: readonly Readonly<{ blockId: string; card: ModuleCard }>[] = [
  // Assembly's reusable surface is named "assemble", while narrated graphs
  // execute it as `timeline_assemble`. The block id, rather than the source
  // card's display key, is the durable configuration and lock identity.
  { blockId: "timeline_assemble", card: ASSEMBLY_MODULE },
  { blockId: "show-bible", card: CREW_MODULE },
  { blockId: "editor_brief", card: EDITOR_MODULE },
  { blockId: "composer_brief", card: COMPOSER_MODULE },
  { blockId: "director_brief", card: DIRECTOR_MODULE },
  { blockId: "critic_spec", card: CRITIC_MODULE },
  { blockId: "dp_brief", card: CINEMATOGRAPHER_MODULE },
  ...CORE_MODULE_SURFACES.map((card) => ({ blockId: card.key, card })),
];

const REGISTERED_CONFIGURABLE_MODULES = Object.fromEntries(
  CONFIGURABLE_MODULES.map(({ blockId, card }) => {
    const role = CORE_MODULE_ROLES[blockId];
    if (!role) throw new Error(`module registry card '${blockId}' has no declared role`);
    return [blockId, registeredModule({ ...card, key: blockId }, role)];
  }),
);

/** Pipeline BLOCK ID (as it appears in a channel's pipeline[]) → its complete card. */
export const MODULE_REGISTRY: Record<string, RegisteredModuleCard> = {
  ...Object.fromEntries(FIXED_EXECUTION_MODULES.map((card) => [card.key, card])),
  ...REGISTERED_CONFIGURABLE_MODULES,
};

export function moduleCard(blockId: string): RegisteredModuleCard | undefined {
  return MODULE_REGISTRY[blockId];
}

export function moduleSurface(
  blockId: string,
  scope: ModuleConfigurationScope = "runtime",
): CustomizationSurface | undefined {
  const surface = MODULE_REGISTRY[blockId]?.customization;
  return surface ? surfaceForScope(blockId, surface, scope) : undefined;
}

/** Every registered module that exposes a customization surface (what the UI renders toggles for). */
export function configurableModules(
  activeBlockIds?: readonly string[],
  scope: ModuleConfigurationScope = "runtime",
): { blockId: string; card: ModuleCard; surface: CustomizationSurface }[] {
  const active = activeBlockIds ? new Set(activeBlockIds) : undefined;
  return Object.entries(MODULE_REGISTRY)
    .filter(([blockId, card]) => card.customization && (!active || active.has(blockId)))
    .map(([blockId, card]) => ({
      blockId,
      card,
      surface: surfaceForScope(blockId, card.customization as CustomizationSurface, scope),
    }));
}
