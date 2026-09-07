/**
 * A clamp written around an unchecked Number() is not a clamp.
 *
 * NaN loses every comparison it takes part in, so `Math.min(6, NaN)` is NaN and
 * `Math.max(0, NaN)` is NaN — the clamp passes it through untouched, and so does
 * the `if (k <= 0) return` guard beneath it, because `NaN <= 0` is false as
 * well. A repo scan found 48 clamps written that way, all fed from block params,
 * which are Record<string, unknown> filled from channel configuration.
 *
 * The three converted here are the ones where NaN was SILENT rather than loud:
 *
 *   signature_clips count   slipped past this block's guard AND the generator's,
 *                           into a paid path
 *   music trackCount        Math.max(1, NaN) is NaN, so the track loop ran zero
 *                           times and the video shipped with no music
 *   quiz minNotability      `>= NaN` is false for every candidate, rejecting the
 *                           whole pool rather than filtering it
 *
 * width/height were left alone deliberately: NaN reaches ffmpeg and the render
 * fails loudly, which is a real failure rather than a hidden one.
 */
import assert from "node:assert/strict";

import { boundedNumber, boundedInteger, isUsableNumber } from "@/engine/boundedNumber";

/* ------------------- the defect this exists to prevent -------------------- */

// Exactly what signature_clips did, so the comparison is not hypothetical.
const rawClamp = (value: unknown) => Math.max(0, Math.min(6, Number(value)));
assert.ok(Number.isNaN(rawClamp("abc")), "the raw clamp yields NaN — this is the bug");
assert.equal(rawClamp("abc") <= 0, false, "and NaN <= 0 is false, so the zero-guard does not fire");

assert.equal(boundedInteger("abc", 0, 0, 6), 0, "a malformed value resolves to the documented default");
assert.ok(boundedInteger("abc", 0, 0, 6) <= 0, "which then DOES trip the caller's zero-guard");

/* ----------------------------- unusable input ----------------------------- */

for (const bad of ["abc", "", " ", {}, [], [1, 2], null, undefined, Number.NaN, "12px"]) {
  assert.equal(
    boundedNumber(bad, 7, 0, 10),
    7,
    `an unusable value (${JSON.stringify(bad)}) must resolve to the fallback, not to NaN`,
  );
}

// Infinity is not a usable configuration value either — it survives every clamp
// comparison and would silently mean "no ceiling".
assert.equal(boundedNumber(Number.POSITIVE_INFINITY, 7, 0, 10), 7, "Infinity is not a usable bound");
assert.equal(boundedNumber(Number.NEGATIVE_INFINITY, 7, 0, 10), 7, "nor is -Infinity");

/* ------------------------------ usable input ------------------------------ */

assert.equal(boundedNumber(5, 7, 0, 10), 5, "an in-range number passes through");
assert.equal(boundedNumber("5", 7, 0, 10), 5, "a numeric string is legitimate — params round-trip as JSON");
assert.equal(boundedNumber(0, 7, 0, 10), 0, "zero is a value, not an absence");
assert.equal(boundedNumber(99, 7, 0, 10), 10, "above the range clamps to max");
assert.equal(boundedNumber(-99, 7, 0, 10), 0, "below the range clamps to min");
assert.equal(boundedNumber(2.7, 7, 0, 10), 2.7, "boundedNumber keeps the fraction");
assert.equal(boundedInteger(2.7, 7, 0, 10), 2, "boundedInteger floors it");

// The fallback is applied BEFORE the clamp, so a caller's default is what a bad
// value becomes — even when that default sits outside the range it passes.
assert.equal(boundedNumber("abc", 50, 0, 10), 10, "an out-of-range fallback is still clamped");

/* --------------------------- refusing vs substituting --------------------- */

// Some sites must refuse rather than adopt a default: a gate that quietly takes
// a default threshold hides a misconfiguration behind a plausible result.
for (const bad of ["abc", {}, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(isUsableNumber(bad), false, `${JSON.stringify(bad)} is not usable`);
}
for (const good of [0, -1, 2.5, "3"]) {
  assert.equal(isUsableNumber(good), true, `${JSON.stringify(good)} is usable`);
}

console.log("BOUNDED NUMBER PASS — a malformed param resolves to its default instead of NaN");
