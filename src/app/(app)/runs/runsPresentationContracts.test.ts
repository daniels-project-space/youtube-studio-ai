import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const page = readFileSync(resolve(root, "src/app/(app)/runs/page.tsx"), "utf8");
const detailPage = readFileSync(resolve(root, "src/app/(app)/runs/[runId]/page.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/(app)/runs/runs.module.css"), "utf8");
const detailStyles = readFileSync(resolve(root, "src/app/(app)/runs/[runId]/runDetail.module.css"), "utf8");
const runsQuery = readFileSync(resolve(root, "convex/runs.ts"), "utf8");

assert.match(page, /const destination = failure[\s\S]*?\? "Inspect"/);
assert.doesNotMatch(page, /Watch progress, inspect failures, and open saved output\./,
  "the compact run workspace must not repeat the shell's route description above its actionable controls");
assert.match(page, /className=\{styles\.runDiagnosis\}/);
assert.match(page, /Failure domain: \$\{failure\.faultDomain\}/);
assert.match(page, /ReleaseEvidenceBadge status=\{run\.releaseEvidenceStatus\} compact/);
assert.doesNotMatch(page, /className=\{styles\.runFailure\}/);
assert.match(styles, /\.runDiagnosis \{/);
assert.doesNotMatch(styles, /\.runFailure \{/);
assert.doesNotMatch(page, /operatingSignals/);
assert.doesNotMatch(styles, /\.operatingSignals/);
assert.doesNotMatch(styles, /repeat\(6,minmax\(104px,1fr\)\)/);
assert.match(detailPage, /failureReason\(run\.error\)/);
assert.match(detailPage, /Technical detail/);
assert.match(detailPage, /className=\{styles\.errorSummary\}/);
assert.doesNotMatch(detailPage, /<div className=\{`glass \$\{styles\.errorPanel\}`\} role="alert">\s*\{run\.error\}/);
assert.match(detailStyles, /\.errorTechnical code[^{]*\{[^}]*overflow-wrap: anywhere/);
assert.match(page, /run\.stageProgress/);
assert.match(page, /blockLabel\(progress\.currentBlock\)/);
assert.match(page, /data-live=\{live \? "true" : "false"\}/);
assert.match(page, /automaticResumeLabel\(run\.automaticResumeState/);
assert.match(page, /className=\{styles\.runRecovery\}/);
assert.match(styles, /\.runProgress \{/);
assert.match(styles, /\.runRecovery \{/);
assert.match(styles, /\.runRow\[data-live="true"\] \{ min-height: 68px/);
assert.match(styles, /\.hero \{[\s\S]*?min-height: 60px/,
  "the run header stays compact because the shell already identifies the route");
assert.match(styles, /\.metric \{[\s\S]*?min-height: 50px/,
  "status filters should remain dense controls rather than a second dashboard");
assert.match(runsQuery, /summarizeRunStageProgress/);
assert.match(runsQuery, /\.query\("runStages"\)/);
assert.match(runsQuery, /automaticResumeState: run\.automaticResumeState/);
