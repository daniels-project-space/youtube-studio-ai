import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const page = readFileSync(resolve(root, "src/app/(app)/runs/page.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/(app)/runs/runs.module.css"), "utf8");

assert.match(page, /const destination = failure[\s\S]*?\? "Inspect"/);
assert.match(page, /className=\{styles\.runDiagnosis\}/);
assert.match(page, /Failure domain: \$\{failure\.faultDomain\}/);
assert.match(page, /ReleaseEvidenceBadge status=\{run\.releaseEvidenceStatus\} compact/);
assert.doesNotMatch(page, /className=\{styles\.runFailure\}/);
assert.match(styles, /\.runDiagnosis \{/);
assert.doesNotMatch(styles, /\.runFailure \{/);
