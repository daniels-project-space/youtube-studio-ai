import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/seo.module.css`, "utf8");

assert.match(page, /function PackagingHero/,
  "the standalone SEO desk must own its packaging-lab composition");
assert.match(page, /Territory map/);
assert.match(page, /Selection does not mutate channel identity/);
assert.match(page, /Pixel-level thumbnail claims stay unavailable until visual evidence actually exists/);
assert.match(page, /function ResearchEvidenceLedger/);
assert.match(page, /Stored visual guide reports text overlay/,
  "a measured state must explain the stored visual claim instead of contradicting itself");
assert.match(page, /modeled views/,
  "tag overlap must be presented as a model rather than a promised audience outcome");
assert.match(page, /fetch\("\/api\/research"/,
  "the research action must remain connected to the real queue boundary");
assert.match(page, /ArrowRight/);
assert.match(page, /ArrowLeft/);
assert.doesNotMatch(page, /<PageHeader/);
assert.match(styles, /prefers-reduced-motion: reduce/);

console.log("SEO UI contracts passed");
