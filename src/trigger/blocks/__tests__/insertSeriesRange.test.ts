/**
 * A plotted curve must not leave the range of the numbers actually spoken.
 *
 * The inserts module's stated gate is that it "only visualizes numbers the
 * narration actually speaks, verbatim", and anchorsSpoken enforces that for the
 * anchors. The 8-16 interpolated points of a line chart were checked only on
 * the evidence-manifest path, which most inserts never take — so on the
 * ordinary route a curve between two spoken anchors could peak anywhere at all.
 * Anchors of 100 and 200 with a series topping 900 passed, and the tallest
 * point of a chart reads to a viewer as a figure.
 *
 * The distinction this pins is between shape and claim. Interpolating the
 * curve BETWEEN two spoken numbers is not a factual assertion — the smoothness
 * of a decade of growth is presentation. Leaving that range is an assertion,
 * because it puts a magnitude on screen that nobody said.
 *
 * Asserted against the shipping source rather than a copy: the rule is read out
 * of insertBlocks.ts, because a re-implementation here would verify itself.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seriesWithinSpokenRange, type InsertPlanItem } from "../insertBlocks";

const SOURCE = readFileSync(join(process.cwd(), "src/trigger/blocks/insertBlocks.ts"), "utf8");

const chart = (over: Partial<InsertPlanItem>): InsertPlanItem => ({
  kind: "line_chart", sentenceIdx: 0, ...over,
} as InsertPlanItem);

function main(): void {
  // ---- behaviour ---------------------------------------------------------
  // A curve that stays between its spoken anchors is presentation, not a claim.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"], series: [100, 118, 141, 168, 200] })),
    true,
    "a faithful curve between two spoken anchors must pass",
  );

  // The case that used to slip through: anchors of 100 and 200, a peak of 900.
  // The tallest point of a chart reads to a viewer as a figure.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"], series: [100, 400, 900, 300, 200] })),
    false,
    "a curve peaking far above its anchors renders a magnitude nobody said",
  );

  // Below the range is the same error mirrored — an invented trough.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"], series: [100, 5, 200] })),
    false,
    "a curve dipping far below its anchors is equally invented",
  );

  // A smooth curve may overshoot an endpoint fractionally without that being a
  // claim; 204 on a 100-200 chart is rounding, not assertion.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"], series: [100, 150, 203] })),
    true,
    "a small endpoint overshoot must not fail a legitimate curve",
  );

  // Anchors are parsed the way they arrive — with separators and decimals.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["1,200", "2,400.50"], series: [1200, 1800, 2400] })),
    true,
    "comma-separated and decimal anchors must define the range correctly",
  );

  // No series is not a violation: big-stat and bar inserts carry none.
  assert.equal(seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"] })), true);

  // One anchor gives no range to police, and anchorsSpoken already refuses an
  // insert with no spoken anchor — this gate must not double-refuse.
  assert.equal(seriesWithinSpokenRange(chart({ anchorValues: ["100"], series: [50, 900] })), true);

  // A non-finite point cannot be inside any range. Note this holds even without
  // the explicit Number.isFinite guard — NaN and +/-Infinity all fail the range
  // comparison on their own, verified directly. The guard is documentation, so
  // this assertion pins the behaviour, not that one clause.
  assert.equal(
    seriesWithinSpokenRange(chart({ anchorValues: ["100", "200"], series: [100, Number.NaN, 200] })),
    false,
    "a non-finite plotted point must never pass",
  );


  // The gate exists and runs on the ordinary path, not only behind a manifest.
  assert.match(SOURCE, /function seriesWithinSpokenRange/, "the series range gate must exist");
  assert.match(
    SOURCE,
    /if \(!seriesWithinSpokenRange\(it\)\) \{/,
    "the gate must be applied to each planned insert, not merely defined",
  );

  // It must run OUTSIDE the evidence-manifest branch. That branch is why the
  // hole existed: numericPlanValues covers series but only fires when a
  // reviewed manifest is present.
  const gateAt = SOURCE.indexOf("if (!seriesWithinSpokenRange(it))");
  const anchorsAt = SOURCE.indexOf("if (!anchorsSpoken(it, t.text))");
  assert.ok(gateAt > 0 && anchorsAt > 0, "both gates must be present in the plan loop");
  assert.ok(
    Math.abs(gateAt - anchorsAt) < 400,
    "the series gate must sit alongside anchorsSpoken on the unconditional path, " +
    "not inside the evidence-manifest branch that most inserts skip",
  );

  // A dropped insert must say why. A silent skip is indistinguishable from a
  // planner that produced nothing, which is how a gate stops being noticed.
  assert.match(
    SOURCE,
    /plotted curve leaves the range of its spoken anchors/,
    "the drop must be logged with its reason",
  );

  // The tolerance must stay small enough to be a curve allowance rather than a
  // licence. At 2% a 100-200 chart may reach 204; at 50% it could reach 300 and
  // the gate would be decorative.
  const tolerance = Number(/SERIES_OVERSHOOT_TOLERANCE = ([0-9.]+)/.exec(SOURCE)?.[1] ?? "1");
  assert.ok(tolerance > 0, "some tolerance is needed or a smooth curve's endpoint rounds into a failure");
  assert.ok(tolerance <= 0.05, `tolerance ${tolerance} is wide enough to admit invented magnitudes`);

  // Fewer than two anchors means there is no range to police, and anchorsSpoken
  // already refuses an insert with no spoken anchor — so the gate must not
  // double-refuse and silently drop legitimate single-value inserts.
  assert.match(
    SOURCE,
    /if \(anchors\.length < 2\) return true;/,
    "a single-anchor insert has no range and must pass this gate to anchorsSpoken",
  );

  console.log("INSERT SERIES RANGE PASS — plotted curves cannot leave their spoken anchors");
}

main();
