import assert from "node:assert/strict";

import {
  REVIEWED_DATA_STORY_INITIAL_DISPATCH_VERSION,
  reviewedDataStoryInitialDispatchSchedule,
} from "@/lib/reviewedDataStoryInitialDispatch";

const fp = (value: string) => value.repeat(64);
const payload = {
  channelId: "channel-data-story-001",
  runId: "run-data-story-001",
  reviewedEvidencePackSelector: {
    packId: "pack-data-story-001",
    contentFingerprint: fp("a"),
  },
  reviewedDataStoryInitialAdmission: {
    admissionFingerprint: fp("b"),
  },
} as const;

const first = reviewedDataStoryInitialDispatchSchedule(payload);
assert.equal(first.concurrencyKey, payload.channelId);
assert.equal(
  first.idempotencySeed,
  [
    REVIEWED_DATA_STORY_INITIAL_DISPATCH_VERSION,
    payload.runId,
    payload.reviewedEvidencePackSelector.packId,
    payload.reviewedEvidencePackSelector.contentFingerprint,
    payload.reviewedDataStoryInitialAdmission.admissionFingerprint,
  ].join(":"),
);
assert.equal(
  reviewedDataStoryInitialDispatchSchedule({ ...payload }).idempotencySeed,
  first.idempotencySeed,
  "a duplicate desk submission cannot create a second first delivery",
);
assert.notEqual(
  reviewedDataStoryInitialDispatchSchedule(payload, { deliveryAttempt: 2 }).idempotencySeed,
  first.idempotencySeed,
  "only a bounded expired queue delivery gets a distinct Trigger identity",
);
assert.throws(
  () => reviewedDataStoryInitialDispatchSchedule({
    ...payload,
    reviewedEvidencePackSelector: { ...payload.reviewedEvidencePackSelector, contentFingerprint: "not-a-hash" },
  }),
  /sha256/i,
);
assert.throws(
  () => reviewedDataStoryInitialDispatchSchedule(payload, { deliveryAttempt: 3 }),
  /delivery attempt/i,
);

console.log("Reviewed data-story initial dispatch tests passed");
