/**
 * Central block registration. Importing this module registers every known
 * block exactly once into the engine registry. Both the Trigger task and the
 * local test harness import this so they share one source of truth.
 */
import { register, _clear } from "./registry";
import { echoSeed, echoSink } from "@/trigger/blocks/echoBlocks";
import { lofiBlocks } from "@/trigger/blocks/lofiBlocks";

let registered = false;

/** Idempotently register all blocks. Safe to call multiple times. */
export function registerAllBlocks(): void {
  if (registered) return;
  // Phase-1 smoke blocks.
  register(echoSeed);
  register(echoSink);
  // Phase-2 Template C (Lofi) blocks.
  for (const b of lofiBlocks) register(b);
  registered = true;
}

/** Test helper: clear + allow re-registration. */
export function _resetBlocks(): void {
  _clear();
  registered = false;
}
