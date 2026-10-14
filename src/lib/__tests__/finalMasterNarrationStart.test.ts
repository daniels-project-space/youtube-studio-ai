import assert from "node:assert/strict";
import { resolveFinalMasterNarrationStartSec } from "@/lib/visualReview";

const base = {
  narrationStartSec: undefined,
  introApplied: false,
  introSec: undefined,
  finalMasterDurationSec: 60,
  productionQa: true,
};

assert.deepEqual(resolveFinalMasterNarrationStartSec({ ...base, narrationStartSec: 2.5 }), {
  startSec: 2.5,
  rejectedDeclaredStart: false,
  rejectedIntroOffset: false,
});
assert.deepEqual(resolveFinalMasterNarrationStartSec({
  ...base,
  introApplied: true,
  introSec: 1.25,
}), {
  startSec: 1.25,
  rejectedDeclaredStart: false,
  rejectedIntroOffset: false,
});
assert.equal(resolveFinalMasterNarrationStartSec(base).startSec, 0);

for (const introSec of [undefined, null, false, "", Number.NaN, -0.1, 60.1]) {
  assert.throws(() => resolveFinalMasterNarrationStartSec({
    ...base,
    introApplied: true,
    introSec,
  }), /applied intro lacks a valid narration offset/);
}
assert.throws(() => resolveFinalMasterNarrationStartSec({
  ...base,
  narrationStartSec: Number.NaN,
}), /narration start evidence is malformed/);
for (const narrationStartSec of [null, false, ""]) {
  assert.throws(() => resolveFinalMasterNarrationStartSec({
    ...base,
    narrationStartSec,
  }), /narration start evidence is malformed/);
}

const draftFallback = resolveFinalMasterNarrationStartSec({
  ...base,
  narrationStartSec: Number.NaN,
  introApplied: true,
  introSec: 3,
  productionQa: false,
});
assert.deepEqual(draftFallback, {
  startSec: 3,
  rejectedDeclaredStart: true,
  rejectedIntroOffset: false,
});
assert.deepEqual(resolveFinalMasterNarrationStartSec({
  ...base,
  introApplied: true,
  introSec: Number.NaN,
  productionQa: false,
}), {
  startSec: 0,
  rejectedDeclaredStart: false,
  rejectedIntroOffset: true,
});
assert.equal(resolveFinalMasterNarrationStartSec({
  ...base,
  introSec: Number.NaN,
}).startSec, 0, "an unused intro offset does not affect a no-intro route");

console.log("FINAL-MASTER NARRATION START PASS: explicit and intro clocks are bounded; production rejects unknown timing");
