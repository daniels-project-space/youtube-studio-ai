import assert from "node:assert/strict";

import {
  footageCandidateIsEligible,
  footageRepairDirective,
  type FootageBrief,
} from "@/lib/footagecraft";

const repairBrief: FootageBrief = {
  topic: "Mira learns to care for a seed",
  orientation: "landscape",
  healHints: [
    "[visual-review @5.0s] narration_mismatch; observed: the prior scene remains visible; expected: the seed discovery is visible",
    "[visual-review @13.0s] reveal_failure; observed: the payoff is absent; expected: the sprout consequence visibly lands",
  ],
};

for (const phase of ["query", "gate"] as const) {
  const directive = footageRepairDirective(repairBrief, phase);
  assert.match(directive, /narration_mismatch/);
  assert.match(directive, /seed discovery is visible/);
  assert.match(directive, /reveal_failure/);
  assert.match(directive, /sprout consequence visibly lands/);
}
assert.match(
  footageRepairDirective(repairBrief, "query"),
  /Every new query must directly correct/i,
  "repair evidence must change search intent before candidates are fetched",
);
assert.match(
  footageRepairDirective(repairBrief, "gate"),
  /REJECT any candidate that repeats/i,
  "the same repair evidence must reject a recurring defect after search",
);
assert.equal(footageRepairDirective({ healHints: [] }, "query"), "");

const pickedIds = new Set<string>();
const usedUrls = new Set<string>();
const usedClipIds = new Set(["pexels:historical", "pexels:rejected"]);
const excludedClipIds = new Set(["pexels:rejected"]);
const eligible = (id: string, allowHistoricalReuse: boolean) => footageCandidateIsEligible({
  id,
  url: `https://cdn.example/${id}.mp4`,
  pickedIds,
  usedUrls,
  usedClipIds,
  excludedClipIds,
  allowHistoricalReuse,
});

assert.equal(eligible("pexels:fresh", false), true);
assert.equal(eligible("pexels:historical", false), false, "primary casting keeps the cross-video dedup fence");
assert.equal(eligible("pexels:historical", true), true, "coverage fallback may relax only historical dedup");
assert.equal(eligible("pexels:rejected", false), false);
assert.equal(
  eligible("pexels:rejected", true),
  false,
  "coverage fallback must never re-admit a clip from this run's rejected attempt",
);

console.log("footagecraft repair query, gate, and rejected-attempt exclusion contracts passed");
