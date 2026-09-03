/**
 * Verifies the owner-lock chain end to end on this workstation.
 *
 * The chain has three links and a break in any one is silent: Convex holds the
 * owner's intent, the sync mirrors it to marker files, and the pre-edit guard
 * reads those markers. A lock that looks set in the UI while the guard allows
 * the edit is the exact failure this exists to catch.
 *
 * Channel locks are NOT checked here — they are enforced inside Convex by
 * channels.lockChannel and the mutations that respect it, so they never reach
 * this machine.
 */
import { spawnSync } from "node:child_process";

import { LOCKABLE_MODULES, lockableModule } from "@/lib/ownerLockRegistry";
import { listLocks, lockEntity, unlockEntity } from "@/lib/moduleLocks";

const GUARD = "/root/.claude/hooks/owner-lock-guard.sh";
const REPO = "/home/ubuntu/youtube-studio-ai";

function guard(payload: unknown): number {
  return spawnSync("bash", [GUARD], { input: JSON.stringify(payload), encoding: "utf8" }).status ?? -1;
}

function report(label: string, actual: unknown, expected: unknown): boolean {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(54)} ${String(actual)}`);
  return ok;
}

async function main(): Promise<void> {
  let ok = true;

  const withFiles = LOCKABLE_MODULES.filter((entity) => entity.paths.length > 0);
  ok = report("every module is registered as lockable", LOCKABLE_MODULES.length > 40, true) && ok;
  ok = report("most modules resolve to real files", withFiles.length > 40, true) && ok;

  // The thumbnail module is the one with a hand-worked blast radius; if the
  // generator ever narrows it, the lock silently stops covering its gates.
  const thumbnail = lockableModule("thumbnail");
  ok = report("thumbnail lock still spans its gates", (thumbnail?.paths.length ?? 0) >= 23, true) && ok;

  // A module is only locked while a marker exists — never by default.
  const marker = "editorial-evidence-packet";
  const entity = lockableModule(marker);
  if (!entity || entity.paths.length === 0) throw new Error(`${marker} has no files to test with`);
  const target = `${REPO}/${entity.paths[0]}`;

  ok = report(
    "unlocked module is editable by default",
    guard({ tool_name: "Edit", tool_input: { file_path: target } }),
    0,
  ) && ok;

  await lockEntity({ entity, lockedBy: "verification" });
  try {
    ok = report(
      "locked module refuses an edit",
      guard({ tool_name: "Edit", tool_input: { file_path: target } }),
      2,
    ) && ok;
    ok = report(
      "locked module refuses a shell write",
      guard({ tool_name: "Bash", tool_input: { command: `sed -i s/a/b/ ${entity.paths[0]}` } }),
      2,
    ) && ok;
    ok = report(
      "locked module still allows reading",
      guard({ tool_name: "Read", tool_input: { file_path: target } }),
      0,
    ) && ok;
  } finally {
    await unlockEntity(entity.id);
  }

  ok = report(
    "unlocking restores editability",
    guard({ tool_name: "Edit", tool_input: { file_path: target } }),
    0,
  ) && ok;
  ok = report(
    "thumbnail marker survived the run",
    (await listLocks()).some((record) => record.id === "thumbnail"),
    true,
  ) && ok;

  console.log(ok ? "\nOWNER LOCK VERIFICATION PASS" : "\nOWNER LOCK VERIFICATION FAIL");
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
