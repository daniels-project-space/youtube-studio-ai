/**
 * Typographic quotes must reach the regexes that look for them.
 *
 * narratedBlocks.ts had been saved once through a Latin-1 round trip, so every
 * curly quote, em dash, en dash, ellipsis and arrow in it was double-encoded:
 * `“` (U+201C, e2 80 9c) was sitting in the file as the seven bytes
 * c3 a2 e2 82 ac c5 93 — the UTF-8 of `â€œ`. In a COMMENT that is cosmetic. In
 * a regex character class it silently removes the character the class exists
 * to match.
 *
 * Four of them were in character classes, and the effect was measured on the
 * shipping regexes before the repair:
 *
 *   QUOTED         false on a curly-quoted line with no "said/wrote" trigger —
 *                  the line was not recognised as a quotation at all
 *   quote extract  null on curly quotes, correct on straight ones — so a
 *                  narration written with typographic quotes produced NO quote
 *                  overlay, silently
 *   single-quote   null on curly single quotes
 *   sentence split did not split before a curly opening quote, merging two
 *                  sentences into one — and that splitter feeds sentence
 *                  timings, which feed captions and the whole Story Spine
 *
 * A model writing polished prose emits typographic quotes by default, so this
 * was the common case failing, not the edge case. This test reads the regexes
 * out of the shipping source rather than restating them, because a copy would
 * pass while the file itself stayed broken.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts");
const text = readFileSync(SOURCE, "utf8");

/* --------------------- no double-encoding may return --------------------- */

// The exact byte signature of a Latin-1 round trip: `â` (c3 a2) followed by a
// continuation. One is enough to have broken a character class before.
const bytes = readFileSync(SOURCE);
const mojibake: number[] = [];
for (let i = 0; i < bytes.length - 1; i++) {
  if (bytes[i] === 0xc3 && bytes[i + 1] === 0xa2) mojibake.push(i);
}
assert.equal(
  mojibake.length,
  0,
  `narratedBlocks.ts contains ${mojibake.length} double-encoded sequence(s) at byte offset(s) ` +
    `${mojibake.slice(0, 5).join(", ")}. Re-save the file as UTF-8 without a Latin-1 round trip.`,
);

/* ------------- the shipping regexes, extracted from the source ------------ */

function regexOnLineContaining(needle: string, strip: (line: string) => string): RegExp {
  const line = text.split("\n").find((l) => l.includes(needle));
  assert.ok(line, `could not find the line containing ${needle} — was it renamed?`);
  // Evaluating the SHIPPING literal is the point: a restated copy would pass
  // while the file itself stayed broken.
  const value = eval(strip(line.trim())) as RegExp;
  assert.ok(value instanceof RegExp, `${needle} did not yield a regex`);
  return value;
}

const QUOTED = regexOnLineContaining("const QUOTED =", (l) => l.replace("const QUOTED = ", "").replace(/;$/, ""));
const EXTRACT = regexOnLineContaining("let m = s.match(", (l) => l.replace("let m = s.match(", "").replace(/\);$/, ""));
const SINGLE = regexOnLineContaining("m = s.match(/(?:^|[", (l) => l.replace("m = s.match(", "").replace(/\);$/, ""));
const SPLIT = regexOnLineContaining(".split(/(?<=[.!?])", (l) => l.replace(".split(", "").replace(/\)$/, ""));

/* ------------------------- curly and straight both ------------------------ */

// Deliberately no "said"/"wrote"/"words" — those trigger QUOTED's other
// alternation and would hide a broken character class, which is exactly what
// happened the first time this was measured.
const curly = "“The obstacle is the way” — a line worth remembering today.";
const straight = '"The obstacle is the way" - a line worth remembering today.';

assert.ok(QUOTED.test(curly), "a curly-quoted line must be recognised as a quotation");
assert.ok(QUOTED.test(straight), "a straight-quoted line must still be recognised");

assert.equal(
  curly.match(EXTRACT)?.[1],
  "The obstacle is the way",
  "a quote in curly double quotes must be extractable",
);
assert.equal(
  straight.match(EXTRACT)?.[1],
  "The obstacle is the way",
  "a quote in straight double quotes must still be extractable",
);

const curlySingle = "‘Waste no more time arguing’ was his whole point.";
assert.equal(
  curlySingle.match(SINGLE)?.[1],
  "Waste no more time arguing",
  "a quote in curly single quotes must be extractable",
);

/* ---------------------------- sentence splitting -------------------------- */

const paragraph = "First sentence here. “Second starts with a curly quote.” Third one.";
assert.deepEqual(
  paragraph.split(SPLIT),
  ["First sentence here.", "“Second starts with a curly quote.” Third one."],
  "the splitter must break before a curly opening quote — merged sentences corrupt every timing downstream",
);

console.log("TYPOGRAPHIC QUOTES PASS — curly quotes reach the regexes that look for them");
