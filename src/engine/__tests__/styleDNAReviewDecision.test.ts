import assert from "node:assert/strict";

import { resolveStyleDNAReview } from "@/engine/creative/styleDNA";

const noCritic = resolveStyleDNAReview({ deterministicIssues: [], criticScore: undefined });
assert.equal(noCritic.pass, false, "a failed independent critic must not inherit the acceptance threshold");
assert.equal(noCritic.score, 0.5);
assert.match(noCritic.issues.join(" "), /critic unavailable/i);

const cleared = resolveStyleDNAReview({ deterministicIssues: [], criticScore: 0.86 });
assert.equal(cleared.pass, true);
assert.equal(cleared.score, 0.86);

const contradictoryCritic = resolveStyleDNAReview({
  deterministicIssues: [],
  criticScore: 0.94,
  criticIssues: ["The recurring motif is generic and could describe any astronomy channel."],
});
assert.equal(contradictoryCritic.pass, false,
  "a passing score cannot override a concrete repair issue from the independent identity critic");
assert.ok(contradictoryCritic.issues.some((issue) => issue.includes("identified repair issues")));

const deterministicFailure = resolveStyleDNAReview({
  deterministicIssues: ["setting is empty"],
  criticScore: 0.96,
});
assert.equal(deterministicFailure.pass, false, "deterministic identity failures must block acceptance");
assert.equal(deterministicFailure.score, 0.6, "deterministic failures must retain the existing score cap");

const lowScore = resolveStyleDNAReview({ deterministicIssues: [], criticScore: 0.74 });
assert.equal(lowScore.pass, false);
assert.match(lowScore.issues.join(" "), /below the 0\.80 acceptance bar/);

const invalidScore = resolveStyleDNAReview({ deterministicIssues: [], criticScore: Number.NaN });
assert.equal(invalidScore.pass, false, "non-finite critic output must fail closed");

console.log("style DNA critic acceptance tests passed");
