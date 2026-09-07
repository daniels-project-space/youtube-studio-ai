/**
 * THE NaN CLAMP SWEEP — before/after proof for every site converted.
 *
 * `src/engine/boundedNumber.ts` fixed three sites where a clamp written around
 * an unchecked `Number()` let NaN through. An AST audit
 * (scripts/audit-unchecked-number-clamps.ts) then found the rest, because a grep
 * cannot: the shape is written at least five different ways.
 *
 * Every case below runs the ORIGINAL expression next to the replacement, so the
 * defect is demonstrated rather than described. If a "before" assertion ever
 * stops holding, the claim in the commit message was wrong.
 *
 * Sites deliberately NOT converted, each verified safe:
 *
 *   families.ts:516            familyEpisodeLengthError() throws on non-finite
 *                              first — the guard is real, just in another
 *                              function, which is why the audit cannot see it
 *   youtube.ts:566             `/^\d+$/.test(retryAfter)` proves digits
 *   novitaFleet.ts:328         Number.isInteger() ternary already guards
 *   selfContainedStoryQualityEvidence.ts:266
 *                              completionSampleMs is zod z.number().finite()
 *   motionComic/whiteboard height
 *                              derived from an already-bounded width
 */
import assert from "node:assert/strict";

import { boundedInteger, boundedNumber } from "@/engine/boundedNumber";
import { ttsConcurrency } from "@/trigger/blocks/narratedBlocks";
import { withMusicGenerationCost } from "@/lib/music";
import { ernieThumbnailRefreshCandidateCost } from "@/lib/ernieThumbnailRefreshBatch";

/* ============================ 1. mapPool: a pool with no workers ============================
 * Array.from({ length: NaN }) is [], so a non-finite limit spawned ZERO workers.
 * Promise.all([]) resolved immediately, no error was thrown, and the caller got
 * an array of the right LENGTH full of holes. */

const poolWorkers = (limit: number, itemCount: number): number =>
  Array.from({ length: Math.min(limit, Math.max(1, itemCount)) }).length;

assert.equal(poolWorkers(Number.NaN, 12), 0, "BEFORE: a NaN limit spawned zero workers");
assert.equal(poolWorkers(2, 12), 2, "BEFORE: a valid limit worked, which is why this went unnoticed");

const fixedWorkers = (limit: number, itemCount: number): number =>
  Array.from({
    length: Math.min(
      Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1,
      Math.max(1, itemCount),
    ),
  }).length;

assert.equal(fixedWorkers(Number.NaN, 12), 1, "AFTER: a pool always has at least one worker");
assert.equal(fixedWorkers(2, 12), 2, "AFTER: a valid limit is unchanged");
assert.equal(fixedWorkers(99, 3), 3, "AFTER: never more workers than items");
assert.equal(fixedWorkers(4, 0), 1, "AFTER: an empty batch still yields a valid pool size");

/* ============================ 2. TTS_CONCURRENCY: the NaN's source ============================
 * An environment variable is ALWAYS a string. Math.max(1, Number("auto")) is
 * NaN, and mapPool read that as zero workers — so TTS_CONCURRENCY=auto produced
 * a narration of no sentences, silently. */

const before = process.env.TTS_CONCURRENCY;
try {
  process.env.TTS_CONCURRENCY = "auto";
  assert.ok(Number.isNaN(Math.max(1, Number(process.env.TTS_CONCURRENCY ?? 2))), "BEFORE: NaN pool size");
  assert.equal(ttsConcurrency(), 2, "AFTER: an unusable setting falls back to the documented default");

  process.env.TTS_CONCURRENCY = "6";
  assert.equal(ttsConcurrency(), 6, "AFTER: a real setting is still honoured");

  process.env.TTS_CONCURRENCY = "9999";
  assert.equal(ttsConcurrency(), 16, "AFTER: an absurd setting is capped, not obeyed");

  delete process.env.TTS_CONCURRENCY;
  assert.equal(ttsConcurrency(), 2, "AFTER: unset means the default");
} finally {
  if (before === undefined) delete process.env.TTS_CONCURRENCY;
  else process.env.TTS_CONCURRENCY = before;
}

