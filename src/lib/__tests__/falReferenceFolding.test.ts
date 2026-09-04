/**
 * References must survive the fold, however many there are.
 *
 * FLUX Kontext accepts exactly one image_url, so the fal route composites
 * several references onto one sheet rather than discarding all but the first.
 * That fold had a quieter version of the same bug it was written to fix: the
 * turnaround layout caps at four views, so a fifth reference was silently
 * dropped — the loss simply moved from "all but one" to "all but four".
 *
 * This pins the selection rule directly. It is deliberately a test of the PLAN
 * rather than of the network call: which layout is chosen, and whether every
 * supplied view survives into it, is the whole of the decision, and it can be
 * checked without a provider, a key or a cent.
 */
import assert from "node:assert/strict";

import {
  CHARACTER_SHEET_MAX_VIEWS,
  CONTACT_SHEET_MAX_PANELS,
  planCharacterSheet,
  planContactSheet,
} from "@/lib/characterSheet";

const views = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `ref_${i}`, path: `/tmp/ref_${i}.png` }));

/** The rule falImage applies when folding references into one conditioning image. */
function chosenPlan(count: number) {
  const v = views(count);
  return count > CHARACTER_SHEET_MAX_VIEWS ? planContactSheet(v) : planCharacterSheet(v);
}

function main(): void {
  // A single reference is passed through untouched. Padding one view into a
  // grid of duplicates would assert the subject looks identical from every
  // angle, which is a worse claim than making none.
  assert.equal(chosenPlan(1).passthrough, true);

  // Two to four views fold as a turnaround, and none is lost.
  for (const count of [2, 3, 4]) {
    const plan = chosenPlan(count);
    assert.equal(plan.views.length, count, `${count} views must all survive the turnaround`);
    assert.equal(plan.passthrough, false);
  }

  // FIVE is the case that used to lose data: the turnaround caps at four, so
  // the fifth reference vanished with no error and no log.
  const five = chosenPlan(5);
  assert.equal(
    five.views.length,
    5,
    `a fifth reference must not be dropped; the turnaround alone keeps only ${planCharacterSheet(views(5)).views.length}`,
  );
  assert.ok(
    planCharacterSheet(views(5)).views.length < 5,
    "this test is only meaningful while the turnaround layout genuinely caps below five",
  );

  // Up to nine fold into the 3x3 sheet.
  assert.equal(chosenPlan(9).views.length, CONTACT_SHEET_MAX_PANELS);
  assert.equal(chosenPlan(9).columns, 3);

  // Beyond nine, clamping is the correct behaviour rather than an overflowing
  // grid — but it must clamp to the maximum, not to the turnaround's four.
  const many = chosenPlan(14);
  assert.equal(many.views.length, CONTACT_SHEET_MAX_PANELS);
  assert.ok(many.views.length > CHARACTER_SHEET_MAX_VIEWS, "clamping must not fall back to the smaller layout");

  console.log("FAL REFERENCE FOLDING PASS — no reference is silently dropped up to nine");
}

main();
