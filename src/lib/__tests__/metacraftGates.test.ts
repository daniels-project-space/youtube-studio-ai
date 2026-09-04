import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintTitle } from "@/lib/metacraft";

// P2-1 (GOLDEN_MODULE_AUDIT_2026-08.md): "metadata gate internals unverified
// (clickScore >=7, payoff-in-50-chars, claims-grounding lint) and no dedicated
// test exists." This file exercises the two gates that are deterministic and
// callable in isolation (lintTitle's payoff-window + claims-grounding checks),
// then pins the clickScore/direct >=7 judge gate — which lives inside
// craftMetadata's live permitted-model/YouTube-Data round trip and cannot run without
// network + ANTHROPIC_API_KEY — via a source-anchored assertion so a silent
// weakening of the threshold breaks this test instead of shipping quietly.

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

// Length bounds (25-76 chars).
//
// The ceiling was 85 while the doctrine, the prompt and this module's own docs
// all said 40-70 — so the target was advice and only the extreme was a gate.
// Measured across the real content plan that produced a median of 73 characters
// with 70% of titles running past the point a mobile browse row truncates.
{
  const short = lintTitle("Too Short");
  assert.ok(short.issues.some((i) => i.includes("too short")), "under-25-char title must fail length gate");
  const long = lintTitle("x".repeat(90));
  assert.ok(long.issues.some((i) => i.includes("> 76")), "over-76-char title must fail length gate");

  // The band the old ceiling waved through. This is the tightening itself, so
  // it is pinned: an 80-character title used to be perfectly acceptable.
  const eighty = lintTitle("Why The Roman Empire Collapsed Faster Than Anyone Alive At The Time Expected It");
  assert.equal(eighty.pass, false, "an 80-char title must no longer pass");
  assert.ok(eighty.issues.some((i) => i.includes("> 76")), `expected a length issue; got ${JSON.stringify(eighty.issues)}`);
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

/* ------- craftMetadata judge gate (clickScore & direct >=7) -- pinned ------ */
//
// craftMetadata() ranks title candidates through a live permitted-model judge call and
// only accepts a winner when BOTH clickScore and direct clear 7 (metacraft.ts).
// That round trip needs ANTHROPIC_API_KEY plus network and cannot run as a plain
// unit test, so this pins the literal threshold expression: if a future edit
// silently loosens the gate (e.g. drops the `direct` half, or lowers either
// number), this assertion breaks loudly instead of the regression shipping
// unnoticed, per P2-1's own effort note ("Read + add one unit test").
{
  const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
  const gateExpr = "(r.clickScore ?? 0) >= 7 && (r.direct ?? 10) >= 7";
  assert.ok(
    source.includes(gateExpr),
    "metacraft.ts: craftMetadata's judge gate must still require BOTH clickScore >=7 AND direct >=7 " +
      "(catalog claim: 'clickScore >=7') — literal expression not found, gate may have moved or weakened",
  );
  // The gate's own rejection message, surfaced in the retry-fix-loop, is the
  // second half of the wiring proof: a rejected slate must say so and retry.
  assert.ok(
    source.includes('lastIssues.push("no candidate gated clickScore+direct ≥7")'),
    "metacraft.ts: the judge-rejection retry path must still exist so a failed gate causes a real retry, not a silent pass",
  );
}

console.log("metacraftGates.test.ts: craftMetadata clickScore+direct >=7 judge gate pinned against live source");
