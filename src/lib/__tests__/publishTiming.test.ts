import assert from "node:assert/strict";
import {
  isPublishIntentDispatchDue,
  reconcileLegacyDispatchTiming,
  resolvePublishDispatchAt,
  scheduledPublishWindowElapsed,
  SCHEDULED_UPLOAD_MIN_LEAD_MS,
} from "@/lib/publishTiming";
import {
  evaluatePublishClaim,
  retryAt,
  YOUTUBE_UPLOAD_SCOPES,
  type PublishClaimInput,
} from "@/lib/publishingPolicy";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const PUBLISH_AT = NOW + 24 * 60 * 60_000;

function scheduledClaim(): PublishClaimInput {
  return {
    now: NOW,
    intent: {
      ownerId: "owner-a",
      channelId: "channel-a",
      connectorId: "connector-a",
      connectorVersion: 3,
      status: "scheduled",
      nextAttemptAt: NOW,
      publishAt: PUBLISH_AT,
    },
    connector: {
      connectorId: "connector-a",
      ownerId: "owner-a",
      channelId: "channel-a",
      tokenVersion: 3,
      status: "active",
      grantedScopes: [YOUTUBE_UPLOAD_SCOPES[0]],
    },
    activeDispatches: 0,
    uploadsToday: 0,
  };
}

function futurePublicationDispatchesBeforePublicTime(): void {
  const input = {
    createdAt: NOW,
    dispatchRequestedAt: NOW,
    publishAt: PUBLISH_AT,
    privacyStatus: "private" as const,
  };
  assert.equal(resolvePublishDispatchAt(input), NOW);
  assert.equal(input.publishAt, PUBLISH_AT, "the exact public timestamp is not rewritten");
  assert.deepEqual(evaluatePublishClaim(scheduledClaim()), { ok: true });

  const laterDispatch = NOW + 2 * 60 * 60_000;
  assert.equal(
    resolvePublishDispatchAt({ ...input, dispatchRequestedAt: laterDispatch }),
    laterDispatch,
    "an explicit upload due time stays independent from public publishAt",
  );
}

function elapsedAndInvalidSchedulesFailClosed(): void {
  assert.throws(
    () =>
      resolvePublishDispatchAt({
        createdAt: NOW,
        dispatchRequestedAt: NOW,
        publishAt: NOW - 1,
        privacyStatus: "private",
      }),
    /at least 5 minutes after dispatch/,
  );
  assert.throws(
    () =>
      resolvePublishDispatchAt({
        createdAt: NOW,
        publishAt: PUBLISH_AT,
        privacyStatus: "public",
      }),
    /requires private upload privacy/,
  );
  assert.equal(
    scheduledPublishWindowElapsed({
      now: NOW,
      publishAt: NOW + SCHEDULED_UPLOAD_MIN_LEAD_MS - 1,
    }),
    true,
  );
  const elapsed = scheduledClaim();
  elapsed.intent.publishAt = NOW + SCHEDULED_UPLOAD_MIN_LEAD_MS - 1;
  assert.deepEqual(evaluatePublishClaim(elapsed), {
    ok: false,
    reason: "publish_window_elapsed",
    terminal: true,
  });
}

function retryClockDoesNotChangePublicSchedule(): void {
  const retryDue = retryAt(NOW, 2, 10);
  const beforeRetry = scheduledClaim();
  beforeRetry.now = retryDue - 1;
  beforeRetry.intent.status = "retry_wait";
  beforeRetry.intent.nextAttemptAt = retryDue;
  assert.deepEqual(evaluatePublishClaim(beforeRetry), {
    ok: false,
    reason: "not_due",
    terminal: false,
  });

  const atRetry = scheduledClaim();
  atRetry.now = retryDue;
  atRetry.intent.status = "retry_wait";
  atRetry.intent.nextAttemptAt = retryDue;
  assert.deepEqual(evaluatePublishClaim(atRetry), { ok: true });
  assert.equal(atRetry.intent.publishAt, PUBLISH_AT);

  assert.deepEqual(
    reconcileLegacyDispatchTiming({
      status: "scheduled",
      attempts: 0,
      nextAttemptAt: PUBLISH_AT,
      requestedDispatchAt: NOW,
    }),
    { dispatchAt: NOW, nextAttemptAt: NOW },
    "an idempotent retry repairs a legacy first-attempt cursor",
  );
  assert.equal(
    reconcileLegacyDispatchTiming({
      status: "retry_wait",
      attempts: 1,
      nextAttemptAt: retryDue,
      requestedDispatchAt: NOW,
    }),
    undefined,
    "an idempotent retry cannot bypass persisted retry backoff",
  );
  assert.equal(
    isPublishIntentDispatchDue({ status: "scheduled", nextAttemptAt: NOW }, NOW),
    true,
    "an explicitly approved schedule can enqueue without the disabled polling cron",
  );
  assert.equal(
    isPublishIntentDispatchDue({ status: "retry_wait", nextAttemptAt: retryDue }, NOW),
    false,
  );
  assert.equal(
    isPublishIntentDispatchDue({ status: "awaiting_approval", nextAttemptAt: NOW }, NOW),
    false,
  );
}

futurePublicationDispatchesBeforePublicTime();
elapsedAndInvalidSchedulesFailClosed();
retryClockDoesNotChangePublicSchedule();
console.log("publish timing tests passed");
