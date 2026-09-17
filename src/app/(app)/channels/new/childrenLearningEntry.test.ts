import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NICHES, getNiche } from "@/lib/nicheCatalog";
import { nichePreset } from "@/engine/golden";
import { channelMotionMotifFor } from "@/lib/channelMotion";

const children = getNiche("children_learning");
assert.ok(children, "Children’s Learning must be a first-class creator territory");
assert.equal(children.defaultFamily, "children_learning");
assert.equal(children.subcategories.length, 3, "the entry needs distinct lesson directions, not a generic education alias");
assert.equal(new Set(NICHES.map((niche) => niche.key)).size, NICHES.length, "creator territories must have unique keys");

assert.equal(nichePreset("children_learning")?.targetSeconds, 180);
assert.equal(channelMotionMotifFor({ niche: "children_learning" }), "storybook");

const page = readFileSync(join(process.cwd(), "src/app/(app)/channels/new/page.tsx"), "utf8");
assert.match(page, /"children_learning"/u, "the quick territory list must expose Children’s Learning");
assert.match(page, /supervisedCreatorSelectionForFamily/u, "supervised territory selection needs its own private-review conversion");
assert.match(page, /"\/children-review"/u, "a children-review recovery handoff must be a supported destination");
assert.match(page, /review ready/u, "a supervised learning route must not be mislabeled as held");

console.log("children learning creator entry tests passed");
