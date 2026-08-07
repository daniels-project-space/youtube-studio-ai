import assert from "node:assert/strict";
import {
  publishPipelineResumeTriggerRequest,
  publishRetryTriggerRequest,
  type DurablePipelineRunForPublishResume,
  type UploadedPublishIntentForPipelineResume,
} from "@/lib/publishRetrySchedule";
import {
  enqueueFailedPipelineResume,
  enqueuePublishIntentRetry,
} from "@/trigger/publishRetry";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";

const NEXT_ATTEMPT_AT = Date.parse("2026-08-06T12:15:00.000Z");
const VIDEO_ARTIFACT_ID = `sha256:${"c".repeat(64)}`;
const INVOCATION_SNAPSHOT: PipelineInvocationSnapshot = {
  version: 1,
  ownerId: "owner-a",
  runId: "run-a",
  channelId: "channel-a",
  source: "channel",
  entries: [{ block: "upload_draft" }],
  seedStore: { channelName: "Frozen" },
  budgetUsd: 1,
  keyPrefix: "owner/owner-a/channel/frozen/",
  remoteBlocks: [],
  defaultRetries: 1,
  compilationFingerprint: "b".repeat(64),
  compilationPolicyId: "production-contract",
  compilationPolicyVersion: "2",
  compilationModules: [{ id: "upload_draft", version: "1.0.0" }],
  compilationCapabilities: ["publish.youtube"],
  reservedMaxCostUsd: 0,
};
const INVOCATION_SHA256 = pipelineInvocationSha256(INVOCATION_SNAPSHOT);

function retryIntent(overrides: Partial<Parameters<typeof publishRetryTriggerRequest>[0]> = {}) {
  return {
    _id: "intent-a",
    channelId: "channel-a",
    status: "retry_wait",
    attempts: 2,
    maxAttempts: 5,
    nextAttemptAt: NEXT_ATTEMPT_AT,
    ...overrides,
  };
}

const first = publishRetryTriggerRequest(retryIntent());
assert.ok(first);
assert.equal(first.taskId, "dispatch-publish-intent");
assert.deepEqual(first.payload, { intentId: "intent-a" });
assert.equal(first.options.delay.getTime(), NEXT_ATTEMPT_AT);
assert.equal(first.options.concurrencyKey, "publish:channel-a");
assert.equal(first.options.idempotencyKeyTTL, "30d");
assert.equal(
  first.options.idempotencyKey,
  "publish-retry:intent-a:attempt:2:at:1786018500000",
);
const firstIdempotencyKey = first.options.idempotencyKey;

const duplicate = publishRetryTriggerRequest(retryIntent());
assert.equal(duplicate?.options.idempotencyKey, first.options.idempotencyKey);
assert.equal(duplicate?.options.delay.getTime(), first.options.delay.getTime());

const nextAttempt = publishRetryTriggerRequest(
  retryIntent({ attempts: 3, nextAttemptAt: NEXT_ATTEMPT_AT + 30 * 60_000 }),
);
assert.ok(nextAttempt);
assert.notEqual(nextAttempt.options.idempotencyKey, first.options.idempotencyKey);

assert.equal(publishRetryTriggerRequest(retryIntent({ status: "uploaded" })), undefined);
assert.equal(
  publishRetryTriggerRequest(retryIntent({ attempts: 5, maxAttempts: 5 })),
  undefined,
);
assert.throws(
  () => publishRetryTriggerRequest(retryIntent({ attempts: 0 })),
  /invalid retryable publish intent timing/,
);
assert.throws(
  () => publishRetryTriggerRequest(retryIntent({ nextAttemptAt: NEXT_ATTEMPT_AT + 0.5 })),
  /invalid retryable publish intent timing/,
);

function uploadedIntent(
  overrides: Partial<UploadedPublishIntentForPipelineResume> = {},
): UploadedPublishIntentForPipelineResume {
  return {
    _id: "intent-a",
    ownerId: "owner-a",
    channelId: "channel-a",
    runId: "run-a",
    status: "uploaded",
    videoArtifactId: VIDEO_ARTIFACT_ID,
    youtubeVideoId: "yt-video-a",
    ...overrides,
  };
}

function failedRun(
  overrides: Partial<DurablePipelineRunForPublishResume> = {},
): DurablePipelineRunForPublishResume {
  return {
    _id: "run-a",
    ownerId: "owner-a",
    channelId: "channel-a",
    status: "failed",
    youtubeVideoId: "yt-video-a",
    pipelineInvocationSnapshot: INVOCATION_SNAPSHOT,
    pipelineInvocationSha256: INVOCATION_SHA256,
    blockedPublishIntentId: "intent-a",
    blockedPublishArtifactId: VIDEO_ARTIFACT_ID,
    publishContinuationState: "pending",
    publishContinuationIntentId: "intent-a",
    publishContinuationArtifactId: VIDEO_ARTIFACT_ID,
    publishContinuationVideoId: "yt-video-a",
    ...overrides,
  };
}

