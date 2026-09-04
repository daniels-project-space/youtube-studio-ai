/**
 * Every numeral the viewer SEES must be one the narration said.
 *
 * The module's docstring promises "an insert may only visualize numbers the
 * narration actually speaks" and "the model styles the data; it never invents
 * it". anchorsSpoken enforced that for `anchorValues` — the numbers the director
 * DECLARES it is working from. But anchorValues is not what gets drawn. The
 * Remotion component renders title, value, label, xLabels, each bar's label and
 * display, and each event label. numericPlanValues covers those, but only runs
 * inside the evidence-manifest branch, which the ordinary path never enters.
 *
 * So the promise failed on its main route: truthful anchors plus an invented
 * `value` passed the gate and put a hero number on screen that nobody spoke.
 *
 * The two halves of this test pull against each other on purpose. Tightening a
 * gate until nothing survives is the same defect as leaving it open — an insert
 * silently dropped is a data layer that quietly stops existing. So the invention
 * cases must fail AND the ordinary formatting cases must pass: narration says
 * "534 thousand", a chart legitimately renders "$534,000" or "534K".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { unspokenRenderedField, type InsertPlanItem } from "../insertBlocks";

const SOURCE = readFileSync(join(process.cwd(), "src/trigger/blocks/insertBlocks.ts"), "utf8");

const item = (over: Partial<InsertPlanItem>): InsertPlanItem =>
  ({ kind: "big_stat", sentenceIdx: 0, ...over }) as InsertPlanItem;

/** Reads better at the call site than comparing against null. */
const clean = (i: Partial<InsertPlanItem>, sentence: string): boolean =>
  unspokenRenderedField(item(i), sentence) === null;
const offender = (i: Partial<InsertPlanItem>, sentence: string): string | null =>
  unspokenRenderedField(item(i), sentence);

/**
 * Brace depth of an index relative to the start of the plan loop.
 *
 * The first version of this check asserted the two gates sat within N
 * characters of each other, as a proxy for "on the unconditional path". That
 * proxy broke the moment a legitimate gate was added between them — a test
 * failing for a reason it does not name is worse than no test. Depth answers
 * the actual question: a gate inside `if (strictDataStory) {` is one level
 * deeper than the loop body, and that is the placement bug being guarded.
 */
