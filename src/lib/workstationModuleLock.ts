/**
 * Workstation enforcement for owner module locks.
 *
 * Claude has a PreToolUse hook, but Codex and ordinary shell processes do not.
 * The Convex mirror therefore also applies Linux's immutable inode flag to the
 * protected files in every linked worktree. Reads continue to work; writes,
 * renames, truncation, and deletion fail in the kernel until the UI unlock is
 * mirrored and this module removes the flag.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ImmutableFileAdapter {
  exists(path: string): boolean;
  regularFile(path: string): boolean;
  immutable(path: string): boolean;
  setImmutable(path: string, locked: boolean): void;
}

const systemAdapter: ImmutableFileAdapter = {
  exists: existsSync,
  regularFile(path) {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  },
  immutable(path) {
    const output = execFileSync("lsattr", ["-d", "--", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return (output.trim().split(/\s+/, 1)[0] ?? "").includes("i");
  },
  setImmutable(path, locked) {
    execFileSync("chattr", [locked ? "+i" : "-i", "--", path], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  },
};

export function parseWorktreeRoots(porcelain: string): string[] {
  return [...new Set(
    porcelain.split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter(Boolean)
      .map((path) => resolve(path)),
  )];
}

export function linkedWorktreeRoots(cwd = process.cwd()): string[] {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseWorktreeRoots(output).filter(existsSync);
}

function safeTarget(root: string, repoRelativePath: string): string {
  if (!repoRelativePath || isAbsolute(repoRelativePath)) {
    throw new Error(`owner lock path is not repo-relative: ${repoRelativePath || "(empty)"}`);
  }
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, repoRelativePath);
  const fromRoot = relative(normalizedRoot, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`owner lock path escapes or names the worktree root: ${repoRelativePath}`);
  }
  return target;
}

export interface ImmutableReconcileResult {
  roots: number;
  protectedFiles: number;
  changedFiles: number;
  absentFiles: number;
}

export function reconcileImmutableModuleFiles(args: {
  roots: readonly string[];
  paths: readonly string[];
  locked: boolean;
  adapter?: ImmutableFileAdapter;
}): ImmutableReconcileResult {
  const adapter = args.adapter ?? systemAdapter;
  let protectedFiles = 0;
  let changedFiles = 0;
  let absentFiles = 0;

  for (const root of [...new Set(args.roots.map((path) => resolve(path)))]) {
    for (const repoRelativePath of [...new Set(args.paths)]) {
      const target = safeTarget(root, repoRelativePath);
      if (!adapter.exists(target)) {
        absentFiles += 1;
        continue;
      }
      if (!adapter.regularFile(target)) {
        throw new Error(`owner lock refuses non-regular path: ${target}`);
      }
      const before = adapter.immutable(target);
      if (before !== args.locked) {
        adapter.setImmutable(target, args.locked);
        changedFiles += 1;
      }
      const after = adapter.immutable(target);
      if (after !== args.locked) {
        throw new Error(`owner lock inode verification failed: ${target}`);
      }
      protectedFiles += 1;
    }
  }

  return {
    roots: new Set(args.roots.map((path) => resolve(path))).size,
    protectedFiles,
    changedFiles,
    absentFiles,
  };
}

export function reconcileWorkstationModuleFiles(args: {
  paths: readonly string[];
  locked: boolean;
  cwd?: string;
}): ImmutableReconcileResult {
  return reconcileImmutableModuleFiles({
    roots: linkedWorktreeRoots(args.cwd),
    paths: args.paths,
    locked: args.locked,
  });
}
