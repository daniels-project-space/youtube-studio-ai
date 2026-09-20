import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Invoke only the pinned CLI's local archive function, never its deploy/dry-run.
const archiverPath = resolve(process.argv[2] ?? "");
assert.ok(archiverPath.endsWith("/dist/esm/deploy/archiveContext.js"), "Pass the installed 4.5.9 archiveContext.js path");
const pkg = JSON.parse(await readFile(resolve(dirname(archiverPath), "../../../package.json"), "utf8"));
assert.equal(pkg.name, "trigger.dev");
assert.equal(pkg.version, "4.5.9");
const { createContextArchive } = await import(pathToFileURL(archiverPath).href);
const cliRequire = createRequire(archiverPath);
const tar = cliRequire("tar");
const require = createRequire(import.meta.url);
const yaml = require(require.resolve("js-yaml", { paths: [require.resolve("eslint")] }));
const source = process.cwd();
const workflow = yaml.load(await readFile(join(source, ".github/workflows/ci.yml"), "utf8"));
const step = workflow.jobs["deploy-cloud-runtimes"].steps.find(s => s.name === "Deploy Trigger production tasks");
const root = await mkdtemp(join(tmpdir(), "trigger-native-context-proof-"));
const context = join(root, "checkout");
await mkdir(context);

async function manifest(file) {
  const entries = new Map();
  const pending = [];
  await tar.t({ file, onentry(entry) {
    const hash = createHash("sha256");
    pending.push(new Promise((resolve, reject) => {
      entry.on("data", chunk => hash.update(chunk));
      entry.on("error", reject);
      entry.on("end", () => {
        entries.set(entry.path, { type: entry.type, size: entry.size, sha256: hash.digest("hex") });
        resolve();
      });
    }));
  } });
  await Promise.all(pending);
  return entries;
}

try {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: source, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of files) {
    assert.ok(!file.startsWith("/") && !file.split("/").includes(".."));
    assert.equal((await lstat(join(source, file))).isFile(), true, `Unexpected non-regular tracked input: ${file}`);
    await mkdir(dirname(join(context, file)), { recursive: true });
    await copyFile(join(source, file), join(context, file));
  }
  const originalIgnore = await readFile(join(context, ".gitignore"));
  const beforePath = join(root, "before.tar.gz");
  const afterPath = join(root, "after.tar.gz");
  await createContextArchive(context, beforePath);
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "npm"), `#!${process.execPath}
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["run", "trigger:deploy", "--", "--skip-sync-env-vars"])) process.exit(9);
import(${JSON.stringify(pathToFileURL(archiverPath).href)}).then(m => m.createContextArchive(process.cwd(), ${JSON.stringify(afterPath)})).catch(e => { console.error(e); process.exitCode = 1; });
`, { mode: 0o755 });
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run], {
    cwd: context, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(join(context, ".gitignore")), originalIgnore);
  const before = await manifest(beforePath);
  const after = await manifest(afterPath);
  let removedFiles = 0;
  for (const [path, receipt] of before) {
    if (path.startsWith("test-fixtures/")) {
      assert.equal(after.has(path), false);
      removedFiles++;
    } else if (path !== ".gitignore") {
      assert.deepEqual(after.get(path), receipt, `Required input changed or disappeared: ${path}`);
    }
  }
  assert.ok(removedFiles > 0, "Baseline must actually contain the excluded fixtures");
  assert.equal(after.size, before.size - removedFiles);
  const beforeBytes = (await stat(beforePath)).size;
  const afterBytes = (await stat(afterPath)).size;
  assert.ok(afterBytes < beforeBytes);
  console.log(JSON.stringify({ cliVersion: pkg.version, beforeBytes, afterBytes, removedFiles,
    reductionPercent: 100 * (beforeBytes - afterBytes) / beforeBytes,
    preservedFiles: after.size - 1, ignoreRestored: true, providerRequests: 0 }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
