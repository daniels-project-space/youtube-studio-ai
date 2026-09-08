import assert from "node:assert/strict";
import { layoutAnalyticsEfficiencyField } from "../analyticsEfficiencyField";

const tied = Array.from({ length: 6 }, (_, index) => ({
  channelId: `channel-${index}`,
  name: `Channel ${index}`,
  slug: `channel-${index}`,
  totalViews: 0,
  costTotal: 0,
  videoCount: index,
}));
const tiedLayout = layoutAnalyticsEfficiencyField(tied, null);
assert.equal(new Set(tiedLayout.map((node) => `${node.x}:${node.y}`)).size, tied.length,
  "channels with identical measurements must retain separate hit targets");
for (const node of tiedLayout) {
  assert.ok(node.x - node.radius >= 42 && node.x + node.radius <= 694);
  assert.ok(node.y - node.radius >= 18 && node.y + node.radius <= 208);
  assert.equal(node.rawX, 58, "the exact lower-spend coordinate remains available for a truth connector");
  assert.equal(node.rawY, 194, "the exact zero-reach coordinate remains available for a truth connector");
}

const labels = tiedLayout.flatMap((node) => node.label ? [node.label] : []);
assert.equal(labels.length, 5, "the field labels a bounded, readable set");
for (const anchor of ["start", "end"] as const) {
  const sortedLabels = labels
    .filter((label) => label.anchor === anchor)
    .map((label) => label.y)
    .sort((left, right) => left - right);
  for (let index = 1; index < sortedLabels.length; index += 1) {
    assert.ok(sortedLabels[index] - sortedLabels[index - 1] >= 17,
      "labels in one field column must not collide");
  }
}

const selectedOutsideTopFive = layoutAnalyticsEfficiencyField(
  Array.from({ length: 7 }, (_, index) => ({
    channelId: `rank-${index}`,
    name: `Rank ${index}`,
    slug: `rank-${index}`,
    totalViews: 100 - index,
    costTotal: index,
    videoCount: 1,
  })),
  "rank-6",
);
assert.ok(selectedOutsideTopFive.find((node) => node.channelId === "rank-6")?.label,
  "the selected channel stays labelled even outside the leading five");

console.log("Analytics efficiency field collision and selection tests passed");
