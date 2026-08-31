import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS,
  bundleFanoutDispatchSchedule,
  bundleFanoutEnvelope,
} from "@/lib/bundleFanout";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function main(): void {
  const runs = source("convex/runs.ts");
  const schema = source("convex/schema.ts");
  const emitter = source("src/trigger/blocks/bundleBlocks.ts");
  const dispatcher = source("src/trigger/bundleFanoutDispatcher.ts");
  const pipeline = source("src/trigger/runPipeline.ts");

  for (const field of [
    "bundleParentRunId",
    "bundleDispatchEnvelope",
    "bundleDispatchEnvelopeFingerprint",
    "bundleDispatchState",
    "bundleDispatchAttempts",
    "bundleDispatchDeadlineAt",
    "bundleDispatchQueueDeadlineAt",
  ]) {
    assert.match(schema, new RegExp(field), `runs schema must retain durable ${field}`);
  }
  for (const index of [
    "by_channel_bundle_dispatch",
    "by_owner_bundle_dispatch_due",
    "by_owner_bundle_dispatch_lease",
  ]) {
    assert.match(schema, new RegExp(index), `runs schema must index fanout ${index}`);
  }
  for (const authority of [
    "claimBundleFanoutRun",
    "claimBundleFanoutDispatch",
    "markBundleFanoutDispatchEnqueued",
    "deferBundleFanoutDispatch",
    "listDueBundleFanoutDispatches",
  ]) {
    assert.match(runs, new RegExp(authority), `fanout authority must expose ${authority}`);
  }
  assert.match(
    runs,
    /requireStudioServiceIdentity\(ctx, args\.ownerId, "bundle fanout child claim"\)/,
    "untrusted callers cannot mint paid sibling run shells",
  );
  assert.match(
    runs,
    /bundleFanoutDispatchIsTerminal[\s\S]*manual reconciliation is required/,
    "outbox recovery has a hard terminal state instead of polling forever",
  );
  assert.match(
    runs,
    /hasLiveBundleFanoutDispatchLease[\s\S]*bundleDispatchLeaseExpiresAt[\s\S]*> now/,
    "acknowledgement and deferral require the exact still-live dispatch claim",
  );
  assert.match(
    runs,
    /eligibility changed before dispatch[\s\S]*bundleFanoutTerminalPatch/,
    "a lost enqueue is re-authorized against current sibling membership before recovery can spend",
  );
  assert.match(
    runs,
    /boundedBundleFanoutQueueDeadline[\s\S]*bundleDispatchEnqueuedAt[\s\S]*BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS/,
    "only the exact acknowledged fanout deadline can outlive the normal queue lease",
  );
  assert.match(
    runs,
    /leaseExpiresAt: deadline,[\s\S]*bundleDispatchState: "pending"/,
    "an unacknowledged fanout outbox receipt stays bounded by its 30-minute handoff deadline",
  );
  assert.match(
    runs,
    /claimExecutionLease[\s\S]*eligibility changed before execution[\s\S]*bundleFanoutTerminalPatch/,
    "a delayed accepted child revalidates base/sibling membership atomically before provider execution",
  );
  assert.match(
    runs,
    /baseRun\.ownerId[\s\S]*baseChannel\.ownerId[\s\S]*sibling\.ownerId[\s\S]*sibling\.groupId !== groupId/,
    "the execution fence checks durable base run, base channel, and sibling ownership/group binding",
  );
  assert.match(
    runs,
    /assertRunLeaseClaimable[\s\S]*isFanoutReceipt && !reattachingLiveExecution/,
    "a stale peer cannot cancel another live worker while fanout eligibility is rechecked",
  );
  assert.match(
    pipeline,
    /lease\.kind === "fanout_ineligible"[\s\S]*BUNDLE_FANOUT_EXECUTION_INELIGIBLE/,
    "run-pipeline stops deterministically when the execution-claim fence cancels a fanout child",
  );
  assert.match(
    pipeline,
    /terminal bundle fanout receipt has no durable invocation snapshot[\s\S]*BUNDLE_FANOUT_EXECUTION_INELIGIBLE/,
    "a terminal pre-snapshot fanout task aborts deterministically rather than retrying as legacy work",
  );
  assert.match(
    runs,
    /withIndex\("by_channel_bundle_dispatch"[\s\S]*bundleDispatchKey/,
    "the child identity is atomically deduplicated by sibling and base-run key",
  );

  assert.doesNotMatch(
    emitter,
    /api\.runs\.createRun/,
    "emit_bundle must never mint an unconditional duplicate child run",
  );
  assert.doesNotMatch(
    emitter,
    /durableMusicKey = musicKey/,
    "a sibling must never receive a cleanup-prone base-run music key",
  );
  assert.match(
    emitter,
    /claimBundleFanoutRun[\s\S]*claimBundleFanoutDispatch[\s\S]*markBundleFanoutDispatchEnqueued/,
    "the block must claim a durable child before Trigger and record acceptance after it",
  );
  assert.match(
    emitter,
    /deferBundleFanoutDispatch[\s\S]*throw dispatchFailure/,
    "a failed enqueue remains durable and makes the base stage fail rather than reporting success",
  );
  assert.match(
    emitter,
    /idempotencyKeys\.create\(request\.idempotencySeed,\s*\{\s*scope: "global",\s*\}\)/,
    "base-stage delivery must use global durable idempotency",
  );
  assert.match(
    emitter,
    /assertThirdPartyStockEvidenceMatchesFootageKeys[\s\S]*?third-party-stock-evidence[\s\S]*?thirdPartyStockEvidence: durableThirdPartyStockEvidence/,
    "a durable bundle must remap and retain the compact stock-evidence sidecar with its copied footage",
  );

  assert.match(
    dispatcher,
    /schedules\.task\(\{[\s\S]*id: "bundle-fanout-dispatcher"[\s\S]*cron: "\* \* \* \* \*"/,
    "lost enqueue receipts must have a minute dispatcher independent of normal generation",
  );
  assert.match(dispatcher, /api\.runs\.listDueBundleFanoutDispatches/);
  assert.match(dispatcher, /api\.runs\.claimBundleFanoutDispatch/);
  assert.match(dispatcher, /api\.runs\.deferBundleFanoutDispatch/);
  assert.match(
    dispatcher,
    /idempotencyKeys\.create\(request\.idempotencySeed,\s*\{\s*scope: "global",\s*\}\)/,
    "outbox delivery must share the base stage's global key",
  );

  const thirdPartyStockEvidence = {
    version: "third-party-stock-evidence/v1" as const,
    manifestKey: "owner/owner_a/group/group_a/bundle/base_run/third-party-stock-evidence/a.json",
    manifestSha256: "a".repeat(64),
    inputCount: 1,
    stockAssetCount: 1,
  };
  const envelope = bundleFanoutEnvelope({
    ownerId: "owner_a",
    baseRunId: "base_run",
    baseChannelId: "base_channel",
    siblingChannelId: "sibling_channel",
    reuse: { language: "fr", footageKeys: [], thirdPartyStockEvidence },
  });
  const direct = bundleFanoutDispatchSchedule({ runId: "child_run", envelope });
  const recovered = bundleFanoutDispatchSchedule({ runId: "child_run", envelope });
  assert.equal(
    direct.idempotencySeed,
    recovered.idempotencySeed,
    "an accepted-but-lost response reissues the same child task identity",
  );
  assert.deepEqual(
    direct.payload.reuse.thirdPartyStockEvidence,
    thirdPartyStockEvidence,
    "the frozen outbox payload must carry the evidence pointer beside the exact reused footage keys",
  );
  assert.equal(BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS, 5, "the retry cap remains explicit and bounded");

  console.log("bundle fanout dispatcher wiring tests passed");
}

main();
