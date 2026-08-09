/**
 * One-purpose recovery launcher for the three Quiet Stoic plan items admitted
 * by the failed 2026-08-09 batch. Dry-run by default; it cannot create a fresh
 * topic batch because the original request key is pinned below.
 *
 * Deploy the strict Nano Banana task first, then run with:
 *   npx tsx --env-file=.env.local scripts/retry-quiet-stoic-thumbnails.ts \
 *     --execute --confirm-batch=nx734cs11rx5e4s1p4mydq6x4s8c41rr \
 *     --confirm-version=<version printed by the dry-run>
 */
import { configure, deployments, runs, tasks } from "@trigger.dev/sdk";
import { NANO_BANANA_THUMBNAIL_PROFILE } from "../src/lib/nanoBananaThumbnailContract";
import { PLAN_WEEK_CONTRACT_VERSION } from "../src/lib/planWeekContract";
import {
  PLAN_WEEK_RECOVERY_GUARD_VERSION,
  type PlanWeekRecoveryExpectation,
} from "../src/lib/planWeekRecoveryContract";

const RECOVERY = {
  ownerId: "owner_daniel",
  channelId: "j97ax079vqhn58tkhg2yhdty9x87xaj5",
  count: 3,
  requestKey: "run_06fucltpv9nb6gqsusjpqhmd01",
  batchId: "nx734cs11rx5e4s1p4mydq6x4s8c41rr",
  expectedActualCostUsd: 0.024551,
  itemIds: [
    "m17er600wfavb9c9ygkea2k5dx8c4z50",
    "m174mxmw3jgffnjy8477j4d9q58c4zks",
    "m177874zj82nvat7smaj9va0nh8c5x5g",
  ],
} as const;

async function main(): Promise<void> {
  const secretKey = process.env.TRIGGER_SECRET_KEY_PROD;
  if (!secretKey) throw new Error("TRIGGER_SECRET_KEY_PROD is required");
  configure({ secretKey });
  const [original, deployment] = await Promise.all([
    runs.retrieve(RECOVERY.requestKey),
    deployments.retrieveCurrent(),
  ]);
  const payload = original.payload as Partial<{
    ownerId: string;
    channelId: string;
    count: number;
    requestKey: string;
  }>;
  if (
    original.taskIdentifier !== "plan-week-ahead" ||
    original.status !== "FAILED" ||
    payload.ownerId !== RECOVERY.ownerId ||
    payload.channelId !== RECOVERY.channelId ||
    payload.count !== RECOVERY.count ||
    payload.requestKey !== undefined
  ) {
    throw new Error("original Trigger run no longer matches the audited recovery contract");
  }

  if (deployment.status !== "DEPLOYED" || !deployment.version.trim()) {
    throw new Error("current Trigger deployment is not a usable DEPLOYED version");
  }
  const recovery: PlanWeekRecoveryExpectation = {
    guardVersion: PLAN_WEEK_RECOVERY_GUARD_VERSION,
    batchId: RECOVERY.batchId,
    itemIds: [...RECOVERY.itemIds],
    expectedActualCostUsd: RECOVERY.expectedActualCostUsd,
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    providerRoute: NANO_BANANA_THUMBNAIL_PROFILE.route,
    taskVersion: deployment.version,
  };
  const recoveryPayload = {
    ownerId: RECOVERY.ownerId,
    channelId: RECOVERY.channelId,
    count: RECOVERY.count,
    requestKey: RECOVERY.requestKey,
    recovery,
  };
  const execute = process.argv.includes("--execute");
  const confirmation = process.argv.find((arg) => arg.startsWith("--confirm-batch="))
    ?.slice("--confirm-batch=".length);
  const versionConfirmation = process.argv.find((arg) => arg.startsWith("--confirm-version="))
    ?.slice("--confirm-version=".length);
  if (execute && confirmation !== RECOVERY.batchId) {
    throw new Error(`refusing dispatch: pass --confirm-batch=${RECOVERY.batchId}`);
  }
  if (execute && versionConfirmation !== deployment.version) {
    throw new Error(`refusing dispatch: pass --confirm-version=${deployment.version}`);
  }

  // Always verify the live Convex state through the promoted, service-authenticated
  // zero-provider task. Dry-run therefore proves the deployed code and current
  // batch together without exposing an unauthenticated database query.
  const preflightHandle = await tasks.trigger(
    "plan-week-ahead-recovery-preflight",
    recoveryPayload,
    {
      version: deployment.version,
      maxAttempts: 1,
      tags: [`recovery:${RECOVERY.batchId}`, "recovery-preflight"],
    },
  );
  const preflightRun = await runs.poll(preflightHandle.id, { pollIntervalMs: 1_000 });
  const preflight = preflightRun.output as Partial<{
    ok: boolean;
    guardVersion: string;
    taskVersion: string;
    providerRoute: string;
    batchId: string;
    itemIds: string[];
  }> | undefined;
  if (
    !preflightRun.isSuccess ||
    preflight?.ok !== true ||
    preflight.guardVersion !== recovery.guardVersion ||
    preflight.taskVersion !== deployment.version ||
    preflight.providerRoute !== recovery.providerRoute ||
    preflight.batchId !== RECOVERY.batchId ||
    !Array.isArray(preflight.itemIds) ||
    preflight.itemIds.length !== RECOVERY.itemIds.length ||
    preflight.itemIds.some((id, index) => id !== RECOVERY.itemIds[index])
  ) {
    throw new Error(
      `refusing paid dispatch: pinned recovery preflight failed (${preflightRun.error?.message ?? preflightRun.status})`,
    );
  }

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    task: "plan-week-ahead",
    originalRunVersion: original.version,
    pinnedDeploymentId: deployment.id,
    pinnedDeploymentVersion: deployment.version,
    providerRoute: recovery.providerRoute,
    recoveryGuardVersion: recovery.guardVersion,
    payload: recoveryPayload,
    existingBatchId: RECOVERY.batchId,
    existingItemIds: RECOVERY.itemIds,
    liveStateVerified: true,
    executeCommand:
      `npx tsx --env-file=.env.local scripts/retry-quiet-stoic-thumbnails.ts --execute ` +
      `--confirm-batch=${RECOVERY.batchId} --confirm-version=${deployment.version}`,
  }, null, 2));

  if (!execute) return;

  const handle = await tasks.trigger("plan-week-ahead", recoveryPayload, {
    version: deployment.version,
    idempotencyKey: `plan-week-ahead-recovery:${RECOVERY.batchId}:${deployment.version}`,
    tags: [`recovery:${RECOVERY.batchId}`, "exact-batch-recovery"],
  });
  console.log(`recovery run dispatched: ${handle.id} (pinned version ${deployment.version})`);
  const completed = await runs.poll(handle.id, { pollIntervalMs: 5_000 });
  if (completed.version !== deployment.version) {
    throw new Error(
      `recovery run version ${String(completed.version)} does not match pinned ${deployment.version}`,
    );
  }
  if (!completed.isSuccess) {
    throw new Error(
      `exact recovery run failed (${completed.error?.message ?? completed.status})`,
    );
  }
  console.log(JSON.stringify({
    recoveryRunId: handle.id,
    version: completed.version,
    status: completed.status,
    output: completed.output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
