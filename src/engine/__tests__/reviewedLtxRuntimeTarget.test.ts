import assert from "node:assert/strict";

import { generationProfile } from "@/engine/generationProfiles";
import {
  assertReviewedLtxRuntimeSeed,
  assertReviewedLtxRuntimeSeedStillActive,
  reviewedLtxRuntimeSeed,
  REVIEWED_LTX_RUNTIME_SEED_VERSION,
} from "@/engine/reviewedLtxRuntimeTarget";
import { novitaVideoProfileIdentity } from "@/engine/runtimeCapability";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const runtime = {
  gpuSku: "RTX 4090",
  vramGb: 24,
  benchmarkedVideoProfileRevisions: [novitaVideoProfileIdentity(generationProfile("production"))],
} as const;

const active = {
  status: "attested" as const,
  runtime,
  admissionFingerprints: [HASH_A],
};

const seed = reviewedLtxRuntimeSeed(active);
assert(seed, "an attested reviewed benchmark must mint a run-snapshot runtime seed");
assert.equal(seed.version, REVIEWED_LTX_RUNTIME_SEED_VERSION);
assert.deepEqual(assertReviewedLtxRuntimeSeed(seed), seed);

// A later, independently reviewed benchmark is additive: it does not alter a
// frozen run's exact hardware/profile target or invalidate its original proof.
assert.deepEqual(
  assertReviewedLtxRuntimeSeedStillActive({
    seed,
    current: { ...active, admissionFingerprints: [HASH_A, HASH_B] },
  }),
  seed,
);

assert.throws(
  () => assertReviewedLtxRuntimeSeedStillActive({
    seed,
    current: { ...active, admissionFingerprints: [HASH_B] },
  }),
  /revoked or missing benchmark admission/,
  "a revoked admission must block a resume before a video worker can start",
);
assert.throws(
  () => assertReviewedLtxRuntimeSeedStillActive({
    seed,
    current: { ...active, runtime: { ...runtime, gpuSku: "RTX 5090", vramGb: 32 } },
  }),
  /sealed direct-LTX hardware\/profile identity/,
  "standard LTX proof may not silently migrate to a different GPU target",
);
assert.throws(
  () => assertReviewedLtxRuntimeSeed({ ...seed, admissionFingerprints: [HASH_B] }),
  /fingerprint does not match/,
  "a task payload cannot substitute its own benchmark admission set",
);
assert.equal(reviewedLtxRuntimeSeed({ ...active, status: "unattested" }), undefined);

console.log("reviewed LTX runtime target snapshot/revocation tests passed");
