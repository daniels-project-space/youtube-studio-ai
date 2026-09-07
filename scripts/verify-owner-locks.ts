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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOCKABLE_MODULES, lockableModule } from "@/lib/ownerLockRegistry";
import { listLocks, lockEntity, unlockEntity } from "@/lib/moduleLocks";
import { reconcileImmutableModuleFiles } from "@/lib/workstationModuleLock";

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
  const initialLocks = await listLocks();
  const initialIds = new Set(initialLocks.map((record) => record.id));

  const withFiles = LOCKABLE_MODULES.filter((entity) => entity.paths.length > 0);
  ok = report("every module is registered as lockable", LOCKABLE_MODULES.length > 40, true) && ok;
  ok = report("most modules resolve to real files", withFiles.length > 40, true) && ok;

  // The thumbnail module is the one with a hand-worked blast radius; if the
  // generator ever narrows it, the lock silently stops covering its gates.
  const thumbnail = lockableModule("thumbnail");
  ok = report("thumbnail lock still spans its gates", (thumbnail?.paths.length ?? 0) >= 23, true) && ok;

  // A module is only locked while a marker exists — never by default.
  const baseEntity = lockableModule("editorial-evidence-packet");
  if (!baseEntity || baseEntity.paths.length === 0) throw new Error("guard probe module has no files");
  // A synthetic id is deliberately outside LOCKABLE_MODULES, so the minute
  // sync cannot mistake this short-lived local proof for a stale UI marker and
  // remove it halfway through the assertions.
  const entity = { ...baseEntity, id: `verification-${process.pid}` };
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
    "pre-existing owner locks survived the run",
    initialIds.size === 0 || (await listLocks()).filter((record) => initialIds.has(record.id)).length === initialIds.size,
    true,
  ) && ok;

  // Kernel-level proof for tools without a pre-edit hook (including Codex).
  const probeRoot = await mkdtemp(join(tmpdir(), "ysa-owner-lock-proof-"));
  const probePath = join(probeRoot, "probe.txt");
  await writeFile(probePath, "unchanged\n");
  try {
    const applied = reconcileImmutableModuleFiles({
      roots: [probeRoot],
      paths: ["probe.txt"],
      locked: true,
    });
    ok = report("kernel immutable flag was applied", applied.changedFiles, 1) && ok;
    ok = report(
      "ordinary shell write is refused by the kernel",
      spawnSync("bash", ["-c", ': >> "$1"', "_", probePath]).status === 0,
      false,
    ) && ok;
    const released = reconcileImmutableModuleFiles({
      roots: [probeRoot],
      paths: ["probe.txt"],
      locked: false,
    });
    ok = report("UI-mirror unlock releases the inode", released.changedFiles, 1) && ok;
    ok = report(
      "ordinary shell write works after unlock",
      spawnSync("bash", ["-c", ': >> "$1"', "_", probePath]).status,
      0,
    ) && ok;
  } finally {
    // If an assertion above throws, release before cleaning the private probe.
    try {
      reconcileImmutableModuleFiles({ roots: [probeRoot], paths: ["probe.txt"], locked: false });
    } catch { /* the main report will already fail */ }
    await rm(probeRoot, { recursive: true, force: true });
  }

  console.log(ok ? "\nOWNER LOCK VERIFICATION PASS" : "\nOWNER LOCK VERIFICATION FAIL");
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
