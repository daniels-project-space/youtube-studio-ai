import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { selectReadinessTests } from "./readiness-test-selection.mjs";

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
// the discovered tests, and run through the same tsx subprocess path as everything
// else. The slower `test:assembly-render-parity` (needs ffmpeg + Remotion) is
// intentionally NOT included here — run it separately/opt-in when touching the
// render path, since it would change this suite's runtime requirements.
const extraTests = [
  join(root, "scripts", "assembly-parity.ts"),
  join(root, "scripts", "quizyear-pipeline-dryrun.ts"),
];

const selection = selectReadinessTests([...directTests(sourceRoot).sort(), ...extraTests], process.argv.slice(2));
const { tests } = selection;
if (tests.length === 0) {
  console.error("No direct production-readiness tests were discovered under src/");
  process.exit(1);
}

// A single stuck renderer subprocess used to consume the whole CI timeout and
// conceal the tests that followed it. Every direct test remains mandatory, but
// each gets a bounded wall-clock budget so the report names the exact stalled
// test and the rest of the readiness surface still runs.
const DIRECT_TEST_TIMEOUT_MS = 180_000;

// Tests run in their own Node processes and already use isolated temporary
// directories. A small pool removes hundreds of needless process waits while
// keeping enough CPU/RAM headroom for the occasional ffmpeg/Remotion fixture.
// The env override remains useful for diagnosing a suspected test interaction,
// but the default production gate always executes the complete same set.
const requestedConcurrency = Number(process.env.DIRECT_TEST_CONCURRENCY ?? 4);
const DIRECT_TEST_CONCURRENCY = Number.isSafeInteger(requestedConcurrency)
  ? Math.max(1, Math.min(8, requestedConcurrency))
  : 4;

function executeTest(test) {
  return new Promise((resolve) => {
    const label = relative(root, test);
    // This fixture performs two independently bounded 120s renders plus the
    // full-decode comparison scans. Keep its aggregate budget above that sum.
    const timeoutMs = test === join(sourceRoot, "lib", "__tests__", "repeatedMusicBlackGate.test.ts")
      ? 360_000 : DIRECT_TEST_TIMEOUT_MS;
    const child = spawn(tsx, [test], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let forceKill;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 10_000);
      forceKill.unref();
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
      resolve({ label, status, signal, stdout, stderr, spawnError, timedOut, timeoutMs });
    });
  });
}

async function executeAllTests() {
  const results = new Array(tests.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tests.length) {
      const index = nextIndex++;
      results[index] = await executeTest(tests[index]);
      const result = results[index];
      console.log(`[${++completed}/${tests.length}] ${result.status === 0 && !result.timedOut && !result.spawnError ? "PASS" : "FAIL"} ${result.label}`);
    }
  };
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(DIRECT_TEST_CONCURRENCY, tests.length) }, worker));
  return results;
}

// Run every selected test, then report. The default selects the complete gate.
// This used to exit on the first failure, which
// hides the size of a breakage: when the owner lock moved to Convex it broke
// two golden surface tests, and because one of them sorts third out of 579 the
// suite died there and the remaining 576 never ran. A green-looking partial
// sweep is worse than a red one, because it is quoted as evidence.
if (selection.partial) {
  console.log(`PARTIAL READINESS: excluding ${selection.excluded.length} tests with thumbnail names or direct source references; this is not the complete production gate.`);
  for (const path of selection.excluded) console.log(`EXCLUDED ${relative(root, path)}`);
}
console.log(`Running ${tests.length} direct readiness tests with ${DIRECT_TEST_CONCURRENCY} workers.`);
const results = await executeAllTests();
const failures = [];
for (const result of results) {
  console.log(`\n=== ${result.label} ===`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.timedOut) {
    console.error(`Timed out after ${result.timeoutMs / 1_000}s: ${result.label}`);
    failures.push(result.label);
    continue;
  }
  if (result.spawnError) {
    console.error(`Unable to execute ${result.label}: ${result.spawnError.message}`);
    failures.push(result.label);
    continue;
  }
  if (result.status !== 0) {
    console.error(`${result.label} failed with exit code ${result.status ?? result.signal ?? "unknown"}`);
    failures.push(result.label);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} of ${tests.length} direct production-readiness tests FAILED:`);
  for (const label of failures) console.error(`  ${label}`);
  process.exit(1);
}

console.log(selection.partial
  ? `\nAll ${tests.length} selected readiness tests passed; ${selection.excluded.length} excluded. COMPLETE PRODUCTION READINESS NOT VERIFIED.`
  : `\nAll ${tests.length} direct production-readiness tests passed.`);
