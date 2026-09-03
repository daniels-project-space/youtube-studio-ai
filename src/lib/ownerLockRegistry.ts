/**
 * OWNER LOCK REGISTRY — what is lockable, and which files a lock protects.
 *
 * Deliberately free of `node:fs`, unlike `moduleLocks.ts`, so the browser can
 * import it. The lock badge needs the same view of a module that the guard
 * gets; letting the UI derive its own would allow the badge and the guard to
 * disagree about what is locked, which is the one failure a lock cannot afford.
 *
 * Nothing here says whether something IS locked. Every module is unlocked until
 * a row exists in Convex (`ownerModuleLocks`), so the default is unlocked by
 * construction rather than by a flag someone has to remember to set.
 */
import { GENERATED_LOCKABLE_MODULES } from "./goldenModuleFiles.generated";

export interface LockableEntity {
  id: string;
  label: string;
  kind: "module" | "channel";
  description: string;
  /**
   * Repo-relative files this lock protects.
   *
   * The guard treats each as a substring to match against an edited file path
   * and against any shell command that writes. Generated from each module's own
   * declarations — see scripts/generate-golden-module-files.ts — because a
   * hand-kept list goes stale on the first refactor and a stale lock reports
   * protection it no longer provides.
   */
  paths: readonly string[];
}

/** Every catalog module, plus the non-catalog areas worth freezing. */
export const LOCKABLE_MODULES: readonly LockableEntity[] = GENERATED_LOCKABLE_MODULES;

export const LOCKABLE_MODULE_IDS: ReadonlySet<string> = new Set(
  LOCKABLE_MODULES.map((entity) => entity.id),
);

export function lockableModule(id: string): LockableEntity | undefined {
  return LOCKABLE_MODULES.find((entity) => entity.id === id);
}

/**
 * How much a lock on this module actually covers.
 *
 * Surfaced in the UI on purpose. Some catalog entries are contracts with no
 * source of their own yet, and a lock badge that looked identical on those
 * would imply a protection the guard cannot deliver.
 */
export function lockCoverage(id: string): { files: number; enforced: boolean } {
  const files = lockableModule(id)?.paths.length ?? 0;
  return { files, enforced: files > 0 };
}
