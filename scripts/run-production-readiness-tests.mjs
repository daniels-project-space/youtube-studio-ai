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
  // Same class of check for the chart lane: design → validate → compile for
  // BOTH chart families, plus the two locks that only exist because they share
  // a renderer (distinct pipelines, one chart_render) and the two lane-forbidden
  // auto-inserts that the designer and the compiler must both keep out.
  join(root, "scripts", "chartlane-pipeline-dryrun.ts"),
];

const tests = [...directTests(sourceRoot).sort(), ...extraTests];
if (tests.length === 0) {
  console.error("No direct production-readiness tests were discovered under src/");
  process.exit(1);
}

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
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${tests.length} direct production-readiness tests passed.`);
