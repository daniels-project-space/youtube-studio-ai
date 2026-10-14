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
  source: "declared",
  rejectedDeclaredStart: false,
  rejectedIntroOffset: false,
});
assert.deepEqual(resolveFinalMasterNarrationStartSec({
  ...base,
  introApplied: true,
  introSec: 1.25,
}), {
  startSec: 1.25,
  source: "intro",
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
  source: "intro",
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
  source: "master_start",
  rejectedDeclaredStart: false,
  rejectedIntroOffset: true,
});
assert.equal(resolveFinalMasterNarrationStartSec({
  ...base,
  introSec: Number.NaN,
}).startSec, 0, "an unused intro offset does not affect a no-intro route");
assert.equal(resolveFinalMasterNarrationStartSec({
  ...base,
  narrationStartSec: Number.NaN,
  productionQa: false,
}).source, "master_start", "a malformed draft offset without an intro falls back to the master start");

console.log("FINAL-MASTER NARRATION START PASS: explicit and intro clocks are bounded; production rejects unknown timing");
