import assert from "node:assert/strict";

import { buildChessReplay } from "@/engine/chessReplay";
import {
  assertChessNarrationPlan,
  assertChessNarrationTiming,
  bindChessNarrationTiming,
  buildChessNarrationPlan,
} from "@/engine/chessNarration";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { castleSource, enPassantSource, openingSource, promotionSource } from "../../../test-fixtures/chess-replay/fixture";

function measuredPlan(source = openingSource) {
  const plan = buildChessNarrationPlan(buildChessReplay(source));
  const timing = bindChessNarrationTiming({
    narrationPlan: plan,
    sentenceTimings: plan.segments.map((segment, index) => ({
      text: segment.text,
      start: index * 2.4,
      end: index * 2.4 + 2,
    })),
    narrationDurationSec: (plan.segments.length - 1) * 2.4 + 2,
  });
  return { plan, timing };
}

const opening = measuredPlan();
assert.equal(opening.plan.segments.length, 6);
assert.equal(opening.plan.segments[0]!.text, "White plays e4: the pawn moves from e2 to e4.");
assert.equal(opening.plan.segments[1]!.text, "Black plays e5: the pawn moves from e7 to e5.");
assert.deepEqual(assertChessNarrationPlan(opening.plan), opening.plan);
assert.deepEqual(assertChessNarrationTiming(opening.timing, opening.plan), opening.timing);

const castle = measuredPlan(castleSource).plan;
assert.match(castle.segments[0]!.text, /castles kingside from e1 to g1/);
assert.match(castle.segments[1]!.text, /castles queenside from e8 to c8/);
const enPassant = measuredPlan(enPassantSource).plan;
assert.match(enPassant.segments[0]!.text, /captures Black's pawn and moves from e5 to d6/);
const promotion = measuredPlan(promotionSource).plan;
assert.match(promotion.segments[0]!.text, /promoting to a knight/);

let rejected = 0;
for (const mutate of [
  (value: ReturnType<typeof measuredPlan>) => { value.plan.segments[0]!.text = "White finds a brilliant sacrifice."; },
  (value: ReturnType<typeof measuredPlan>) => { value.timing.segments.pop(); },
  (value: ReturnType<typeof measuredPlan>) => { value.timing.segments[0]!.text = "Black castles on the opposite side."; },
  (value: ReturnType<typeof measuredPlan>) => { value.timing.segments[0]!.end = 0.9; },
  (value: ReturnType<typeof measuredPlan>) => { value.timing.segments[1]!.start = 1.5; },
  (value: ReturnType<typeof measuredPlan>) => { value.timing.narrationDurationSec -= 1; },
] as const) {
  const candidate = structuredClone(measuredPlan());
  mutate(candidate);
  // Rehash the outer receipt in the two hash-sensitive cases: validation must
  // reject forged meaning/timing even when a caller knows canonical JSON.
  candidate.plan.fingerprint = sha256Hex(canonicalJson({
    version: candidate.plan.version,
    replay: candidate.plan.replay,
    replayFingerprint: candidate.plan.replayFingerprint,
    segments: candidate.plan.segments,
    narrationText: candidate.plan.narrationText,
  }));
  candidate.timing.fingerprint = sha256Hex(canonicalJson({
    version: candidate.timing.version,
    narrationPlanFingerprint: candidate.timing.narrationPlanFingerprint,
    replayFingerprint: candidate.timing.replayFingerprint,
    segments: candidate.timing.segments,
    narrationDurationSec: candidate.timing.narrationDurationSec,
  }));
  assert.throws(() => {
    const plan = assertChessNarrationPlan(candidate.plan);
    assertChessNarrationTiming(candidate.timing, plan);
  }, `mutation ${rejected} must fail before board timing is accepted`);
  rejected++;
}

console.log(`Chess narration: ${rejected} forged/reordered/shortened move-cue handoffs rejected; legal replay → spoken move → measured timing is source-bound.`);
