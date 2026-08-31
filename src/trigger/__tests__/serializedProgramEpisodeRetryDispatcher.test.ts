import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  serializedProgramEpisodeBusyRetryReceipt,
  serializedProgramEpisodeBusyRetrySchedule,
} from "@/lib/serializedProgramEpisode";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function main(): void {
  const dispatcher = source("src/trigger/serializedProgramEpisodeRetryDispatcher.ts");
  const runner = source("src/trigger/runPipeline.ts");
  const runs = source("convex/runs.ts");

  assert.match(
    dispatcher,
    /schedules\.task\(\{[\s\S]*id: "serialized-program-episode-retry-dispatcher"[\s\S]*cron: "\* \* \* \* \*"/,
    "the durable receipt has a minute dispatcher rather than relying on the six-hour generation scheduler",
  );
  assert.match(
    dispatcher,
    /api\.runs\.listDueSerializedProgramEpisodeRetries/,
    "the dispatcher must read only the service-owned durable outbox",
  );
  assert.match(
    dispatcher,
    /invocationSha256: receipt\.invocationSha256/,
    "dispatcher payloads must bind the exact frozen invocation hash",
  );
  assert.match(
    dispatcher,
    /scheduledPlan: receipt\.scheduledPlan/,
    "scheduled serialized runs must retain their exact persisted plan payload",
  );
  assert.match(
    dispatcher,
    /delay: new Date\(request\.retryAt\)/,
    "the outbox must preserve the receipt's not-before fence even when it is already due",
  );
  for (const text of [dispatcher, runner]) {
    assert.match(
      text,
      /idempotencyKeys\.create\(request\.idempotencySeed,\s*\{\s*scope: "global",\s*\}\)/,
      "all retry entry points must share one global durable idempotency key",
    );
  }
  assert.match(
    runner,
    /serializedProgramEpisodeBusyRetryReceipt\(\{[\s\S]*retryAt: durableRun\.serializedProgramEpisodeRetryAt/,
    "a post-lease duplicate must parse receipt state through the retryAt-owned gate",
  );
  const earlyReceiptBranch = runner.slice(
    runner.indexOf("if (serializedEpisodeRetry.kind === \"active\")"),
    runner.indexOf("if (\n      (payload.moduleConfigOverride"),
  );
  assert.match(
    earlyReceiptBranch,
    /code: "SERIALIZED_EPISODE_RETRY_NOT_BEFORE"/,
    "an early global delivery must retry, never complete while the receipt remains live",
  );
  assert.doesNotMatch(
    earlyReceiptBranch,
    /enqueueSerializedProgramEpisodeBusyRetry/,
    "an early delivery cannot consume its own global receipt by re-enqueuing it",
  );
  assert.match(
    runner,
    /SERIALIZED_EPISODE_REQUEUE_DISPATCH_FAILED" \|\|[\s\S]*SERIALIZED_EPISODE_RETRY_NOT_BEFORE/,
    "the outer failure path must preserve a clock-early durable receipt instead of terminally failing the run",
  );
  assert.match(
    runs,
    /eq\("status", "failed"\)[\s\S]*serializedProgramEpisodeRetryAt[\s\S]*leaseRecoveryPending !== true/,
    "a reaped frozen receipt is recovered by the same outbox only with its recovery fence",
  );

  const retryAt = 2_000_000;
  const schedule = serializedProgramEpisodeBusyRetrySchedule({
    payload: { channelId: "channel_a", runId: "run_a" },
    channelId: "channel_a",
    runId: "run_a",
    retryAt,
    attempt: 1,
  });
  assert.equal(
    schedule.idempotencySeed,
    "serialized-program-episode-busy:run_a:attempt:1:at:2000000",
    "the receipt key is deterministic across original, early, and outbox dispatchers",
  );
  assert.deepEqual(
    serializedProgramEpisodeBusyRetryReceipt({ attempt: 1 }),
    { kind: "none" },
    "once a worker claims the receipt and clears retryAt, retained attempts do not requeue or block replay",
  );

  console.log("serialized program episode retry dispatcher tests passed");
}

main();
