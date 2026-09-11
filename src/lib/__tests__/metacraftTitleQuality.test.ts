import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintTitle, resolveTitleProfile, titleQualitySignal } from "@/lib/metacraft";

const grounding = "Chernobyl failed one safety test and the ignored warning changed the outcome.";
const concrete = titleQualitySignal("Chernobyl Failed One Safety Test", grounding);
const generic = titleQualitySignal("What Really Happened And Why It Matters In The End", grounding);

assert.ok(
  concrete.score > generic.score,
  `a grounded, concrete title should outrank generic framing (${concrete.score} <= ${generic.score})`,
);
assert.ok(concrete.earlySpecifics >= 2, "the subject and concrete payoff should be visible before the mobile fold");

const repeated = titleQualitySignal("Chernobyl Chernobyl Safety Test", grounding);
assert.ok(repeated.repeatedTerms > 0, "repeated content words must be measurable");
assert.ok(repeated.score < concrete.score, "repeated wording must lower the local quality signal");

// Format profiles keep the title engine from forcing the same envelope onto a
// short or music loop. The hard bounds remain generous, while the target band
// supplies a measurable, local tie-break signal with no extra model call.
assert.equal(resolveTitleProfile(undefined, { family: "shorts" }), "short_form");
assert.equal(resolveTitleProfile(undefined, { contentLane: "music_loop" }), "music_loop");
assert.equal(resolveTitleProfile(undefined, { contentLane: "lore_micro_doc" }), "serialized_lore");
assert.equal(resolveTitleProfile(undefined, { niche: "tax education" }), "searchable_long");
assert.equal(resolveTitleProfile("motivational"), "motivational");

const shortTitle = "Morning Habit Changes Your Routine";
const shortProfile = titleQualitySignal(shortTitle, shortTitle, "short_form");
assert.equal(shortProfile.profile, "short_form");
assert.equal(shortProfile.inTargetBand, true);
assert.ok(shortProfile.frontLoadedTerms >= 2, "a short title should expose grounded terms immediately");
assert.ok(
  lintTitle("A Very Long Short Form Title That Keeps Adding Unneeded Context For Every Viewer", { profile: "short_form" }).issues
    .some((issue) => issue.includes("> 65")),
  "short-form profile must enforce its own hard ceiling",
);

const setup = titleQualitySignal("What Really Happened And Why It Matters", grounding);
assert.ok(concrete.frontLoadedTerms > setup.frontLoadedTerms, "front-loaded subject terms must be measurable");
assert.ok(concrete.score > setup.score, "generic setup must lose the local impact tie-break");

const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
assert.match(
  source,
  /survivors\[y\.idx!\]\?\.quality\.score/,
  "the deterministic signal must only break equal provider-judge scores, never replace the judge",
);
assert.match(source, /FORMAT PROFILE/, "the generator must receive the resolved format profile");
assert.match(source, /titleProfile\.targetMinChars/, "the judge must see the same profile envelope as the generator");

console.log("METACRAFT TITLE QUALITY PASS");