function depthAt(source: string, index: number): number {
  const from = source.indexOf("for (const it of plan) {");
  assert.ok(from > 0 && index > from, "index must fall inside the plan loop");
  let depth = 0;
  for (let i = from + "for (const it of plan) {".length; i < index; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  return depth;
}

function main(): void {
  // ---- the hole this closes -----------------------------------------------
  // Truthful anchors, invented hero number. This is the exact shape that used
  // to pass: anchorsSpoken saw "534000" in the sentence and approved, while the
  // screen showed $1.2 million.
  assert.equal(
    offender(
      { value: "$1.2 million", anchorValues: ["534000"] },
      "The programme added 534,000 jobs last year.",
    ),
    "value",
    "an invented hero number must be caught, and named as the value field",
  );

  // Bar heights are a claim even when the captions are honest. Displays of 100
  // and 200 over values of 100 and 900 draw a ninefold gap.
  assert.equal(
    offender(
      {
        kind: "bar_compare",
        bars: [
          { label: "Before", value: 100, display: "100" },
          { label: "After", value: 900, display: "200" },
        ],
        anchorValues: ["100", "200"],
      },
      "It went from 100 units to 200 units.",
    ),
    "bars[1].value",
    "a bar whose height contradicts its own caption must be caught",
  );

  // Axis years are claims: only the first and last xLabel are drawn, and both
  // put a date on screen.
  assert.equal(
    offender(
      { kind: "line_chart", xLabels: ["2016", "2026"], anchorValues: ["100", "200"] },
      "Output rose from 100 to 200 over the past decade.",
    ),
    "xLabels[0]",
    "an invented axis year must be caught",
  );

  // Event markers annotate the curve with text the viewer reads.
  assert.equal(
    offender(
      { kind: "annotated_line", events: [{ idx: 2, label: "2008 crash" }], anchorValues: ["100"] },
      "The index reached 100 before the crash.",
    ),
    "events[0].label",
    "an invented event year must be caught",
  );

  assert.equal(
    offender({ title: "Up 400% since launch", anchorValues: ["50"] }, "It rose to 50 last quarter."),
    "title",
    "an invented figure in the title must be caught",
  );
  assert.equal(
    offender({ value: "50", label: "up from 12 in 2019" }, "It rose to 50 last quarter."),
    "label",
    "an invented figure in the label must be caught",
  );

  // ---- what must still get through ---------------------------------------
  // Narration says "534 thousand"; rendering the full figure is formatting.
  assert.ok(
    clean({ value: "$534,000", anchorValues: ["534"] }, "The programme added 534 thousand jobs."),
    "expanding a spoken magnitude word must not be treated as invention",
  );
  // And the reverse: the script says the long number, the chart abbreviates.
  assert.ok(
    clean({ value: "534K", anchorValues: ["534000"] }, "The programme added 534,000 jobs."),
    "abbreviating a spoken figure must not be treated as invention",
  );
  assert.ok(
    clean({ value: "$1.2M" }, "Revenue passed 1.2 million dollars."),
    "a suffixed display of a spoken magnitude must pass",
  );
  assert.ok(clean({ value: "87%" }, "Some 87% of respondents agreed."), "a spoken percentage must pass");
  assert.ok(
    clean({ value: "534,000.50" }, "The balance stood at 534000.50 exactly."),
    "separator formatting must not change whether a number counts as spoken",
  );
  // Text with no numerals at all is not a numeric claim.
  assert.ok(clean({ title: "Annual growth", label: "per region" }, "Growth was strong."));
  // Absent fields are not violations.
  assert.ok(clean({}, "Nothing numeric here."));
  // A legitimate bar pair, both spoken.
  assert.ok(
    clean(
      {
        kind: "bar_compare",
        bars: [
          { label: "Before", value: 100, display: "100" },
          { label: "After", value: 200, display: "200" },
        ],
      },
      "It went from 100 units to 200 units.",
    ),
    "bars that match what was said must pass",
  );
  // Axis years that ARE spoken must pass — otherwise line_chart is unusable.
  assert.ok(
    clean({ kind: "line_chart", xLabels: ["2016", "2026"] }, "Between 2016 and 2026 output doubled."),
    "spoken axis years must pass, or the chart kind is gated out of existence",
  );

  // series is excluded on purpose: its points are interpolated between the
  // anchors by design, and seriesWithinSpokenRange bounds them instead. If this
  // gate covered series too it would reject every legitimate curve.
  assert.ok(
    clean({ kind: "line_chart", series: [100, 118, 141, 168, 200] }, "It rose from 100 to 200."),
    "interpolated series points must not be judged as spoken numerals",
  );

  // ---- wiring -------------------------------------------------------------
  // A gate that is defined but not called is the failure mode this module
  // already had once.
  assert.match(
    SOURCE,
    /const unspoken = unspokenRenderedField\(it, t\.text\);/,
    "the gate must be applied to each planned insert",
  );
  const gateAt = SOURCE.indexOf("const unspoken = unspokenRenderedField(it, t.text);");
  const anchorsAt = SOURCE.indexOf("if (!anchorsSpoken(it, t.text))");
  assert.ok(gateAt > 0 && anchorsAt > 0, "both gates must be present in the plan loop");
  assert.equal(
    depthAt(SOURCE, gateAt),
    depthAt(SOURCE, anchorsAt),
    "the gate must sit at the same nesting as anchorsSpoken — on the unconditional " +
      "path, not inside the evidence-manifest branch that most inserts skip",
  );
  assert.equal(depthAt(SOURCE, gateAt), 0, "the gate must run for every planned insert");
  // The drop must name the offending field. "DROPPED big_stat@4" alone leaves
  // no way to tell an over-tight gate from a lying director.
  assert.match(
    SOURCE,
    /\$\{unspoken\} renders a number not spoken in the sentence/,
    "the drop must log which field carried the unspoken number",
  );

  console.log("INSERT RENDERED NUMBERS PASS — every drawn numeral must have been spoken");
}

main();
