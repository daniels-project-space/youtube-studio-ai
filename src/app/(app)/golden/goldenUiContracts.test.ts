import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/golden.module.css`, "utf8");
const images = readFileSync(`${here}/GoldenImages.tsx`, "utf8");
const imageStyles = readFileSync(`${here}/GoldenImages.module.css`, "utf8");

assert.match(page, /Quality standards/i);
assert.match(page, /Only tested routes can be promoted\./);
assert.match(page, /Golden module admission assay/);
assert.match(page, /Five production disciplines/);
assert.match(page, /Open a module to inspect its tests and examples\./);
assert.match(page, /data-empty=\{receiptCount === 0\}/);
assert.match(page, /data-warning=\{executionIsWarning\}/);
assert.match(page, /CATALOG ONLY · NOT COMPILER-EXECUTABLE · NOT PROMOTED/);
assert.doesNotMatch(page, /<PageHeader/);
assert.doesNotMatch(page, /className="glass/);
assert.doesNotMatch(page, /style=\{\{(?! width:)/,
  "only the category's live reference meter may remain an inline dynamic style");

assert.match(styles, /\.assayCore/);
assert.match(styles, /\.admissionGrid/);
assert.match(styles, /\.foundationBody ol/);
assert.match(styles, /\.chapterSummary/);
assert.match(styles, /\.moduleCard/);
assert.match(styles, /@keyframes assayTurn/);
assert.match(styles, /prefers-reduced-motion: reduce/);

assert.match(images, /className=\{styles\.overlay\}/);
assert.match(images, /className=\{styles\.caption\}/);
assert.match(images, /data-context=\{p\.status === "context"\}/);
assert.doesNotMatch(images, /style=\{/);
assert.match(imageStyles, /\.lightboxImage/);
assert.match(imageStyles, /\.proofButton:focus-visible/);

console.log("Golden UI contracts passed");
