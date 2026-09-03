/**
 * One-off: apply the owner's first lock.
 *
 * Locking is normally an owner action in the UI. This exists only to set the
 * initial state; the guard does not gate it because the write happens inside
 * Node rather than in a shell command, and the guard inspects tool calls.
 */
import { LOCKABLE_MODULES, lockEntity, listLocks } from "@/lib/moduleLocks";

async function main(): Promise<void> {
  const entity = LOCKABLE_MODULES.find((candidate) => candidate.id === "thumbnail");
  if (!entity) throw new Error("thumbnail module is not registered as lockable");
  await lockEntity({ entity, lockedBy: "owner (initial lock)" });
  for (const record of await listLocks()) {
    console.log(`LOCKED  ${record.label}  (${record.id})  ${record.paths.length} paths  ${record.lockedAt}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
