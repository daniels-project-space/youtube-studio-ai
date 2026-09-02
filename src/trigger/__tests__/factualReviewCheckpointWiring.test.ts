import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const runner = source("src/trigger/runPipeline.ts");
const dispatcher = source("src/trigger/factualReviewContinuationDispatcher.ts");
const checkpoints = source("convex/factualReviewCheckpoints.ts");
const runs = source("convex/runs.ts");
const plan = source("convex/contentPlan.ts");
const catalog = source("src/engine/channelCompositionCatalog.ts");
const ownerDesk = source("src/app/api/factual-review-checkpoints/route.ts");

assert.match(
  catalog,
  /SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION[\s\S]*block: "episode_graph"[\s\S]*afterBlocks: \["story_spine"\][\s\S]*beforeBlock: "stock_footage"/,
  "Phase I must create Episode Graph before the first data-story visual stage",
);
assert.match(
  runner,
  /requiresFactualReviewCheckpoint && !payload\.factualReviewResume[\s\S]*stopAfterBlockId: "episode_graph"/,
  "the initial phase stops before post-graph visual work",
);
const boundary = runner.indexOf('if (result.status === "awaiting_review")');
const selfHeal = runner.indexOf("while (!result.ok && heals < MAX_SELF_HEALS)");
assert.ok(boundary >= 0 && boundary < selfHeal, "an awaiting review exits before self-heal can inspect it");
assert.match(
  runner.slice(boundary, selfHeal),
  /factualReviewCheckpointsApi\.createAwaiting/,
  "the successful boundary writes the durable checkpoint before returning",
);
assert.match(
  runner,
  /getApprovedResumeNarration[\s\S]*rehydrateOutputs\([\s\S]*"narration_tts"[\s\S]*new Set\(\["narrationLocalPath"\]\)/,
  "approved continuation verifies retained narration instead of replaying TTS",
);
assert.match(
  runner,
  /FACTUAL_REVIEW_FROZEN_BLOCK_IDS[\s\S]*payload\.factualReviewResume !== undefined[\s\S]*plan\.rerunBlocks\.some[\s\S]*refusing self-heal/,
  "post-approval self-heal cannot mutate the reviewed script, TTS, Story Spine, or Episode Graph",
);
assert.match(
  runner,
  /factual_review_awaiting[\s\S]*awaitingFactualReview: true/,
  "a stale scheduler task receives a normal waiting result, not a retryable failure",
);
assert.match(
  checkpoints,
  /listPendingResumes[\s\S]*requireStudioServiceIdentity[\s\S]*factual review continuation recovery/,
  "only the service-owned outbox scanner can discover continuation rows",
);
assert.match(
  checkpoints,
  /thumbnailSource: run\.plannedThumbnailSource/,
  "factual-review recovery carries the immutable Lo-Fi rendered-frame requirement",
);
assert.match(
  checkpoints,
  /reapExpiredQueuedResumes[\s\S]*factualReviewResumeQueueDeadlineAt[\s\S]*factualReviewResumeState: "pending"/,
  "an accepted-but-never-started continuation is returned to the bounded factual outbox",
);
assert.doesNotMatch(
  checkpoints, /tasks\.trigger|browserbase|anthropic|openai/i, "checkpoint persistence must not call providers or dispatch itself");
assert.match(
  dispatcher,
  /factualReviewResumeSchedule[\s\S]*idempotencyKeys\.create\(request\.idempotencySeed,[\s\S]*scope: "global"/,
  "the dedicated dispatcher uses one global idempotency receipt for every scan",
);
assert.match(
  dispatcher,
  /reapExpiredQueuedResumes[\s\S]*factualReviewResumeSchedule[\s\S]*deliveryAttempt: receipt\.attempt \+ 1/,
  "the dispatcher reissues only an expired delivery with a new bounded Trigger key",
);
assert.match(
  dispatcher,
  /id: "factual-review-continuation-dispatcher"[\s\S]*cron: "\* \* \* \* \*"/,
  "owner approval reaches a provider-free minute dispatcher rather than a daily diagnostics sweep",
);
assert.doesNotMatch(
  dispatcher, /bootstrapSecrets|anthropic|browserbase|openai/i, "continuation dispatch must not call a provider");
assert.match(
  ownerDesk,
  /source authority or[\s\S]*artifact bindings[\s\S]*function publicDecision[\s\S]*result: publicDecision\(result\)/,
  "the owner desk may return a decision outcome, never the full immutable checkpoint receipt",
);
assert.doesNotMatch(
  ownerDesk,
  /NextResponse\.json\(\{ ok: true, result \}/,
  "approval/rejection must not echo source authority or artifact bindings to the browser",
);
assert.match(
  runs,
  /kind: "factual_review_awaiting"[\s\S]*factual review is awaiting explicit owner approval/,
  "lease admission cannot cross a missing approval receipt",
);
assert.match(
  plan,
  /awaitingFactualReview[\s\S]*state: "busy"[\s\S]*blockedFactualReview[\s\S]*state: "blocked"/,
  "scheduler claim blocks cadence fallback while a factual review is waiting or terminally blocked",
);

console.log("factual review checkpoint wiring tests passed");
