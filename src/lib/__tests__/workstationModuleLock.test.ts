import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  parseWorktreeRoots,
  reconcileImmutableModuleFiles,
  type ImmutableFileAdapter,
} from "@/lib/workstationModuleLock";

const roots = parseWorktreeRoots(`worktree /repo/main
HEAD abc
branch refs/heads/main

worktree /repo/feature path
HEAD def
detached

worktree /repo/main
`);
assert.deepEqual(roots, [resolve("/repo/main"), resolve("/repo/feature path")]);

const present = new Set([
  resolve("/repo/main/src/a.ts"),
  resolve("/repo/feature/src/a.ts"),
]);
const immutable = new Set<string>();
const operations: string[] = [];
const adapter: ImmutableFileAdapter = {
  exists: (path) => present.has(path),
  regularFile: () => true,
  immutable: (path) => immutable.has(path),
  setImmutable(path, locked) {
    operations.push(`${locked ? "+i" : "-i"}:${path}`);
    if (locked) immutable.add(path);
    else immutable.delete(path);
  },
};

const locked = reconcileImmutableModuleFiles({
  roots: ["/repo/main", "/repo/feature"],
  paths: ["src/a.ts", "src/missing.ts", "src/a.ts"],
  locked: true,
  adapter,
});
assert.deepEqual(locked, {
  roots: 2,
  protectedFiles: 2,
  changedFiles: 2,
  absentFiles: 2,
});
assert.equal(immutable.size, 2);

const idempotent = reconcileImmutableModuleFiles({
  roots: ["/repo/main", "/repo/feature"],
  paths: ["src/a.ts"],
  locked: true,
  adapter,
});
assert.equal(idempotent.changedFiles, 0, "the minute sync must not rewrite an already enforced inode");

const unlocked = reconcileImmutableModuleFiles({
  roots: ["/repo/main", "/repo/feature"],
  paths: ["src/a.ts"],
  locked: false,
  adapter,
});
assert.equal(unlocked.changedFiles, 2);
assert.equal(immutable.size, 0);
assert.equal(operations.length, 4);

assert.throws(
  () => reconcileImmutableModuleFiles({
    roots: ["/repo/main"],
    paths: ["../escape.ts"],
    locked: true,
    adapter,
  }),
  /escapes/,
);
assert.throws(
  () => reconcileImmutableModuleFiles({
    roots: ["/repo/main"],
    paths: ["/absolute.ts"],
    locked: true,
    adapter,
  }),
  /not repo-relative/,
);

console.log("WORKSTATION MODULE LOCK PASS — all worktrees, idempotence, unlock, and traversal refusal");
