import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const runner = source("src/trigger/runPipeline.ts");
const dispatcher = source("src/trigger/reviewedDataStoryInitialDispatcher.ts");
const runs = source("convex/runs.ts");
const admissions = source("convex/reviewedDataStoryRunAdmissions.ts");
const schema = source("convex/schema.ts");

assert.match(
  admissions,
  /admitReviewedDataStoryInitialRun[\s\S]*status: "awaiting_reviewed_evidence_dispatch"[\s\S]*reviewedDataStoryInitialDispatchState: "pending"/,
  "owner selection creates a dedicated durable outbox row, never a generic queued cadence run",
);
assert.match(
  admissions,
  /reviewedDataStoryInitialAdmissionFingerprint[\s\S]*by_owner_channel_reviewed_data_story_admission/,
  "same immutable owner/channel/pack admission is idempotent",
);
assert.match(
  dispatcher,
  /reapExpiredQueued[\s\S]*reviewedDataStoryInitialDispatchSchedule[\s\S]*deliveryAttempt: receipt\.attempt \+ 1/,
  "accepted-but-never-started deliveries reissue only their exact bounded envelope",
);
assert.match(
  dispatcher,
  /idempotencyKeys\.create\(request\.idempotencySeed,[\s\S]*scope: "global"/,
  "outbox dispatches use a global immutable idempotency receipt",
);
assert.match(
  dispatcher,
  /id: "reviewed-data-story-initial-dispatcher"[\s\S]*cron: "\* \* \* \* \*"/,
  "initial reviewed runs do not wait for generic scheduler cadence",
);
assert.doesNotMatch(dispatcher, /bootstrapSecrets|anthropic|browserbase|openai/i,
  "the initial dispatcher has no provider path");
assert.match(
  runs,
  /kind: "reviewed_data_story_initial_awaiting"[\s\S]*exact owner-selected evidence dispatch/,
  "a generic Trigger task cannot cross a missing initial admission receipt",
);
assert.match(
  runner,
  /reviewedDataStoryInitialAdmission[\s\S]*reviewedEvidencePackSelector[\s\S]*reviewed_data_story_initial_awaiting/,
  "runPipeline forwards the exact selector plus sealed initial admission and returns a normal manual wait otherwise",
);
assert.match(
  schema,
  /reviewedDataStoryInitialDispatchState[\s\S]*by_owner_reviewed_data_story_initial_dispatch_deadline/,
  "queue state/deadline are durable and indexed for recovery",
);

console.log("Reviewed data-story initial dispatch wiring tests passed");
