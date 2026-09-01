import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/editorial-evidence.module.css`, "utf8");
const runDesk = readFileSync(new URL("../../../components/ReviewedDataStoryRunDesk.tsx", import.meta.url), "utf8");
const runStyles = readFileSync(new URL("../../../components/ReviewedDataStoryRunDesk.module.css", import.meta.url), "utf8");

assert.match(page, /function EvidenceHero/);
assert.match(page, /Nothing enters the script without a receipt\./);
assert.match(page, /Selected immutable receipt/);
assert.match(page, /editorialEvidenceSummary\(selected\?\.packet\)/,
  "the matrix must use persisted receipt fields rather than inferred readiness");
assert.match(page, /Source snapshots/);
assert.match(page, /function LockedEvidenceVault/);
assert.match(page, /No private evidence request was sent/);
assert.match(page, /Evidence only · supervised runs only/);
assert.match(page, /fetch\("\/api\/editorial-evidence-packets"/);
assert.match(page, /invalidatePreview/,
  "editing fingerprint inputs must continue to clear stale validation");
assert.doesNotMatch(page, /style=\{\{/);
assert.doesNotMatch(page, /<OwnerOnlyNotice/);
assert.match(styles, /@keyframes proofRotate/);
assert.match(styles, /prefers-reduced-motion: reduce/);

assert.match(runDesk, /Reviewed Data Story admission route/);
assert.match(runDesk, /Move one receipt into a review-paused episode\./);
assert.match(runDesk, /Cadence never selects this content/);
assert.match(runDesk, /There is no automatic retry loop, public publishing, or generic calendar fallback/);
assert.match(runDesk, /fetch\("\/api\/reviewed-data-story-runs"/);
assert.match(runStyles, /\.laneTrace/);
assert.match(runStyles, /prefers-reduced-motion: reduce/);

console.log("Editorial Evidence UI contracts passed");
