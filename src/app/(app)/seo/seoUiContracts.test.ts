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
assert.match(page, /Metadata is not pixel evidence/);
assert.match(page, /function ResearchEvidenceLedger/);
assert.match(page, /Visual attributes stored/,
  "a measured state must explain the stored visual claim instead of contradicting itself");
assert.match(page, /benchmark midpoint/,
  "comparable views must be presented as a benchmark rather than a promised audience outcome");
assert.match(page, /Comparable public videos/,
  "the benchmark must name the evidence population instead of exposing an implementation label");
assert.doesNotMatch(page, /tag overlap \(\$\{estimate\.matches\} matches\)/,
  "implementation terminology should not be the user-facing result label");
assert.match(page, /fetch\("\/api\/research"/,
  "the research action must remain connected to the real queue boundary");
assert.match(page, /ArrowRight/);
assert.match(page, /ArrowLeft/);
assert.doesNotMatch(page, /<PageHeader/);
assert.match(styles, /prefers-reduced-motion: reduce/);

console.log("SEO UI contracts passed");
