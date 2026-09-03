/**
 * Verifies the owner-lock surface after the registry split.
 *
 * Two claims are worth checking mechanically. First, that moving the registry
 * into a browser-safe module did not change what is protected on disk — a
 * refactor that silently emptied a marker would leave a lock that looks locked
 * in the UI and stops nothing. Second, that a channel lock actually refuses a
 * shell write naming that channel, because a channel is not a file and it would
 * be easy to ship a badge that toggles a marker no guard ever reads.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LOCK_DIR, channelLockEntity, listLocks, lockEntity, unlockEntity } from "@/lib/moduleLocks";
import { LOCKABLE_MODULES } from "@/lib/ownerLockRegistry";

const GUARD = "/root/.claude/hooks/owner-lock-guard.sh";

function guard(payload: unknown): number {
  const run = spawnSync("bash", [GUARD], { input: JSON.stringify(payload), encoding: "utf8" });
  return run.status ?? -1;
}

function report(label: string, actual: unknown, expected: unknown): boolean {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${String(actual)}`);
  return ok;
}

async function main(): Promise<void> {
  let ok = true;
  const locks = await listLocks();
  const thumbnail = locks.find((lock) => lock.id === "thumbnail");
  const declared = LOCKABLE_MODULES.find((entity) => entity.id === "thumbnail");

  ok = report("thumbnail still locked after refactor", Boolean(thumbnail), true) && ok;
  ok = report(
    "marker still lists every declared path",
    thumbnail?.paths.length,
    declared?.paths.length,
  ) && ok;

  const marker = await readFile(join(LOCK_DIR, "thumbnail.lock"), "utf8");
  ok = report(
    "guard-readable pattern lines intact",
    marker.split("\n").filter((line) => line.startsWith("src/lib/")).length,
    declared?.paths.length,
  ) && ok;

  // A channel lock has to bite, or the badge is decoration.
  const channel = channelLockEntity("Vault Breach");
  await lockEntity({ entity: channel, lockedBy: "verification" });
  try {
    ok = report(
      "locked channel refuses a shell write naming it",
      guard({ tool_name: "Bash", tool_input: { command: 'echo x > seed/vault-breach.json' } }),
      2,
    ) && ok;
    ok = report(
      "locked channel still allows reading it",
      guard({ tool_name: "Bash", tool_input: { command: "grep -rn 'Vault Breach' src" } }),
      0,
    ) && ok;
    ok = report(
      "an unlocked channel is untouched",
      guard({ tool_name: "Bash", tool_input: { command: "echo x > seed/some-other-channel.json" } }),
      0,
    ) && ok;
  } finally {
    await unlockEntity(channel.id);
  }

  ok = report("verification channel lock removed", (await listLocks()).some((l) => l.id === channel.id), false) && ok;
  console.log(ok ? "\nOWNER LOCK VERIFICATION PASS" : "\nOWNER LOCK VERIFICATION FAIL");
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
