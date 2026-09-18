import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Packaging is not allowed to quietly regress into a large generated keyword
// dump. The title remains the evidence-gated discovery promise; the short
// package supports that promise without paying for metadata YouTube says is
// primarily useful for spelling corrections.
const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
const packageStart = source.indexOf('`Write the YouTube description + tags for this video.`');
const packageEnd = source.indexOf('if (!description || tags.length < 5)', packageStart);
assert.ok(packageStart >= 0 && packageEnd > packageStart, "metadata package request must remain locatable");
const packageSource = source.slice(packageStart, packageEnd);

assert.match(packageSource, /one concise, useful paragraph/, "description must be compact and viewer-useful");
assert.match(packageSource, /Do not add a keyword dump, hashtag block/, "keyword stuffing must stay prohibited");
assert.match(packageSource, /exactly 5-8 comma-separated/, "tags must stay deliberately bounded");
assert.match(packageSource, /maxTokens:\s*1400/, "the two-field package must keep its measured low-cost ceiling");
assert.doesNotMatch(packageSource, /25-30|14-20|8-12/, "legacy keyword-volume targets must not return");

console.log("metacraft concise-package policy test passed");
