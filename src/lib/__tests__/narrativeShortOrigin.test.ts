import assert from "node:assert/strict";

import {
  assertNarrativeShortOrigin,
  createNarrativeShortOrigin,
} from "@/lib/narrativeShortOrigin";

const digest = (value: string) => value.repeat(64);
const origin = createNarrativeShortOrigin({
  version: "narrative-short-origin/v1",
  parentFinalMasterSha256: digest("a"),
  parentFinalMasterCertificateFingerprint: digest("b"),
  seriesPlanFingerprint: digest("c"),
  episodeGraphFingerprint: digest("d"),
  episodeBindingFingerprint: digest("e"),
  shortsExpansionPlanFingerprint: digest("f"),
  candidateId: "short-candidate-1",
  parentBeatId: "beat-story-question",
  sourceWindow: { t0: 12, t1: 42 },
});
assert.equal(assertNarrativeShortOrigin(origin).fingerprint, origin.fingerprint);
assert.throws(
  () => assertNarrativeShortOrigin({ ...origin, sourceWindow: { t0: 12, t1: 43 } }),
  /fingerprint is invalid/,
);
assert.throws(
  () => createNarrativeShortOrigin({ ...origin, sourceWindow: { t0: 42, t1: 12 } }),
  /source window must be positive/,
);
console.log("NARRATIVE SHORT ORIGIN PASS");
