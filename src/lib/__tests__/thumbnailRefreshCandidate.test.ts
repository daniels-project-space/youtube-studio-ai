import assert from "node:assert/strict";

import {
  THUMBNAIL_REFRESH_DISPATCH_VERSION,
  THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
  assertThumbnailRefreshCandidateDispatch,
  thumbnailErnieBatchImportApprovalSubject,
  thumbnailRefreshCandidateApprovalSubject,
  thumbnailRefreshDispatchKey,
  thumbnailRefreshTriggerRequest,
} from "@/lib/thumbnailRefreshCandidate";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
} from "@/lib/studioActionApproval";
import { AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX } from "@/lib/studioActionApprovalContract";
import {
  isSameOriginThumbnailRefreshRequest,
  thumbnailRefreshPolicyActor,
} from "@/lib/thumbnailRefreshAccess";

process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "thumbnail-refresh-candidate-test-key";

const identity = {
  ownerId: "owner-thumb",
  channelId: "channel-thumb",
  sourceRunId: "source-thumb-run",
  candidateRunId: "candidate-thumb-run",
  replayFingerprint: "a".repeat(64),
  maximumCostUsd: THUMBNAIL_REFRESH_MAXIMUM_COST_USD,
};
const dispatchKey = thumbnailRefreshDispatchKey(identity);
const subject = thumbnailRefreshCandidateApprovalSubject({ ...identity, dispatchKey });
const approval = issueStudioActionApproval({
  action: "thumbnail-refresh-candidate",
  ownerId: identity.ownerId,
  subject,
  actor: `authenticated-operator:${identity.ownerId}`,
  evidence: "one separate production-QA candidate",
  maxCostUsd: identity.maximumCostUsd,
  now: 1_000,
});
const dispatch = assertThumbnailRefreshCandidateDispatch({
  version: THUMBNAIL_REFRESH_DISPATCH_VERSION,
  ...identity,
  approval,
  approvalFingerprint: studioActionApprovalFingerprint(approval),
  dispatchKey,
  dispatchAttempt: 0,
});

assert.equal(dispatch.dispatchKey, dispatchKey);
assert.equal(thumbnailRefreshTriggerRequest(dispatch).idempotencySeed, dispatchKey);
assert.equal(thumbnailRefreshTriggerRequest(dispatch).payload.candidateRunId, identity.candidateRunId);
assert.equal(verifyStudioActionApproval(approval, {
  action: "thumbnail-refresh-candidate",
  ownerId: identity.ownerId,
  subject,
  maximumCostUsd: identity.maximumCostUsd,
  now: 1_100,
}), true);
const sessionFreeApproval = issueStudioActionApproval({
  action: "thumbnail-refresh-candidate",
  ownerId: identity.ownerId,
  subject,
  actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${identity.ownerId}`,
  evidence: "same-origin Library request for one capped candidate",
  maxCostUsd: identity.maximumCostUsd,
  now: 1_000,
});
assert.equal(verifyStudioActionApproval(sessionFreeApproval, {
  action: "thumbnail-refresh-candidate",
  ownerId: identity.ownerId,
  subject,
  maximumCostUsd: identity.maximumCostUsd,
  now: 1_100,
}), true, "Library candidate refresh can use the scoped thumbnail policy actor");
assert.equal(thumbnailRefreshPolicyActor(identity.ownerId), `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${identity.ownerId}`);
assert.equal(isSameOriginThumbnailRefreshRequest({
  requestUrl: "https://studio.example.test/api/thumbnail-refresh",
  requestOrigin: "https://studio.example.test",
}), true);
assert.equal(isSameOriginThumbnailRefreshRequest({
  requestUrl: "https://studio.example.test/api/thumbnail-refresh",
  requestOrigin: "https://evil.example.test",
}), false, "a session-free candidate request cannot be cross-site");
assert.equal(isSameOriginThumbnailRefreshRequest({
  requestUrl: "https://studio.example.test/api/thumbnail-refresh",
  requestOrigin: null,
}), false, "non-browser requests do not receive anonymous write authority");
assert.throws(
  () => assertThumbnailRefreshCandidateDispatch({ ...dispatch, replayFingerprint: "b".repeat(64) }),
  /dispatch key does not match/,
);
assert.throws(
  () => thumbnailRefreshCandidateApprovalSubject({ ...identity, maximumCostUsd: 0.41, dispatchKey }),
  /cost authority/,
);

const ernieSubject = thumbnailErnieBatchImportApprovalSubject({
  ownerId: identity.ownerId,
  channelId: identity.channelId,
  sourceRunId: identity.sourceRunId,
  candidateRunId: identity.candidateRunId,
  replayFingerprint: identity.replayFingerprint,
  r2Key: "owner/owner-thumb/channel/history/runs/candidate-thumb-run/thumbnail.jpg",
  artifactSha256: "b".repeat(64),
  providerRequestSha256: "c".repeat(64),
  providerResponseSha256: "d".repeat(64),
});
const ernieApproval = issueStudioActionApproval({
  action: "thumbnail-ernie-batch-import",
  ownerId: identity.ownerId,
  subject: ernieSubject,
  actor: `authenticated-operator:${identity.ownerId}`,
  evidence: "owner requested import of this QA-passed native ERNIE thumbnail candidate",
  now: 1_000,
});
assert.equal(verifyStudioActionApproval(ernieApproval, {
  action: "thumbnail-ernie-batch-import",
  ownerId: identity.ownerId,
  subject: ernieSubject,
  now: 1_100,
}), true);

console.log("thumbnail refresh candidate contract: PASS");
