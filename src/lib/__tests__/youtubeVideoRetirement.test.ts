import assert from "node:assert/strict";

import {
  assertYoutubeVideoRetirementDispatch,
  youtubeVideoRetirementApprovalSubject,
  youtubeVideoRetirementDispatchKey,
  youtubeVideoRetirementPlanFingerprint,
  youtubeVideoRetirementTriggerRequest,
} from "@/lib/youtubeVideoRetirement";

const identity = {
  ownerId: "owner_daniel",
  channelId: "channel-quiet-stoic",
  runId: "run-legacy-lofi",
  youtubeVideoId: "rw-La8C8ieI",
  expectedYoutubeChannelId: "UC-quiet-stoic",
  connectorId: "connector-quiet-stoic",
  connectorVersion: 4,
  reason: "channel_identity_mismatch" as const,
};
const planFingerprint = youtubeVideoRetirementPlanFingerprint(identity);
const retirementId = "retirement-quiet-stoic-rw-La8C8ieI";
const dispatchKey = youtubeVideoRetirementDispatchKey({ retirementId, planFingerprint });
const dispatch = {
  version: "youtube-video-retirement/v1" as const,
  retirementId,
  ...identity,
  planFingerprint,
  approval: { signed: true },
  approvalFingerprint: "a".repeat(64),
  dispatchKey,
  dispatchAttempt: 0,
};

assert.deepEqual(assertYoutubeVideoRetirementDispatch(dispatch), dispatch);
assert.equal(
  youtubeVideoRetirementTriggerRequest(dispatch).idempotencySeed,
  dispatchKey,
);
assert.equal(
  youtubeVideoRetirementTriggerRequest(dispatch).concurrencyKey,
  identity.channelId,
);
assert.match(
  youtubeVideoRetirementApprovalSubject({
    retirementId,
    planFingerprint,
    dispatchKey,
  }),
  /^youtube-video-retirement-approval:[a-f0-9]{64}$/,
);

assert.throws(
  () => assertYoutubeVideoRetirementDispatch({
    ...dispatch,
    youtubeVideoId: "different-video",
  }),
  /fingerprint changed/i,
);
assert.throws(
  () => assertYoutubeVideoRetirementDispatch({
    ...dispatch,
    dispatchKey: "youtube-video-retirement:wrong",
  }),
  /dispatch key changed/i,
);

console.log("YouTube video retirement immutable dispatch tests passed");
