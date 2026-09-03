/**
 * Mirrors the owner's module locks from Convex onto this workstation.
 *
 * The owner locks modules in the studio UI, which runs on Vercel and cannot
 * write to this disk. The pre-edit guard is a shell hook and must answer "is
 * this file locked?" on every tool call, so it cannot make a network request
 * either. This closes that gap: Convex holds the intent, marker files hold the
 * mirror, and this runs on a timer between them.
 *
 * It authenticates as SERVICE, not owner. `ownerModuleLocks.setLock` refuses a
 * service identity, so the sync can read the owner's decisions and can never
 * make one — a mirror that could also write would be a second way to unlock.
 *
 * Fails CLOSED. If Convex is unreachable the existing markers are left exactly
 * as they are and the run exits non-zero; a lock must not evaporate because a
 * network call timed out.
 */
import { execFileSync } from "node:child_process";

import { OWNER_ID } from "@/lib/config";
import { LOCKABLE_MODULES, lockableModule } from "@/lib/ownerLockRegistry";
import { lockEntity, listLocks, unlockEntity } from "@/lib/moduleLocks";

interface RemoteLock { moduleKey: string; lockedAt: number; lockedBy: string }

/**
 * Read through the Convex CLI rather than an HTTP client.
 *
 * The studio's token-signing key exists only in the Vercel environment, so this
 * machine cannot mint the identity a public studio query demands. The CLI
 * authenticates with the deployment credentials already present here and can
 * reach an internal function, which no browser can call.
 */
function readRemoteLocks(): RemoteLock[] {
  const out = execFileSync(
    "npx",
    ["convex", "run", "ownerModuleLocks:listForSync", JSON.stringify({ ownerId: OWNER_ID })],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`unexpected convex output: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start)) as RemoteLock[];
}

async function main(): Promise<void> {
  // Read first, and let a failure throw before anything on disk is touched.
  const remote = readRemoteLocks();

  const wanted = new Map(remote.map((row) => [row.moduleKey, row]));
  const present = new Set((await listLocks()).map((record) => record.id));

  let added = 0;
  let removed = 0;

  for (const [moduleKey, row] of wanted) {
    const entity = lockableModule(moduleKey);
    if (!entity) {
      // A lock for a module this checkout does not know about. Keep it noisy
      // rather than silently ignoring an instruction from the owner.
      console.warn(`[owner-locks] locked module not in this checkout: ${moduleKey}`);
      continue;
    }
    if (present.has(moduleKey)) continue;
    await lockEntity({ entity, lockedBy: `${row.lockedBy} (via studio UI)` });
    added += 1;
    console.log(`[owner-locks] locked ${moduleKey} (${entity.paths.length} files)`);
  }

  const lockableIds = new Set(LOCKABLE_MODULES.map((entity) => entity.id));
  for (const id of present) {
    if (wanted.has(id)) continue;
    // Only ever retire a marker this sync is responsible for. An unrelated
    // marker written by another tool is left alone.
    if (!lockableIds.has(id)) continue;
    await unlockEntity(id);
    removed += 1;
    console.log(`[owner-locks] unlocked ${id}`);
  }

  console.log(`[owner-locks] in sync · ${wanted.size} locked · +${added} -${removed}`);
}

main().catch((error) => {
  console.error(`[owner-locks] FAILED, markers left unchanged: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
