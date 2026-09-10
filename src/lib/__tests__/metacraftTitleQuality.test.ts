import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { titleQualitySignal } from "@/lib/metacraft";

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

const source = readFileSync(join(process.cwd(), "src/lib/metacraft.ts"), "utf8");
assert.match(
  source,
  /survivors\[y\.idx!\]\?\.quality\.score/,
  "the deterministic signal must only break equal provider-judge scores, never replace the judge",
);

console.log("METACRAFT TITLE QUALITY PASS");
