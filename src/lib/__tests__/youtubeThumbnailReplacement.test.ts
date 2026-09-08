import assert from "node:assert/strict";

import {
  assertYoutubeThumbnailReplacementDispatch,
  youtubeThumbnailReplacementApprovalSubject,
  youtubeThumbnailReplacementDispatchKey,
  youtubeThumbnailReplacementPlanFingerprint,
  youtubeThumbnailReplacementTriggerRequest,
  YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION,
} from "@/lib/youtubeThumbnailReplacement";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
} from "@/lib/studioActionApproval";
import {
  AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX,
  automaticThumbnailPolicyClaimIsValid,
} from "@/lib/studioActionApprovalContract";

process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "thumbnail-replacement-test-key";

const identity = {
  ownerId: "owner-thumb",
  channelId: "channel-thumb",
  sourceRunId: "source-run",
  candidateRunId: "candidate-run",
  youtubeVideoId: "video_123",
  expectedYoutubeChannelId: "UC_expected",
  connectorId: "connector-thumb",
  connectorVersion: 4,
  candidateThumbnailKey: "owner/channels/test/runs/candidate/thumbnail.jpg",
  candidateArtifactSha256: "a".repeat(64),
};
const planFingerprint = youtubeThumbnailReplacementPlanFingerprint(identity);
const replacementId = "replacement-thumb";
const dispatchKey = youtubeThumbnailReplacementDispatchKey({ replacementId, planFingerprint });
const subject = youtubeThumbnailReplacementApprovalSubject({
  replacementId,
  planFingerprint,
  dispatchKey,
});
const approval = issueStudioActionApproval({
  action: "youtube-thumbnail-replacement",
  ownerId: identity.ownerId,
  subject,
  actor: `authenticated-operator:${identity.ownerId}`,
  evidence: "accepted exact QA-passed thumbnail candidate",
  now: 1_000,
});
const dispatch = assertYoutubeThumbnailReplacementDispatch({
  version: YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION,
  replacementId,
  ...identity,
  planFingerprint,
  approval,
  approvalFingerprint: studioActionApprovalFingerprint(approval),
  dispatchKey,
  dispatchAttempt: 0,
});

const firstRequest = youtubeThumbnailReplacementTriggerRequest(dispatch);
assert.equal(firstRequest.taskId, "youtube-thumbnail-replacement");
assert.equal("youtubeVideoId" in firstRequest.payload, false);
assert.equal(firstRequest.idempotencySeed, `${dispatchKey}:attempt:1`);
assert.equal(
  youtubeThumbnailReplacementTriggerRequest({ ...dispatch, dispatchAttempt: 1 }).idempotencySeed,
  `${dispatchKey}:attempt:2`,
  "a bounded retry must create a new Trigger execution instead of resolving to the failed attempt",
);
assert.equal(verifyStudioActionApproval(approval, {
  action: "youtube-thumbnail-replacement",
  ownerId: identity.ownerId,
  subject,
  now: 1_100,
}), true);
const automaticApproval = issueStudioActionApproval({
  action: "youtube-thumbnail-replacement",
  ownerId: identity.ownerId,
  subject,
  actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${identity.ownerId}`,
  evidence: "production-QA candidate admitted by automatic thumbnail policy",
  now: 1_000,
});
assert.equal(verifyStudioActionApproval(automaticApproval, {
  action: "youtube-thumbnail-replacement",
  ownerId: identity.ownerId,
  subject,
  now: 1_100,
}), true, "the narrow automatic policy can authorize only a bound thumbnail replacement");
assert.throws(
  () => issueStudioActionApproval({
    action: "youtube-video-retire",
    ownerId: identity.ownerId,
    subject: "retire:forbidden",
    actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${identity.ownerId}`,
    evidence: "must never widen into deletion",
    now: 1_000,
  }),
  /actor is not allowed/,
  "the automatic thumbnail actor must never authorize a destructive or unrelated action",
);
const automaticImportApproval = issueStudioActionApproval({
  action: "thumbnail-ernie-batch-import",
  ownerId: identity.ownerId,
  subject: "thumbnail-ernie-batch-import:pinned",
  actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${identity.ownerId}`,
  evidence: "immutable reviewed batch candidate",
  now: 1_000,
  maxCostUsd: 0.4,
});
assert.equal(automaticThumbnailPolicyClaimIsValid(automaticImportApproval, {
  action: "thumbnail-ernie-batch-import",
  ownerId: identity.ownerId,
  subject: "thumbnail-ernie-batch-import:pinned",
  now: 1_100,
  maximumCostUsd: 0.4,
}), true, "a service-only boundary may admit the exact automatic thumbnail policy claim");
assert.equal(automaticThumbnailPolicyClaimIsValid({
  ...automaticImportApproval,
  subject: "thumbnail-ernie-batch-import:other",
}, {
  action: "thumbnail-ernie-batch-import",
  ownerId: identity.ownerId,
  subject: "thumbnail-ernie-batch-import:pinned",
  now: 1_100,
  maximumCostUsd: 0.4,
}), false, "an automatic policy claim cannot be moved to another artifact subject");
assert.throws(
  () => assertYoutubeThumbnailReplacementDispatch({
    ...dispatch,
    candidateArtifactSha256: "b".repeat(64),
  }),
  /plan fingerprint changed/,
);
assert.throws(
  () => assertYoutubeThumbnailReplacementDispatch({
    ...dispatch,
    connectorVersion: 5,
  }),
  /plan fingerprint changed/,
);

console.log("YouTube thumbnail replacement contract: PASS");