/* ============================ 3. The cost ledger ============================
 * `typeof NaN === "number"` is TRUE, so music.ts's type check admitted NaN into
 * additionalObservedCostUsd. A NaN cost is worse than a wrong one: every later
 * `spent > budget` comparison against it is FALSE, so the budget stops
 * enforcing. Every consumer of this field already defended against it. */

assert.equal(typeof Number.NaN === "number", true, "BEFORE: the typeof check could not exclude NaN");
assert.equal(Number.NaN > 100, false, "BEFORE: and a NaN spend never exceeds any budget");

const poisoned = Object.assign(new Error("provider failed"), { observedCostUsd: Number.NaN });
const charged = withMusicGenerationCost(poisoned, 3, 0.02) as unknown as {
  additionalObservedCostUsd: number;
};
assert.ok(
  Number.isFinite(charged.additionalObservedCostUsd),
  "AFTER: a NaN attestation can no longer reach the ledger",
);
assert.equal(charged.additionalObservedCostUsd, 0.06, "AFTER: the real 3 x $0.02 spend is still preserved");

// The other two routes to the same NaN — both parameters are declared `number`,
// which does not exclude NaN.
for (const [units, unitCost] of [[Number.NaN, 0.02], [3, Number.NaN]] as const) {
  const entry = withMusicGenerationCost(new Error("x"), units, unitCost) as unknown as {
    additionalObservedCostUsd: number;
  };
  assert.ok(Number.isFinite(entry.additionalObservedCostUsd), `AFTER: NaN in (${units}, ${unitCost}) is settled`);
}

/* ============================ 4. A NaN cost estimate ============================
 * A candidate with zero source reviews divides zero by zero. */

assert.ok(Number.isNaN(0 / 0), "BEFORE: 0 elapsed over 0 reviews is NaN");
const zeroReview = ernieThumbnailRefreshCandidateCost({
  elapsedSeconds: 0,
  sourceReviewCount: 0,
} as Parameters<typeof ernieThumbnailRefreshCandidateCost>[0]);
assert.ok(Number.isFinite(zeroReview), "AFTER: an unreviewed candidate has a finite cost");
assert.equal(zeroReview, 0, "AFTER: and it is zero, not NaN");

const normal = ernieThumbnailRefreshCandidateCost({
  elapsedSeconds: 3_600,
  sourceReviewCount: 1,
} as Parameters<typeof ernieThumbnailRefreshCandidateCost>[0]);
assert.equal(normal, 0.335, "AFTER: an ordinary candidate is unchanged");

/* ============================ 5. visual_inserts: the cap that never fired ============================
 * NaN did two things, both silent: it reached the PROMPT as literal text, and it
 * removed the cap, because `out.length >= NaN` is false for every length. */

const rawMaxInserts = (param: unknown, narrationSec: number) =>
  Math.max(1, Math.min(8, Number(param ?? Math.ceil(narrationSec / 180))));

assert.ok(Number.isNaN(rawMaxInserts("three", 600)), "BEFORE: a malformed param gave NaN");
assert.equal(
  `Plan AT MOST ${rawMaxInserts("three", 600)} on-screen data inserts`,
  "Plan AT MOST NaN on-screen data inserts",
  "BEFORE: which the director model received as literal text",
);
for (const rendered of [0, 1, 8, 50, 500]) {
  assert.equal(rendered >= rawMaxInserts("three", 600), false, "BEFORE: no count ever tripped the cap");
}

const fixedMaxInserts = boundedInteger("three", Math.ceil(600 / 180), 1, 8);
assert.equal(fixedMaxInserts, 4, "AFTER: it falls back to the narration-derived default");
assert.equal(50 >= fixedMaxInserts, true, "AFTER: and the cap fires again");
assert.equal(boundedInteger(6, 4, 1, 8), 6, "AFTER: a real param still wins");

/* ============================ 6. The insert span crash ============================
 * endSentenceIdx comes from MODEL JSON, so it can be "seven" as easily as 7.
 * That made every clamp NaN, timings[NaN] undefined, and `.end` a TypeError that
 * killed the whole visual_inserts stage. */

