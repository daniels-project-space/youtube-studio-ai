import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lintTitle,
  titleJudgeRankingPassesQualityBar,
  validateTitleJudgeResponse,
} from "@/lib/metacraft";

// P2-1 (GOLDEN_MODULE_AUDIT_2026-08.md) identified untested metadata gates.
// This file exercises deterministic payoff/grounding lint and the exact pure
// judge-acceptance predicate used by craftMetadata, without a provider call.

/* ------------------------ payoff-in-50-chars gate ------------------------ */

// A payoff number landing at char 44 (well inside the ~50-char mobile-browse
// truncation window) must NOT be flagged.
{
  const r = lintTitle("The Reactor Meltdown That Nobody Saw Coming in 1986", {
    grounding: "The Reactor Meltdown That Nobody Saw Coming in 1986",
  });
  assert.ok(
    !r.issues.some((i) => i.includes("payoff number")),
    `a digit at char 44 must pass the 50-char payoff window; issues=${JSON.stringify(r.issues)}`,
  );
}

// The exact same payoff number pushed past char 50 by a longer lead-in must
// be flagged — the gate's whole purpose is catching content a mobile browse
// row truncates before the number ever renders.
{
  const title = "A Very Long Meandering Preamble Before The Number Ninety Nine Percent";
  const firstDigitIdx = title.search(/\d/);
  assert.equal(firstDigitIdx, -1, "sanity: this title intentionally spells the number out, no digit present");
  const withDigit = "A Very Long Meandering Preamble Before The Actual Number 99 Percent";
  const idx = withDigit.search(/\d/);
  assert.ok(idx > 50, `sanity: test fixture must place the digit past char 50, got idx=${idx}`);
  const r = lintTitle(withDigit, { grounding: withDigit });
  assert.ok(
    r.issues.some((i) => i.includes("payoff number") && i.includes(`char ${idx}`)),
    `a digit past char 50 must be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

// Boundary: exactly char 50 must still pass (gate is "> 50", not ">= 50").
{
  // 50 filler chars, then a digit at index 50 (0-based) = the 51st character.
  const filler = "x".repeat(50);
  const atBoundary = `${filler}7`;
  assert.equal(atBoundary.search(/\d/), 50);
  const r = lintTitle(atBoundary, { grounding: atBoundary });
  assert.ok(
    !r.issues.some((i) => i.includes("payoff number")),
    `char index exactly 50 must still pass (> not >=); issues=${JSON.stringify(r.issues)}`,
  );
  const pastBoundary = `${filler}x7`;
  assert.equal(pastBoundary.search(/\d/), 51);
  const r2 = lintTitle(pastBoundary, { grounding: pastBoundary });
  assert.ok(
    r2.issues.some((i) => i.includes("payoff number")),
    `char index 51 must fail; issues=${JSON.stringify(r2.issues)}`,
  );
}

/* ------------------------- claims-grounding lint -------------------------- */

// A number in the title that never appears (digit or spoken word) anywhere in
// the fact-checked grounding text must be rejected as a hallucinated claim.
{
  const r = lintTitle("The Bridge That Killed 47 Engineers Overnight", {
    grounding: "A documentary about a bridge collapse and its aftermath for the town.",
  });
  assert.ok(
    r.issues.some((i) => i.includes('ungrounded number "47"')),
    `a number absent from the script must be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

// The same number IS grounded, digit-for-digit, in the script excerpt.
{
  const r = lintTitle("The Bridge That Killed 47 Engineers Overnight", {
    grounding: "Investigators confirmed 47 engineers died when the span gave way at dawn.",
  });
  assert.ok(
    !r.issues.some((i) => i.includes("ungrounded number")),
    `a number present verbatim in the script must not be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

// Spoken-word grounding must satisfy a digit title (numberVariants bridges
// "37" <-> "thirty-seven" so narration that SPEAKS its numbers still grounds).
{
  const r = lintTitle("Why 37 Ships Vanished Without Warning", {
    grounding: "Historians counted thirty-seven ships lost in a single storm season.",
  });
  assert.ok(
    !r.issues.some((i) => i.includes("ungrounded number")),
    `spoken-word grounding ("thirty-seven") must satisfy the digit title ("37"); issues=${JSON.stringify(r.issues)}`,
  );
}

// A capitalized proper name invented by the title generator, absent from the
// grounding entirely, must be caught by the ungrounded-name check. (Title is
// deliberately mostly-lowercase/sentence-case so it exercises the per-word
// path, not the more lenient title-case "any word in the run" path below.)
{
  const r = lintTitle("Why a doomed climber called himself Bartholomew Voss", {
    grounding: "A story about a mountaineer who never returned from the summit attempt.",
  });
  assert.ok(
    r.issues.some((i) => i.includes('ungrounded name "Bartholomew"')),
    `a name absent from the script must be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

// The same name IS present in the grounding — must not be flagged.
{
  const r = lintTitle("Why a doomed climber called himself Bartholomew Voss", {
    grounding: "A climbing historian traces the final, fatal ascent of Bartholomew Voss.",
  });
  assert.ok(
    !r.issues.some((i) => i.includes("ungrounded name")),
    `a name present in the script must not be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

// Title-Case titles use a LOOSER run-based check (a run of capitalized words
// passes if ANY word in it is grounded) — documented in metacraft.ts's own
// comment as "only fully-alien runs are hallucinated names". A fully-alien
// title-case run (no word anywhere in the grounding) must still be caught.
{
  const r = lintTitle("The Vanquished Kingdom Of Braxthorne Falls Silent", {
    grounding: "A story about a small nation that lost a border war and disappeared from maps.",
  });
  assert.ok(
    r.issues.some((i) => i.includes("ungrounded name")),
    `a fully-alien title-case run must still be flagged; issues=${JSON.stringify(r.issues)}`,
  );
}

/* ---------------------------- other lint gates ---------------------------- */

// Length bounds (25-66 chars for the default browse profile).
//
// The target must be enforceable rather than a polite suggestion; the profile
// preserves format-specific room elsewhere (notably music-loop duration).
{
  const short = lintTitle("Too Short");
  assert.ok(short.issues.some((i) => i.includes("too short")), "under-25-char title must fail length gate");
  const long = lintTitle("x".repeat(90));
  assert.ok(long.issues.some((i) => i.includes("> 66")), "over-66-char browse title must fail length gate");

  // The visible-plan failure: the old ceiling admitted a 69-character
  // explainer title that loses its payoff in a compact browse row.
  const legacyLength = lintTitle("How to Turn $10,000 Into $1,000/Month Passive Income — The Exact Math", { profile: "searchable_long" });
  assert.equal(legacyLength.pass, false, "a 69-char searchable title must be repackaged rather than pass by default");
  assert.ok(legacyLength.issues.some((i) => i.includes("> 66")), `expected a length issue; got ${JSON.stringify(legacyLength.issues)}`);
}

// Mobile truncation, generalised beyond digits: a title whose every specific
// detail sits past the fold shows the scroller nothing but setup. The digit
// rule stays alongside it — a number pushed past the fold is a truncated payoff
// even when the opening words are vivid, and folding the two together silently
// retired the original gate.
{
  // Sentence case, so capitalisation still carries information about which word
  // is a name. The only proper noun sits at char 54 — past the fold.
  const allSetup = lintTitle("It turns out that what really happened here was about Chernobyl", {
    grounding: "it turns out that what really happened here was about chernobyl",
  });
  assert.ok(
    allSetup.issues.some((i) => i.includes("all setup")),
    `a title whose only specific detail sits past char 50 must be flagged; got ${JSON.stringify(allSetup.issues)}`,
  );

  const specificEarly = lintTitle("Chernobyl melted down because of one ignored safety test", {
    grounding: "chernobyl melted down because of one ignored safety test",
  });
  assert.ok(
    !specificEarly.issues.some((i) => i.includes("all setup")),
    `a title that front-loads its subject must pass; got ${JSON.stringify(specificEarly.issues)}`,
  );

  // Title Case hides which words are names, so the rule stands down rather than
  // guessing. Claiming a verdict it cannot support would be worse than silence.
  const titleCased = lintTitle("It Turns Out That What Really Happened Here Was About Chernobyl", {
    grounding: "it turns out that what really happened here was about chernobyl",
  });
  assert.ok(
    !titleCased.issues.some((i) => i.includes("all setup")),
    `Title Case must not be judged by this rule; got ${JSON.stringify(titleCased.issues)}`,
  );
}

// Filler-start ban.
{
  const r = lintTitle("The Story Of How One Village Vanished Overnight");
  assert.ok(r.issues.some((i) => i.includes("filler start")), "a canonical filler opener must be rejected");
}

// Setup-colon ban (>=4-word pre-colon fragment is scene-setting).
{
  const r = lintTitle("Ash Falls Like Black Snow Across The Valley: The Untold Story");
  assert.ok(r.issues.some((i) => i.includes("scene-setting")), "a long pre-colon fragment must be rejected");
}

// A short established-format prefix before a colon is explicitly allowed.
{
  const r = lintTitle("Mission Log: The Reactor Failed At The Worst Possible Moment");
  assert.ok(
    !r.issues.some((i) => i.includes("scene-setting")),
    `a short format prefix like "Mission log:" must be allowed; issues=${JSON.stringify(r.issues)}`,
  );
}

console.log("metacraftGates.test.ts: lintTitle payoff-window + claims-grounding lint behavior verified");

/* --------------------- strict judge-response admission -------------------- */

{
  const valid = validateTitleJudgeResponse({
    rankings: [
      { idx: 0, clickScore: 8, direct: 9, identityFit: 8, viewerMotivation: 9, grounding: "supported", reason: "fits the source and channel" },
      { idx: 1, clickScore: 7, direct: 7, identityFit: 7, viewerMotivation: 7, grounding: "supported", reason: "fits the source and channel" },
    ],
  }, 2);
  assert.equal(valid.pass, true, "a complete finite ranking should be admitted");
  assert.deepEqual(valid.rankings.map((row) => row.idx), [0, 1]);
  assert.equal(valid.rankings[0].grounding, "supported");
  assert.equal(valid.rankings[0].identityFit, 8);

  for (const [name, value] of [
    ["missing direct", { rankings: [{ idx: 0, clickScore: 9 }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["missing identity fit", { rankings: [{ idx: 0, clickScore: 9, direct: 9, grounding: "supported", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["missing viewer motivation", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, viewerMotivation: 8, grounding: "supported", reason: "ok" }] }],
    ["invalid grounding", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "maybe", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["empty reason", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["out-of-range identity fit", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 11, grounding: "supported", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["duplicate index", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "ok" }, { idx: 0, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["fractional index", { rankings: [{ idx: 0.5, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["out-of-range score", { rankings: [{ idx: 0, clickScore: 11, direct: 9, identityFit: 9, grounding: "supported", reason: "ok" }, { idx: 1, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "ok" }] }],
    ["incomplete coverage", { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "ok" }] }],
  ] as const) {
    const result = validateTitleJudgeResponse(value, 2);
    assert.equal(result.pass, false, `${name} judge evidence must fail closed`);
    assert.equal(result.rankings.length, 0, `${name} cannot leak a partial ranking downstream`);
  }
}

console.log("metacraftGates.test.ts: malformed, incomplete and missing-direct judge responses fail closed");

/* ------- executable title-quality acceptance gate ------------------------ */
{
  const accepted = {
    idx: 0,
    clickScore: 7,
    direct: 7,
    identityFit: 7,
    viewerMotivation: 7,
    grounding: "supported" as const,
    reason: "The source supports the promise and it fits the channel.",
  };
  assert.equal(titleJudgeRankingPassesQualityBar(accepted), true,
    "the exact threshold is inclusive when every independent quality dimension passes");

  for (const field of ["clickScore", "direct", "identityFit", "viewerMotivation"] as const) {
    assert.equal(titleJudgeRankingPassesQualityBar({ ...accepted, [field]: 6 }), false,
      `${field} below seven must reject the title`);
    assert.equal(titleJudgeRankingPassesQualityBar({ ...accepted, [field]: Number.POSITIVE_INFINITY }), false,
      `${field} must be finite even when the helper is called outside validated model output`);
  }
  for (const grounding of ["contradicted", "insufficient"] as const) {
    assert.equal(titleJudgeRankingPassesQualityBar({ ...accepted, grounding }), false,
      `${grounding} factual support must reject the title regardless of its scores`);
  }

  const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
  assert.ok(
    source.includes("admission.rankings.filter(titleJudgeRankingPassesQualityBar)"),
    "craftMetadata must rank only candidates that pass the executable quality-bar helper",
  );
  assert.ok(
    source.includes("validateTitleJudgeResponse(j, survivors.length)"),
    "metacraft.ts: judge responses must pass the strict complete-ranking admission boundary",
  );
  assert.ok(
    !source.includes("(r.direct ?? 10) >= 7"),
    "metacraft.ts: omitted directness must never default to a passing score",
  );
  assert.ok(
    !source.includes("(r.viewerMotivation ?? 10) >= 7"),
    "metacraft.ts: omitted viewer motivation must never default to a passing score",
  );
  assert.ok(
    !source.includes("shipping on lint alone"),
    "metacraft.ts: a judge transport failure must never ship a lint-only title",
  );
  assert.ok(
    source.includes("title judge unavailable") && source.includes("FAILING LOUD"),
    "metacraft.ts: judge transport failures must be named and fail closed after the bounded retry",
  );
  assert.ok(
    source.includes("ranking.identityFit, ranking.viewerMotivation") && source.includes('ranking.grounding === "supported"'),
    "the shared quality-bar helper must include channel fit, viewer motivation and factual grounding",
  );
  // The gate's own rejection message, surfaced in the retry-fix-loop, is the
  // second half of the wiring proof: a rejected slate must say so and retry.
  assert.ok(
    source.includes('lastIssues.push("no candidate gated clickScore+direct+identity+viewer motivation ≥7")'),
    "metacraft.ts: the judge-rejection retry path must still exist so a failed gate causes a real retry, not a silent pass",
  );
}

console.log("metacraftGates.test.ts: executable craftMetadata quality gate and production wiring verified");
