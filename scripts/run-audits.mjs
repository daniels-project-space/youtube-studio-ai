/**
 * Run every structural audit and fail if any of them found MORE than last time.
 *
 * Eleven audit scripts existed and nothing ran them. They were invoked by hand,
 * which means they report on whatever day someone remembers — the exact "you
 * built it and never wired it up" failure the audits themselves keep finding in
 * the pipeline. Seven of them were written in one sitting and would have rotted
 * the same way.
 *
 * WHY A BASELINE RATHER THAN ZERO
 *
 * None of these can honestly demand zero. Every remaining finding has been
 * investigated and is correct as it stands: gates that fail open on purpose,
 * catches whose safety lives in a separate fence, required consumes that exist
 * to sequence the pipeline, capability branches behind a deliberate policy. A
 * gate set to zero would have to be silenced immediately, and a silenced gate is
 * worse than none.
 *
 * So the contract is: findings may FALL freely, and any RISE fails. That catches
 * the regression this is for — someone adds a starved ceiling, a silent catch, a
 * dead declaration — while leaving the explained residue alone. When a count
 * drops, the baseline is updated in the same commit that earned it, which is
 * also what makes the drop visible in review.
 *
 * Usage:
 *   npm run audit            check against the baseline
 *   npm run audit -- --save  record the current counts as the new baseline
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const BASELINE = join(root, "scripts", "audit-baseline.json");

/** Audits that report a machine-readable AUDIT_FINDINGS count. */
const AUDITS = [
  "audit-json-contract-ceilings",
  "audit-fail-open-gates",
  "audit-silent-degradation",
  "audit-inert-inputs",
  "audit-inert-consumes",
  "audit-dead-capability-gates",
  "audit-unbounded-normalized",
];

const save = process.argv.includes("--save");
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const current = {};
const regressions = [];
const improvements = [];

for (const audit of AUDITS) {
  const result = spawnSync(tsx, [join(root, "scripts", `${audit}.ts`)], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 900_000,
  });
  if (result.status !== 0) {
    console.error(`${audit}: FAILED TO RUN\n${(result.stderr || "").split("\n").slice(-6).join("\n")}`);
    process.exit(1);
  }
  const match = /^AUDIT_FINDINGS (\d+)$/m.exec(result.stdout);
  if (!match) {
    // An audit that stops reporting its count is an audit nobody is checking.
    console.error(`${audit}: printed no AUDIT_FINDINGS line — the runner cannot check it`);
    process.exit(1);
  }
  const found = Number(match[1]);
  current[audit] = found;
  const was = baseline[audit];
  const verdict = was === undefined ? "NEW" : found > was ? "WORSE" : found < was ? "better" : "same";
  console.log(`  ${String(found).padStart(4)}  ${verdict.padEnd(7)} ${audit}${was === undefined ? "" : ` (baseline ${was})`}`);
  if (was !== undefined && found > was) regressions.push(`${audit}: ${was} -> ${found}`);
  if (was !== undefined && found < was) improvements.push(`${audit}: ${was} -> ${found}`);
}

if (save) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`\nbaseline written to scripts/audit-baseline.json`);
  process.exit(0);
}

if (improvements.length) {
  console.log(`\n${improvements.length} audit(s) improved — run \`npm run audit -- --save\` in the commit that earned it:`);
  for (const line of improvements) console.log(`  ${line}`);
}

if (regressions.length) {
  console.error(`\n${regressions.length} audit(s) found MORE than the baseline:`);
  for (const line of regressions) console.error(`  ${line}`);
  console.error(
    `\nEach of these is a question, not a verdict — read the audit's own output for the\n` +
      `finding it added. If the new finding is correct as it stands, say so where it is\n` +
      `declared and raise the baseline in the same commit.`,
  );
  process.exit(1);
}

console.log("\nno audit regressed.");
