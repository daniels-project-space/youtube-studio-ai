/**
 * OWNER LOCK MARKERS — the workstation mirror the pre-edit guard reads.
 *
 * This file no longer decides anything. Convex holds the owner's intent
 * (`ownerModuleLocks`), because the studio UI runs on Vercel and cannot write a
 * disk; these marker files exist only so a shell hook can answer "is this file
 * locked?" without a network call on every tool invocation. The sync in
 * scripts/sync-owner-locks.ts is what keeps the two in step.
 *
 * The enforcement itself deliberately does NOT live here. The block happens in
 * a Claude Code PreToolUse hook outside the repository, because a guard that
 * lives inside the thing it guards can be edited by the same worker it is meant
 * to stop.
 *
 * The marker format follows the existing `pipeline-lock-guard` convention
 * already running on this machine — one file per locked entity — and extends it
 * by writing the protected path patterns INTO the marker, so the hook needs no
 * TypeScript to resolve a module to its files.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type LockableEntity, LOCKABLE_MODULES } from "./ownerLockRegistry";

// WHAT is lockable lives in ownerLockRegistry.ts, which imports no node
// built-ins so the browser can read the same registry the sync writes from.
export { LOCKABLE_MODULES };
export type { LockableEntity };

export const LOCK_DIR = join(process.cwd(), ".locks");

export interface LockRecord {
  id: string;
  label: string;
  kind: "module" | "channel";
  lockedAt: string;
  lockedBy: string;
  paths: readonly string[];
}

function markerPath(id: string): string {
  // Never let an id escape the lock directory.
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  return join(LOCK_DIR, `${safe}.lock`);
}

export async function listLocks(): Promise<LockRecord[]> {
  try {
    const files = await readdir(LOCK_DIR);
    const records: LockRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".lock")) continue;
      try {
        const raw = await readFile(join(LOCK_DIR, file), "utf8");
        // The marker is human-readable on purpose: an operator looking at the
        // directory over SSH should be able to see what is locked and why
        // without running anything.
        const json = raw.slice(raw.indexOf("{"));
        records.push(JSON.parse(json) as LockRecord);
      } catch { /* a malformed marker still means locked; skip metadata */ }
    }
    return records;
  } catch {
    return [];
  }
}

export async function isLocked(id: string): Promise<boolean> {
  return (await listLocks()).some((record) => record.id === id);
}

export async function lockEntity(args: {
  entity: LockableEntity;
  lockedBy: string;
}): Promise<LockRecord> {
  await mkdir(LOCK_DIR, { recursive: true });
  const record: LockRecord = {
    id: args.entity.id,
    label: args.entity.label,
    kind: args.entity.kind,
    lockedAt: new Date().toISOString(),
    lockedBy: args.lockedBy,
    paths: args.entity.paths,
  };
  // Patterns are written FIRST, one per line, so the shell hook can read them
  // with grep alone and never has to parse JSON or load this module.
  const body =
    `${args.entity.paths.join("\n")}\n` +
    `# ${args.entity.label} locked by ${args.lockedBy} at ${record.lockedAt}\n` +
    `${JSON.stringify(record)}\n`;
  await writeFile(markerPath(args.entity.id), body, "utf8");
  return record;
}

export async function unlockEntity(id: string): Promise<boolean> {
  try {
    await rm(markerPath(id));
    return true;
  } catch {
    return false;
  }
}
