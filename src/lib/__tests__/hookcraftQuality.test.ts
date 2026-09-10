import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hookQualitySignal, HOOK_JUDGE_MAX_OUTPUT_TOKENS, HOOK_MAX_OUTPUT_TOKENS, lintHook } from "@/lib/hookcraft";

const topic = "Chernobyl's ignored safety test";
const concreteHook = "Chernobyl failed one safety test in 1986. The ignored warning changed the night.";
const concreteOpening = "At 1:23 a.m., engineers disabled the alarm in Reactor Four. Within minutes, a routine check became the decision that sent the roof into the sky. The surviving logs show who saw the warning first—and why the shutdown came too late.";
const genericHook = "The truth is stranger than anyone expected. Nobody saw the real danger coming.";
const genericOpening = "People remember the headline, but not the chain of choices behind it. Each small decision seemed harmless until the consequences arrived. The answer is hidden in the details most retellings leave out.";

const concrete = hookQualitySignal(concreteHook, concreteOpening, { topic });
const generic = hookQualitySignal(genericHook, genericOpening, { topic });
assert.ok(concrete.score > generic.score, "topic-specific anchors should outrank generic framing");
assert.ok(concrete.concreteAnchors >= 2, "numbers and proper names in the opening should be measurable");
assert.ok(concrete.topicMatches >= 1, "the local signal should measure overlap with the clicked topic");

const repeated = hookQualitySignal(
  "Chernobyl changed everything. Chernobyl changed the warning.",
  "The Chernobyl decision returned again and again in every account.",
  { topic },
);
assert.ok(repeated.repeatedTerms > concrete.repeatedTerms, "repeated content words should be visible to the signal");
assert.ok(repeated.score < concrete.score, "repetition should reduce the local quality score");

assert.equal(HOOK_MAX_OUTPUT_TOKENS, 3200, "generation output must stay bounded for four short candidates");
assert.equal(HOOK_JUDGE_MAX_OUTPUT_TOKENS, 1400, "judge output must stay bounded for the structured verdict");

const source = readFileSync(join(process.cwd(), "src/lib/hookcraft.ts"), "utf8");
assert.match(source, /rawCandidates/, "generated candidates should be deduplicated before lint/judge work");
assert.match(source, /selectedBest = best \?\? 0/, "provider best must remain authoritative when valid");
assert.match(source, /judge composite \+ local tie-break/, "local quality should only be a deterministic fallback/tie-break");

const lint = lintHook(concreteHook, concreteOpening);
assert.equal(lint.pass, true, `the concrete fixture should pass hook lint: ${lint.issues.join("; ")}`);

console.log("HOOKCRAFT QUALITY PASS");
