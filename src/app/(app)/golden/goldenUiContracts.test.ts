import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/golden.module.css`, "utf8");
const images = readFileSync(`${here}/GoldenImages.tsx`, "utf8");
const imageStyles = readFileSync(`${here}/GoldenImages.module.css`, "utf8");

assert.match(page, /Production standards/i);
assert.match(page, /aria-label="Golden catalog summary"/);
assert.match(page, /Catalog truth/);
assert.match(page, /className=\{styles\.modulePowerPoints\}/);
assert.match(page, /function modulePowerPoints/);
assert.match(page, /promotionProofCount === 0/);
assert.match(page, /data-warning=\{executionIsWarning\}/);
assert.match(page, /Catalog only · no compiler binding/);
assert.match(page, /data-module-key=\{m\.key\}/);
assert.match(page, /className=\{styles\.moduleSummary\}/);
assert.match(page, /const MODULE_DESTINATIONS/);
assert.match(page, /href=\{destination\.href\}/);
assert.match(page, /MODULES_WITH_PROOF\.has\(m\.key\)/);
assert.doesNotMatch(page, /<PageHeader/);
assert.doesNotMatch(page, /className="glass/);
assert.doesNotMatch(page, /style=\{\{(?! width:)/,
  "only the category's live reference meter may remain an inline dynamic style");

assert.match(styles, /\.catalogHeader/);
assert.match(styles, /\.truthSummary/);
assert.match(styles, /\.admissionGrid/);
assert.match(styles, /\.foundationBody ol/);
assert.match(styles, /\.chapterSummary/);
assert.match(styles, /\.moduleCard/);
assert.match(styles, /\.moduleCard\[open\]/);
assert.match(styles, /\.moduleSummary:focus-visible/);
assert.match(styles, /\.moduleFacts/);
assert.match(styles, /\.modulePowerPoints li::before/);
assert.doesNotMatch(styles, /@keyframes assayTurn/);
assert.match(styles, /prefers-reduced-motion: reduce/);

assert.match(images, /className=\{styles\.overlay\}/);
assert.match(images, /className=\{styles\.caption\}/);
assert.match(images, /data-context=\{p\.status === "context"\}/);
assert.doesNotMatch(images, /style=\{/);
assert.match(imageStyles, /\.lightboxImage/);
assert.match(imageStyles, /\.proofButton:focus-visible/);

console.log("Golden UI contracts passed");