const scheduledResume = publishPipelineResumeTriggerRequest(
  uploadedIntent(),
  failedRun({
    youtubeVideoId: "yt-video-a",
    planItemId: "plan-a",
    plannedTopic: "Exact topic",
    plannedTitle: "Exact title",
    plannedThumbnailKey: "owner/owner-a/plans/thumb-a.jpg",
    plannedPublishAt: NEXT_ATTEMPT_AT,
  }),
);
assert.ok(scheduledResume);
assert.equal(scheduledResume.taskId, "run-pipeline");
assert.deepEqual(scheduledResume.payload, {
  channelId: "channel-a",
  runId: "run-a",
  invocationSha256: INVOCATION_SHA256,
  publishResume: {
    intentId: "intent-a",
    videoArtifactId: VIDEO_ARTIFACT_ID,
    youtubeVideoId: "yt-video-a",
  },
  scheduledPlan: {
    planItemId: "plan-a",
    topic: "Exact topic",
    title: "Exact title",
    thumbnailKey: "owner/owner-a/plans/thumb-a.jpg",
    scheduledAt: NEXT_ATTEMPT_AT,
  },
});
assert.deepEqual(scheduledResume.options, {
  concurrencyKey: "channel-a",
  idempotencyKey:
    `publish-resume:intent-a:run:run-a:snapshot:${INVOCATION_SHA256}:video:yt-video-a`,
  idempotencyKeyTTL: "30d",
});

const cadenceResume = publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun());
assert.ok(cadenceResume);
assert.deepEqual(cadenceResume.payload, {
  channelId: "channel-a",
  runId: "run-a",
  invocationSha256: INVOCATION_SHA256,
  publishResume: {
    intentId: "intent-a",
    videoArtifactId: VIDEO_ARTIFACT_ID,
    youtubeVideoId: "yt-video-a",
  },
});
assert.equal(
  publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun())?.options.idempotencyKey,
  cadenceResume.options.idempotencyKey,
);
const cadenceResumeOptions = cadenceResume.options;
assert.equal(
  publishPipelineResumeTriggerRequest(uploadedIntent({ runId: undefined }), undefined),
  undefined,
);
for (const status of ["queued", "running", "ok", "canceled", "cancelled"]) {
  assert.equal(
    publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun({ status })),
    undefined,
  );
}
assert.throws(
  () => publishPipelineResumeTriggerRequest(uploadedIntent(), undefined),
  /run not found/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun({ _id: "run-b" })),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun({ ownerId: "owner-b" })),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(uploadedIntent(), failedRun({ channelId: "channel-b" })),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ youtubeVideoId: "yt-video-b" }),
  ),
  /YouTube video mismatch/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent({ status: "retry_wait" }),
    failedRun(),
  ),
  /invalid uploaded publish intent pipeline link/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ plannedTopic: "orphaned snapshot" }),
  ),
  /partial scheduled-plan snapshot/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ planItemId: "plan-a", plannedTopic: "topic" }),
  ),
  /scheduled plan title is empty/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ pipelineInvocationSha256: undefined }),
  ),
  /durable invocation snapshot hash/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ pipelineInvocationSnapshot: undefined }),
  ),
  /durable invocation snapshot hash/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ pipelineInvocationSha256: "f".repeat(64) }),
  ),
  /snapshot identity\/hash mismatch/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ blockedPublishIntentId: "intent-b" }),
  ),
  /continuation fence/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent({ videoArtifactId: `sha256:${"d".repeat(64)}` }),
    failedRun(),
  ),
  /continuation fence/,
);
assert.throws(
  () => publishPipelineResumeTriggerRequest(
    uploadedIntent(),
    failedRun({ publishContinuationVideoId: "yt-video-b" }),
  ),
  /continuation fence/,
);

async function enqueueContract(): Promise<void> {
  const triggered: unknown[][] = [];
  const queued = await enqueuePublishIntentRetry(
    retryIntent(),
    async (...args) => {
      triggered.push(args);
      return { id: "run-retry-a" };
    },
  );
  assert.deepEqual(queued, {
    runId: "run-retry-a",
    scheduledFor: NEXT_ATTEMPT_AT,
    idempotencyKey: firstIdempotencyKey,
  });
  assert.equal(triggered.length, 1);
  const [taskId, payload, options] = triggered[0] as [
    string,
    { intentId: string },
    { delay: Date; idempotencyKey: string; idempotencyKeyTTL: string },
  ];
  assert.equal(taskId, "dispatch-publish-intent");
  assert.deepEqual(payload, { intentId: "intent-a" });
  assert.equal(options.delay.getTime(), NEXT_ATTEMPT_AT);
  assert.equal(options.idempotencyKey, firstIdempotencyKey);
  assert.equal(options.idempotencyKeyTTL, "30d");

  const resumeTriggered: unknown[][] = [];
  const resumed = await enqueueFailedPipelineResume(
    uploadedIntent(),
    failedRun(),
    async (...args) => {
      resumeTriggered.push(args);
      return { id: "pipeline-resume-a" };
    },
  );
  assert.deepEqual(resumed, {
    runId: "pipeline-resume-a",
    idempotencyKey: cadenceResumeOptions.idempotencyKey,
  });
  assert.deepEqual(resumeTriggered, [[
    "run-pipeline",
    {
      channelId: "channel-a",
      runId: "run-a",
      invocationSha256: INVOCATION_SHA256,
      publishResume: {
        intentId: "intent-a",
        videoArtifactId: VIDEO_ARTIFACT_ID,
        youtubeVideoId: "yt-video-a",
      },
    },
    cadenceResumeOptions,
  ]]);

  let nonFailedTriggerCalls = 0;
  const skipped = await enqueueFailedPipelineResume(
    uploadedIntent(),
    failedRun({ status: "ok" }),
    async () => {
      nonFailedTriggerCalls++;
      return { id: "must-not-run" };
    },
  );
  assert.equal(skipped, undefined);
  assert.equal(nonFailedTriggerCalls, 0);
}

void enqueueContract().then(() => console.log("publish retry scheduling tests passed"));
