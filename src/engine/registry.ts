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
const versions = new Map<string, Map<string, ModuleManifest>>();

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

/** Install an explicitly selected version without changing default discovery. */
export function registerManifestVersion(manifest: ModuleManifest): void {
  const defaultManifest = registry.get(manifest.id);
  if (!defaultManifest) {
    throw new Error(`cannot register version without default block: ${manifest.id}`);
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`manifest ${manifest.id} requires a non-empty string version`);
  }
  if (defaultManifest.version === manifest.version || versions.get(manifest.id)?.has(manifest.version)) {
    throw new Error(`block version already registered: ${manifest.id}@${manifest.version}`);
  }
  assertExecutableManifest(manifest);
  const installed = versions.get(manifest.id) ?? new Map<string, ModuleManifest>();
  installed.set(manifest.version, manifest);
  versions.set(manifest.id, installed);
}

/** Get the default block, or an exact installed version without fallback. */
export function get(id: string, version?: string): Block | undefined {
  return getManifest(id, version)?.block;
}

/** Get the default executable contract, or an exact installed version. */
export function getManifest(id: string, version?: string): ModuleManifest | undefined {
  const defaultManifest = registry.get(id);
  if (version === undefined) return defaultManifest;
  if (typeof version !== "string" || !version.trim()) return undefined;
  if (defaultManifest?.version === version) return defaultManifest;
  return versions.get(id)?.get(version);
}

/** Get a block by id, throwing loud if missing. */
export function require_(id: string, version?: string): Block {
  const manifest = getManifest(id, version);
  if (!manifest) throw new Error(`unknown block: ${id}${version === undefined ? "" : ` version "${version}"`}`);
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
  versions.clear();
}
