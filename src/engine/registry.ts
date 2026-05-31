/**
 * Block registry — maps block id -> implementation (MASTER-PLAN §D).
 *
 * A channel's `pipeline` is an ordered list of `{block, params}` whose ids are
 * resolved against this registry at validate/run time.
 */
import type { Block } from "./types";

const registry = new Map<string, Block>();

/** Register a block. Throws on duplicate id (loud — no silent overwrite). */
export function register(block: Block): void {
  if (registry.has(block.id)) {
    throw new Error(`block already registered: ${block.id}`);
  }
  registry.set(block.id, block);
}

/** Get a block by id, or undefined if not registered. */
export function get(id: string): Block | undefined {
  return registry.get(id);
}

/** Get a block by id, throwing loud if missing. */
export function require_(id: string): Block {
  const block = registry.get(id);
  if (!block) throw new Error(`unknown block: ${id}`);
  return block;
}

/** All registered blocks (snapshot). */
export function all(): Block[] {
  return Array.from(registry.values());
}

/** Test/reset helper — clears the registry. */
export function _clear(): void {
  registry.clear();
}
