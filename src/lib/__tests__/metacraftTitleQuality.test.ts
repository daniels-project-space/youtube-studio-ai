import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { areNearDuplicateTitles, dedupeTitleCandidates, deterministicTitleFallback, lintTitle, resolveTitleProfile, titleOpeningSignal, titleQualitySignal } from "@/lib/metacraft";

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

const fallback = deterministicTitleFallback(
  "A very long topic with a concrete promise that should stop cleanly at a word boundary for mobile viewers",
  "short_form",
);
assert.ok(fallback.length <= 65, "deterministic fallback must obey the selected hard envelope");
assert.equal(fallback, "A very long topic with a concrete promise that should stop", "fallback should clip at a word boundary");

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

// The title must begin paying off in the first spoken beat. This is a lexical
// floor, deliberately weaker than semantic judging: one shared content term
// is enough, while a concrete numeric promise must be spoken there as well.
const openingMatch = titleOpeningSignal(
  "Chernobyl Failed One Safety Test",
  "Chernobyl failed one safety test, and the ignored warning changed the outcome.",
);
assert.equal(openingMatch.pass, true);
assert.ok(openingMatch.matchedTerms.includes("chernobyl"));
assert.equal(
  lintTitle("Chernobyl Failed One Safety Test", {
    grounding,
    opening: "Chernobyl failed one safety test before the warning was ignored.",
  }).pass,
  true,
  "a title whose subject starts in the opening must pass the promise floor",
);
const openingMismatch = titleOpeningSignal(
  "The Bridge That Killed 47 Engineers",
  "Today we examine a quiet village archive and the letter it preserved.",
);
assert.equal(openingMismatch.pass, false);
assert.equal(openingMismatch.numbersMatch, false);
assert.equal(
  titleOpeningSignal("Why 47?", "Today we examine a quiet village archive.").pass,
  false,
  "a numeric-only promise must not bypass the opening-number check",
);
assert.equal(
  titleOpeningSignal("Why 1?", "Someone kept the archive quiet.").numbersMatch,
  false,
  "spoken one must not match inside an unrelated word",
);
assert.equal(
  titleOpeningSignal("Why 10?", "An intense review of the archive follows.").numbersMatch,
  false,
  "spoken ten must not match inside an unrelated word",
);
assert.equal(
  titleOpeningSignal("Why 47?", "Forty-seven records were sealed.").numbersMatch,
  true,
  "a hyphenated spoken number remains a valid opening match",
);
assert.ok(
  lintTitle("The Signal 1 Changed Everything", {
    grounding: "The signal changed everything for someone in the archive.",
  }).issues.some((issue) => issue.includes('ungrounded number "1"')),
  "grounding must not accept a digit from a substring inside an unrelated word",
);
const mismatchLint = lintTitle("The Bridge That Killed 47 Engineers", {
  grounding: "Investigators confirmed 47 engineers died when the bridge gave way.",
  opening: "Today we examine a quiet village archive and the letter it preserved.",
});
assert.ok(
  mismatchLint.issues.filter((issue) => issue.includes("opening promise mismatch")).length >= 2,
  "a subject and numeric promise absent from the opening must fail visibly",
);

const setup = titleQualitySignal("What Really Happened And Why It Matters", grounding);
assert.ok(concrete.frontLoadedTerms > setup.frontLoadedTerms, "front-loaded subject terms must be measurable");
assert.ok(concrete.score > setup.score, "generic setup must lose the local impact tie-break");

assert.equal(
  areNearDuplicateTitles("Chernobyl Failed One Safety Test", "Chernobyl One Safety Test Failed"),
  true,
  "word-order paraphrases should not consume separate candidate slots",
);
assert.equal(
  areNearDuplicateTitles("Chernobyl Failed One Safety Test", "Why Chernobyl's Warning Changed Everything"),
  false,
  "a different curiosity hypothesis must remain available to the judge",
);
const slate = dedupeTitleCandidates([
  { frame: "direct", title: "Chernobyl Failed One Safety Test" },
  { frame: "contrarian", title: "Chernobyl One Safety Test Failed" },
  { frame: "curiosity", title: "Why Chernobyl's Warning Changed Everything" },
]);
assert.deepEqual(slate.map((candidate) => candidate.frame), ["direct", "curiosity"]);

const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
assert.match(
  source,
  /survivors\[y\.idx!\]\?\.quality\.score/,
  "the deterministic signal must only break equal provider-judge scores, never replace the judge",
);
assert.match(source, /FORMAT PROFILE/, "the generator must receive the resolved format profile");
assert.match(source, /titleProfile\.targetMinChars/, "the judge must see the same profile envelope as the generator");
assert.match(source, /dedupeTitleCandidates\(exactUnique\)/, "paraphrase-only candidate slates must be reduced before judging");
assert.match(source, /opening: \[a\.coldOpen, a\.hookLoop\]/, "metacraft must apply the independent opening promise floor before judging");

console.log("METACRAFT TITLE QUALITY PASS");
