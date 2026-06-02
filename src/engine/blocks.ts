/**
 * Central block registration. Importing this module registers every known
 * block exactly once into the engine registry. Both the Trigger task and the
 * local test harness import this so they share one source of truth.
 */
import { register, _clear } from "./registry";
import { echoSeed, echoSink } from "@/trigger/blocks/echoBlocks";
import { lofiBlocks } from "@/trigger/blocks/lofiBlocks";
import { intelligenceBlocks } from "@/trigger/blocks/intelligenceBlocks";
import { narratedBlocks } from "@/trigger/blocks/narratedBlocks";

let registered = false;

/** Idempotently register all blocks. Safe to call multiple times. */
export function registerAllBlocks(): void {
  if (registered) return;
  // Phase-1 smoke blocks.
  register(echoSeed);
  register(echoSink);
  // Phase-2 Template C (Lofi) blocks (metadata + thumbnail are provided by the
  // competitor-intelligence engine below, NOT by lofiBlocks).
  for (const b of lofiBlocks) register(b);
  // Competitor-intelligence engine: competitor_research, metadata (optimised),
  // thumbnail_gen (claude_flux).
  for (const b of intelligenceBlocks) register(b);
  // Narrated archetypes (essay/crime/shorts/meditation) — text "brain" (3a).
  for (const b of narratedBlocks) register(b);
  registered = true;
}

/** Test helper: clear + allow re-registration. */
export function _resetBlocks(): void {
  _clear();
  registered = false;
}
