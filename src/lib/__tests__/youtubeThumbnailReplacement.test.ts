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

assert.equal(youtubeThumbnailReplacementTriggerRequest(dispatch).taskId, "youtube-thumbnail-replacement");
assert.equal("youtubeVideoId" in youtubeThumbnailReplacementTriggerRequest(dispatch).payload, false);
assert.equal(verifyStudioActionApproval(approval, {
  action: "youtube-thumbnail-replacement",
  ownerId: identity.ownerId,
  subject,
  now: 1_100,
}), true);
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
