/**
 * Central block registration. Importing this module registers every known
 * block exactly once into the engine registry. Both the Trigger task and the
 * local test harness import this so they share one source of truth.
 */
import { register, _clear } from "./registry";
import { lofiBlocks } from "@/trigger/blocks/lofiBlocks";
import { intelligenceBlocks } from "@/trigger/blocks/intelligenceBlocks";
import { narratedBlocks } from "@/trigger/blocks/narratedBlocks";
import { complianceBlocks } from "@/trigger/blocks/complianceBlocks";
import { growthBlocks } from "@/trigger/blocks/growthBlocks";
import { CREW_BLOCKS } from "@/trigger/blocks/crewBlocks";
import { insertBlocks } from "@/trigger/blocks/insertBlocks";
import { emitBundle } from "@/trigger/blocks/bundleBlocks";

let registered = false;

/** Idempotently register all blocks. Safe to call multiple times. */
export function registerAllBlocks(): void {
  if (registered) return;
  // Template C (Lofi) blocks. metadata + thumbnail_gen come from the
  // competitor-intelligence engine below, NOT from lofiBlocks.
  for (const b of lofiBlocks) register(b);
  // Competitor-intelligence engine: competitor_research, metadata (optimised),
  // thumbnail_gen (claude_flux).
  for (const b of intelligenceBlocks) register(b);
  // Narrated archetypes (essay/crime/shorts/meditation) — text "brain" (3a).
  for (const b of narratedBlocks) register(b);
  // Compliance gates (Phase 4): originality_gate + compliance_check.
  for (const b of complianceBlocks) register(b);
  // Growth blocks (Phase 8, opt-in): crosspost.
  for (const b of growthBlocks) register(b);
  // Film-crew brief blocks (creative-direction layer): director_brief, dp_brief,
  // editor_brief, composer_brief, critic_spec.
  for (const b of CREW_BLOCKS) register(b);
  // Script-synced motion-graphics inserts (visual_inserts): Remotion data viz
  // planned from the numbers the narration actually speaks.
  for (const b of insertBlocks) register(b);
  // Render-group reuse: emit_bundle (persist assets + fan out to language siblings).
  register(emitBundle);
  registered = true;
}

/** Test helper: clear + allow re-registration. */
export function _resetBlocks(): void {
  _clear();
  registered = false;
}
