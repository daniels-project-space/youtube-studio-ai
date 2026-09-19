import assert from "node:assert/strict";

import {
  NANO_BANANA_CURRENT_REFRESH_PROFILE,
  thumbnailRefreshCandidateFingerprint,
} from "@/lib/thumbnailRefreshGeneration";

const replayFingerprint = "a".repeat(64);

assert.equal(
  thumbnailRefreshCandidateFingerprint({ replayFingerprint }),
  replayFingerprint,
  "historical candidates retain the immutable replay identity used by their existing receipts",
);

const currentNanoFingerprint = thumbnailRefreshCandidateFingerprint({
  replayFingerprint,
  generationProfile: NANO_BANANA_CURRENT_REFRESH_PROFILE,
});
assert.match(currentNanoFingerprint, /^[a-f0-9]{64}$/);
assert.notEqual(currentNanoFingerprint, replayFingerprint);
assert.equal(
  thumbnailRefreshCandidateFingerprint({
    replayFingerprint,
    generationProfile: NANO_BANANA_CURRENT_REFRESH_PROFILE,
  }),
  currentNanoFingerprint,
  "the current Nano successor is deterministic and therefore safely idempotent",
);
assert.throws(
  () => thumbnailRefreshCandidateFingerprint({ replayFingerprint: "not-a-receipt" }),
  /replay fingerprint/,
);

console.log("thumbnail refresh generation profile: PASS");
