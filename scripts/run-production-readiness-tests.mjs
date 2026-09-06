import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const tsx = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

function directTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return directTests(path);
    return /\.test\.(?:ts|tsx|mts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

// Extra tests that live outside src/ (so the src/**/*.test.* auto-discovery above
// can't see them) but are still cheap, deterministic, no-ffmpeg/no-Convex checks
// that belong in the standard gate. Kept as an explicit allowlist, appended after
// the discovered tests, and run through the same tsx/spawnSync path as everything
// else. The slower `test:assembly-render-parity` (needs ffmpeg + Remotion) is
// intentionally NOT included here — run it separately/opt-in when touching the
// render path, since it would change this suite's runtime requirements.
const extraTests = [
  join(root, "scripts", "assembly-parity.ts"),
  join(root, "scripts", "quizyear-pipeline-dryrun.ts"),
];

const tests = [...directTests(sourceRoot).sort(), ...extraTests];
if (tests.length === 0) {
  console.error("No direct production-readiness tests were discovered under src/");
  process.exit(1);
}

// Run EVERY test, then report. This used to exit on the first failure, which
// hides the size of a breakage: when the owner lock moved to Convex it broke
// two golden surface tests, and because one of them sorts third out of 579 the
// suite died there and the remaining 576 never ran. A green-looking partial
// sweep is worse than a red one, because it is quoted as evidence.
const failures = [];
for (const test of tests) {
  const label = relative(root, test);
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(tsx, [test], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to execute ${label}: ${result.error.message}`);
    failures.push(label);
    continue;
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? "unknown"}`);
    failures.push(label);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} of ${tests.length} direct production-readiness tests FAILED:`);
  for (const label of failures) console.error(`  ${label}`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} direct production-readiness tests passed.`);
