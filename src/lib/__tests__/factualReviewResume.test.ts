import assert from "node:assert/strict";

import {
  FACTUAL_REVIEW_RESUME_SCHEDULE_VERSION,
  factualReviewResumeSchedule,
} from "@/lib/factualReviewResume";

const fp = (character: string) => character.repeat(64);

const payload = {
  channelId: "channels:one",
  runId: "runs:one",
  invocationSha256: fp("a"),
  factualReviewResume: {
    checkpointId: "factualReviewCheckpoints:one",
    checkpointFingerprint: fp("b"),
    approvalFingerprint: fp("c"),
    invocationSha256: fp("a"),
  },
  scheduledPlan: {
    planItemId: "contentPlan:one",
    topic: "GDP comparison",
    title: "The numbers behind GDP",
    thumbnailKey: "owner/owner-one/thumbnail.png",
    preparation: {
      version: "plan-week-preparation/inputs-v1",
      manifestKey: "owner/owner-one/channel/economics/plan-batches/batch-one/items/item-one/preparation/inputs.json",
      manifestSha256: fp("d"),
    },
  },
} as const;

const schedule = factualReviewResumeSchedule(payload);
assert.equal(schedule.concurrencyKey, payload.channelId);
assert.equal(
  schedule.idempotencySeed,
  [
    FACTUAL_REVIEW_RESUME_SCHEDULE_VERSION,
    payload.runId,
    payload.factualReviewResume.checkpointId,
    payload.factualReviewResume.checkpointFingerprint,
    payload.factualReviewResume.approvalFingerprint,
    payload.invocationSha256,
  ].join(":"),
  "outbox identity binds run, immutable checkpoint, approval, and frozen invocation",
);
assert.equal(
  factualReviewResumeSchedule({ ...payload, factualReviewResume: { ...payload.factualReviewResume } }).idempotencySeed,
  schedule.idempotencySeed,
  "repeated doctor scans do not mint a second continuation",
);
const recoveredDelivery = factualReviewResumeSchedule(payload, { deliveryAttempt: 2 });
assert.notEqual(
  recoveredDelivery.idempotencySeed,
  schedule.idempotencySeed,
  "an accepted-but-never-started delivery receives a fresh bounded Trigger key",
);
assert.match(
  recoveredDelivery.idempotencySeed,
  /:delivery:2$/,
  "the delivery ordinal is appended without changing the immutable factual receipt",
);
assert.deepEqual(
  recoveredDelivery.payload,
  payload,
  "queue recovery preserves the exact checkpoint, approval, invocation, and scheduled-plan envelope",
);
assert.notEqual(
  factualReviewResumeSchedule({
    ...payload,
    factualReviewResume: { ...payload.factualReviewResume, approvalFingerprint: fp("d") },
  }).idempotencySeed,
  schedule.idempotencySeed,
  "a different owner decision cannot attach to the prior continuation",
);
assert.throws(
  () => factualReviewResumeSchedule({
    ...payload,
    factualReviewResume: { ...payload.factualReviewResume, invocationSha256: fp("e") },
  }),
  /invocation fingerprints do not match/,
  "a continuation cannot swap the frozen invocation after approval",
);
assert.throws(
  () => factualReviewResumeSchedule({
    ...payload,
    scheduledPlan: {
      ...payload.scheduledPlan,
      preparation: { ...payload.scheduledPlan.preparation, manifestSha256: "not-a-hash" },
    },
  }),
  /manifest digest is invalid/,
  "a factual-review continuation cannot discard validation of the frozen weekly preparation pointer",
);
assert.throws(
  () => factualReviewResumeSchedule({
    ...payload,
    factualReviewResume: { ...payload.factualReviewResume, checkpointFingerprint: "not-a-hash" },
  }),
  /must be sha256/,
  "untrusted/broken outbox rows fail before Trigger dispatch",
);
assert.throws(
  () => factualReviewResumeSchedule(payload, { deliveryAttempt: 0 }),
  /delivery attempt is invalid/,
  "delivery retries are bounded positive ordinals",
);

console.log("factual review resume tests passed");
