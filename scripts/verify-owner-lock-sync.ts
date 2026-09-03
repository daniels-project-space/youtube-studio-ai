/**
 * Verifies the sync's removal path.
 *
 * A lock that cannot be released is as broken as one that never applies: the
 * owner unlocks in the UI, the row disappears from Convex, and the marker on
 * this machine has to go with it or the guard keeps refusing edits to a module
 * nobody has locked. Convex is the reference here, so a marker with no matching
 * row stands in for exactly that state.
 */
import { execFileSync } from "node:child_process";

import { lockableModule } from "@/lib/ownerLockRegistry";
import { lockEntity, listLocks } from "@/lib/moduleLocks";

const PROBE = "editorial-evidence-packet";

async function main(): Promise<void> {
  const entity = lockableModule(PROBE);
  if (!entity) throw new Error(`${PROBE} is not lockable`);

  await lockEntity({ entity, lockedBy: "sync-removal-test" });
  const before = (await listLocks()).map((record) => record.id).sort();
  console.log(`before sync: ${before.join(", ")}`);

  execFileSync("./node_modules/.bin/tsx", ["scripts/sync-owner-locks.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const after = (await listLocks()).map((record) => record.id).sort();
  console.log(`after sync:  ${after.join(", ")}`);

  const removed = !after.includes(PROBE);
  const keptReal = after.includes("thumbnail");
  console.log(`${removed ? "PASS" : "FAIL"}  marker with no Convex row was removed`);
  console.log(`${keptReal ? "PASS" : "FAIL"}  genuinely locked module was kept`);
  if (!removed || !keptReal) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
