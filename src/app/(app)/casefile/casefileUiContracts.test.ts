import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/casefile.module.css`, "utf8");

assert.match(page, /function CasefileHero/);
assert.match(page, /Turn evidence into a shot-by-shot case\./);
assert.match(page, /Evidence route/);
assert.match(page, /No render · no spend · no publish/,
  "the editorial-only authority boundary must stay explicit");
assert.match(page, /casefileEvidenceLocks\(selected\)/,
  "the evidence map must remain derived from persisted episode bindings");
assert.match(page, /Recorded bindings for this case/);
assert.match(page, /A missing record is shown as missing/);
assert.match(page, /function LockedCasefileRoom/);
assert.match(page, /No private casefile request was sent/);
assert.match(page, /fetch\("\/api\/casefile-episodes"/,
  "intake and review actions must remain connected to the real route");
assert.match(page, /parseSourceProofAttachments/,
  "source-proof media must retain its bounded client contract");
assert.doesNotMatch(page, /style=\{\{/,
  "the Casefile room should use its own reusable visual system, not one-off inline cards");
assert.doesNotMatch(page, /<OwnerOnlyNotice/,
  "the Casefile page must own its private-room explanation");
assert.match(styles, /@keyframes casePulse/);
assert.match(styles, /prefers-reduced-motion: reduce/);

console.log("Casefile UI contracts passed");
