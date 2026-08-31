import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Chart, chartDomain, type ChartPoint } from "./Chart";

const points = (...values: number[]): ChartPoint[] =>
  values.map((value, index) => ({ label: String(index), value }));

assert.deepEqual(chartDomain([]), { lo: 0, hi: 1 });
assert.deepEqual(chartDomain(points(0, 0, 0)), { lo: 0, hi: 1 });

const nonNegative = chartDomain(points(0, 12, 29));
assert.equal(nonNegative.lo, 0, "nonnegative analytics never invent a negative axis");
assert.ok(nonNegative.hi > 29, "nonnegative analytics retain top padding");

const nonPositive = chartDomain(points(-8, -3, 0));
assert.ok(nonPositive.lo < -8, "negative-only deltas retain bottom padding");
assert.equal(nonPositive.hi, 0, "negative-only deltas end at the honest zero baseline");

const mixed = chartDomain(points(-4, 0, 10));
assert.ok(mixed.lo < -4 && mixed.hi > 10, "mixed deltas retain padding on both sides");

const markup = renderToStaticMarkup(
  createElement(Chart, {
    title: "Measured views",
    series: [{ name: "Views", color: "#6ad7c1", points: points(0, 12, 29) }],
  }),
);
assert.match(markup, /class="glass studio-chart"/);
assert.match(markup, /patternUnits="userSpaceOnUse"/);
assert.match(markup, /data-terminal-marker="Views"/);
assert.doesNotMatch(markup, /linearGradient/);

console.log("Chart domain contracts passed");
