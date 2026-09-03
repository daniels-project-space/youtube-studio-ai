/**
 * One-off: carry a pre-existing lock into Convex.
 *
 * The thumbnail module was locked before lock state moved off this disk. Without
 * this the first sync would find nothing locked in Convex, treat the marker as
 * stale, and unlock the module — a migration that silently undoes the thing it
 * is migrating.
 *
 * Goes through the one-way `seedLock` internal mutation, so this path can add a
 * lock and can never remove one.
 *
 *   npx tsx scripts/seed-owner-module-lock.ts thumbnail
 */
import { execFileSync } from "node:child_process";

import { OWNER_ID } from "@/lib/config";
import { lockableModule } from "@/lib/ownerLockRegistry";

function main(): void {
  const moduleKey = process.argv[2] ?? "thumbnail";
  if (!lockableModule(moduleKey)) throw new Error(`not a lockable module: ${moduleKey}`);

  execFileSync(
    "npx",
    ["convex", "run", "ownerModuleLocks:seedLock", JSON.stringify({ ownerId: OWNER_ID, moduleKey })],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  console.log(`seeded ${moduleKey} as locked`);
}

main();
