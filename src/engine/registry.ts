/**
 * Block registry — maps block id -> implementation (MASTER-PLAN §D).
 *
 * A channel's `pipeline` is an ordered list of `{block, params}` whose ids are
 * resolved against this registry at validate/run time.
 */
import type { Block } from "./types";
import {
  assertExecutableManifest,
  manifestFromBlock,
  type ModuleManifest,
} from "./moduleManifest";
import { MODULE_CONTRACTS } from "./moduleContracts";

const registry = new Map<string, ModuleManifest>();

/** Register a block. Throws on duplicate id (loud — no silent overwrite). */
export function register(block: Block): void {
  if (registry.has(block.id)) {
    throw new Error(`block already registered: ${block.id}`);
  }
  const manifest = manifestFromBlock(block, MODULE_CONTRACTS[block.id]);
  assertExecutableManifest(manifest);
  registry.set(block.id, manifest);
}

/** Register a native executable manifest (used by non-legacy/new modules). */
export function registerManifest(manifest: ModuleManifest): void {
  if (registry.has(manifest.id)) {
    throw new Error(`block already registered: ${manifest.id}`);
  }
  assertExecutableManifest(manifest);
  registry.set(manifest.id, manifest);
}

/** Get a block by id, or undefined if not registered. */
export function get(id: string): Block | undefined {
  return registry.get(id)?.block;
}

/** Get the executable contract that owns a block id. */
export function getManifest(id: string): ModuleManifest | undefined {
  return registry.get(id);
}

/** Get a block by id, throwing loud if missing. */
export function require_(id: string): Block {
  const manifest = registry.get(id);
  if (!manifest) throw new Error(`unknown block: ${id}`);
  return manifest.block;
}

/** All registered blocks (snapshot). */
export function all(): Block[] {
  return Array.from(registry.values(), (manifest) => manifest.block);
}

/** All executable manifests (snapshot). */
export function allManifests(): ModuleManifest[] {
  return Array.from(registry.values());
}

/** Test/reset helper — clears the registry. */
export function _clear(): void {
  registry.clear();
}
