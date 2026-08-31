import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const casefile = readFileSync(join(root, "src/app/(app)/casefile/page.tsx"), "utf8");
const editorialEvidence = readFileSync(
  join(root, "src/app/(app)/editorial-evidence/page.tsx"),
  "utf8",
);
const seo = readFileSync(join(root, "src/app/(app)/seo/page.tsx"), "utf8");

// These specialist desks must lead with stored evidence rather than generic
// activity widgets. The contracts intentionally assert the UI's truth surface,
// not its colors or layout implementation.
assert.match(casefile, /casefileEvidenceLocks\(selected\)/);
assert.match(casefile, /Recorded bindings for this case/);
assert.match(casefile, /A missing record is shown as missing/);

assert.match(editorialEvidence, /editorialEvidenceSummary\(selected\?\.packet\)/);
assert.match(editorialEvidence, /Selected immutable receipt/);
assert.match(editorialEvidence, /source snapshots/);

assert.match(seo, /function ResearchEvidenceLedger/);
assert.match(seo, /Only persisted research is represented here/);
assert.match(seo, /Metadata only/);

console.log("Specialist desk evidence-first UI contracts passed");
