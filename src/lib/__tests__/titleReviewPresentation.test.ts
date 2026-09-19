import assert from "node:assert/strict";
import { readTitleReview } from "../titleReviewPresentation";

const title = "47 Engineers Died in the Bridge Collapse";
function outputs() {
  return { title, titleDecision: {
    version: "title-decision/v1", judged: true, title, titleAlternate: "The Design Error Behind the Bridge Collapse",
    clickScore: 9, directness: 8, winnerIndex: 1, alternateIndex: 2, attempts: 1,
    sourceCoverage: { kind: "full_narration", providedChars: 8400, totalChars: 8400 },
    candidates: [{ title: "47 Engineers Survived the Bridge Collapse" }, { title },
      { title: "The Design Error Behind the Bridge Collapse" }],
    // Deliberately not in candidate order: pairing by array position is wrong.
    rankings: [
      { idx: 2, clickScore: 8, direct: 8, identityFit: 8, grounding: "supported", reason: "The script explains the design failure." },
      { idx: 0, clickScore: 10, direct: 10, identityFit: 9, grounding: "contradicted", reason: "The narration says no engineers survived." },
      { idx: 1, clickScore: 9, direct: 8, identityFit: 9, grounding: "supported", reason: "The source states that 47 engineers died." },
    ],
  } };
}

const input = outputs(), before = structuredClone(input);
const review = readTitleReview(input);
assert.ok(review && review.state === "recorded");
assert.equal(review.source, "Full narration");
assert.equal(review.selected.title, title);
assert.equal(review.selected.pull, 9);
assert.equal(review.selected.reason, input.titleDecision.rankings[2].reason);
assert.equal(review.options[0].grounding, "contradicted");
assert.equal(review.options[0].selected, false, "the highest click score is not necessarily the selected title");
assert.equal(review.options[2].alternate, true);
assert.deepEqual(input, before, "presentation never rewrites the decision or input arrays");
for (const value of [null, undefined, [], false, "legacy", {}, { title }, { titleDecision: undefined }]) {
  assert.equal(readTitleReview(value), null, "legacy outputs must not acquire invented review evidence");
}
assert.equal(readTitleReview({ ...outputs(), title: "Changed after the review" })?.state, "title_changed");
assert.equal(readTitleReview({ titleDecision: outputs().titleDecision })?.state, "title_changed");
for (const kind of ["script_excerpt", "topic_only"]) {
  const out = outputs();
  out.titleDecision.sourceCoverage = { kind, providedChars: kind === "topic_only" ? 0 : 100, totalChars: 8400 };
  const result = readTitleReview(out);
  assert.ok(result && result.state === "recorded");
  assert.equal(result.source, kind === "topic_only" ? "Topic only" : "Script excerpt");
}
// Browser validation is a shape check, not a rerun of the source-aware judge.
const changedVerdict = outputs(); changedVerdict.titleDecision.rankings[2].grounding = "insufficient";
const recordedVerdict = readTitleReview(changedVerdict);
assert.ok(recordedVerdict && recordedVerdict.state === "recorded");
assert.equal(recordedVerdict.selected.grounding, "insufficient", "show the recorded model verdict, never upgrade it to proof");

const mutations: Array<(out: ReturnType<typeof outputs>) => void> = [
  (o) => { o.titleDecision.version = "future-version"; },
  (o) => { o.titleDecision.judged = false; },
  (o) => { o.titleDecision.winnerIndex = 8; },
  (o) => { o.titleDecision.winnerIndex = 1.5; },
  (o) => { o.titleDecision.alternateIndex = 1; },
  (o) => { o.titleDecision.titleAlternate = "Not the saved alternate"; },
  (o) => { o.titleDecision.title = "Not the selected candidate"; },
  (o) => { o.titleDecision.directness = 0; },
  (o) => { o.titleDecision.rankings[0].idx = 1; },
  (o) => { o.titleDecision.rankings[0].clickScore = NaN; },
  (o) => { o.titleDecision.rankings[0].identityFit = Infinity; },
  (o) => { o.titleDecision.rankings[0].direct = -1; },
  (o) => { o.titleDecision.rankings[0].grounding = "verified"; },
  (o) => { o.titleDecision.rankings[0].reason = ""; },
  (o) => { o.titleDecision.rankings.pop(); },
  (o) => { o.titleDecision.candidates[0].title = "x".repeat(101); },
  (o) => { o.titleDecision.attempts = 3; },
  (o) => { o.titleDecision.sourceCoverage.totalChars = 9000; },
  (o) => { o.titleDecision.sourceCoverage.providedChars = -1; },
];
for (const mutate of mutations) {
  const out = outputs(); mutate(out);
  assert.deepEqual(readTitleReview(out), { state: "unavailable" }, String(mutate));
}
for (const raw of [null, [], {}, "wrong"]) {
  assert.deepEqual(readTitleReview({ titleDecision: raw }), { state: "unavailable" });
}
console.log("title review presentation passed: indexed candidates, legacy, malformed, drift and source coverage");