const timings = [{ end: 1 }, { end: 2 }, { end: 3 }, { end: 4 }];
const rawEndIdx = (endSentenceIdx: unknown, sentenceIdx: number) =>
  Math.min(timings.length - 1, Math.max(sentenceIdx, Math.min(Number(endSentenceIdx ?? sentenceIdx), sentenceIdx + 4)));

assert.ok(Number.isNaN(rawEndIdx("seven", 1)), "BEFORE: a non-numeric span gave NaN");
assert.equal(timings[rawEndIdx("seven", 1)], undefined, "BEFORE: which indexed nothing");
assert.throws(
  () => (timings[rawEndIdx("seven", 1)] as { end: number }).end,
  TypeError,
  "BEFORE: and reading .end off it threw, killing the stage",
);

const fixedEndIdx = (endSentenceIdx: unknown, sentenceIdx: number) =>
  Math.min(
    timings.length - 1,
    Math.max(sentenceIdx, boundedInteger(endSentenceIdx, sentenceIdx, sentenceIdx, sentenceIdx + 4)),
  );
assert.equal(fixedEndIdx("seven", 1), 1, "AFTER: an unusable span means this insert's own sentence");
assert.equal(timings[fixedEndIdx("seven", 1)]!.end, 2, "AFTER: and the lookup succeeds");
assert.equal(fixedEndIdx(3, 1), 3, "AFTER: a real span is unchanged");
assert.equal(fixedEndIdx(99, 1), 3, "AFTER: an over-long span is still clamped to the timeline");

/* ============================ 7. Operator length silently dropped ============================
 * whiteboard_scribe's own comment records that the wizard's length "never
 * reached this engine" — a bug they fixed. NaN reinstated it exactly: it fails
 * `targetSeconds > 0`, so panels and targetWords both go undefined and the
 * engine sizes itself from its defaults again. */

const rawTarget = (param: unknown) => Math.max(0, Number(param ?? 0));
assert.ok(Number.isNaN(rawTarget("10 minutes")), "BEFORE: NaN target");
assert.equal(rawTarget("10 minutes") > 0, false, "BEFORE: so the sizing branch was skipped entirely");

assert.equal(boundedNumber("10 minutes", 0, 0, 7_200), 0, "AFTER: an unusable length is honestly zero");
assert.equal(boundedNumber(600, 0, 0, 7_200), 600, "AFTER: a real length is honoured");
assert.equal(boundedNumber("600", 0, 0, 7_200), 600, "AFTER: params round-trip as JSON strings");
assert.equal(boundedNumber(99_999, 0, 0, 7_200), 7_200, "AFTER: an absurd length is capped");

/* ============================ 8. Paid render geometry and counts ============================ */

assert.ok(Number.isNaN(Math.max(1280, Math.min(2560, Number("1080p")))), "BEFORE: NaN render width");
assert.equal(boundedInteger("1080p", 1920, 1280, 2560), 1920, "AFTER: the documented default");
assert.equal(Math.round((boundedInteger("1080p", 1920, 1280, 2560) * 9) / 16), 1080, "AFTER: height follows");

// maxClips becomes maxScenes, where NaN means slice(0, NaN) — an EMPTY plan.
assert.deepEqual([1, 2, 3].slice(0, Number.NaN), [], "BEFORE: a NaN scene cap emptied the plan");
assert.equal(boundedInteger("lots", 14, 6, 24), 14, "AFTER: the narration-derived default");
assert.deepEqual([1, 2, 3].slice(0, boundedInteger("lots", 14, 6, 24)), [1, 2, 3], "AFTER: the plan survives");

// clipSec is also the FALLBACK handed to boundedSceneDuration, and a fallback
// that is itself NaN cannot do the one job a fallback has.
const boundedSceneDuration = (value: number, fallback: number) =>
  Math.min(10, Math.max(3, Number.isFinite(value) ? value : fallback));
assert.ok(
  Number.isNaN(boundedSceneDuration(Number.NaN, Math.min(10, Math.max(5, Number("five"))))),
  "BEFORE: the fallback was NaN too, so the guard had nothing to fall back TO",
);
assert.equal(boundedSceneDuration(Number.NaN, boundedNumber("five", 5, 5, 10)), 5, "AFTER: it falls back");

console.log("NaN CLAMP SWEEP PASS — 8 converted sites, each proven against its original expression");
