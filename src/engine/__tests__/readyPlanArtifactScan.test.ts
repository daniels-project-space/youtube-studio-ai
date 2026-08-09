import assert from "node:assert/strict";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA,
  planWeekProviderEvidenceSha256,
  type PlanWeekArtifactReceipt,
  type PlanWeekProviderRenderReceipt,
} from "@/lib/planWeekRenderReceipt";
import { finalizedPlanWeekRenderReceiptFixture } from "@/lib/__tests__/planWeekRenderReceiptFixture";
import {
  assertStarterPlanChildSucceeded,
  readyPlanSnapshot,
  starterPlanDispatchDecision,
} from "@/trigger/designChannelInception";
import type { Id } from "../../../convex/_generated/dataModel";

type ReadyRow = {
  _id: Id<"contentPlan">;
  topic: string;
  thumbnailKey: string;
  generationAttempt: number;
  usageCheckpointKey: string;
  planWeekArtifactReceipt: PlanWeekArtifactReceipt;
  planWeekProviderReceipt: PlanWeekProviderRenderReceipt;
};

function readyRow(index: number): ReadyRow {
  const itemId = `contentPlan:item-${index}` as Id<"contentPlan">;
  const checkpointKey = `thumbnail:${itemId}:1`;
  const thumbnailKey = `owner/owner-test/channel/test/plan/${itemId}.jpg`;
  const receipt = finalizedPlanWeekRenderReceiptFixture({
    ownerId: "owner-test",
    channelId: "channels:test",
    batchId: `planBatches:batch-${index}`,
    itemId,
    attempt: 1,
    requestKey: `request-${index}`,
    checkpointKey,
    destinationKey: thumbnailKey,
  });
  return {
    _id: itemId,
    topic: `Topic ${index}`,
    thumbnailKey,
    generationAttempt: 1,
    usageCheckpointKey: checkpointKey,
    planWeekArtifactReceipt: receipt.artifactReceipt,
    planWeekProviderReceipt: receipt.providerReceipt,
  };
}

function exactHead(row: ReadyRow) {
  const artifact = row.planWeekArtifactReceipt;
  const provider = row.planWeekProviderReceipt;
  return {
    contentLength: artifact.byteLength,
    contentType: "image/jpeg",
    etag: artifact.etag,
    metadata: {
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.checkpointKey]: row.usageCheckpointKey,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerRequestSha256]: provider.requestSha256,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerEvidenceSha256]:
        planWeekProviderEvidenceSha256(provider),
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactSha256]: artifact.sha256,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactCreatedAt]: String(artifact.createdAt),
    },
  };
}

function fakeConvex(rows: ReadyRow[]): StudioConvexHttpClient {
  return {
    query: async (_query: unknown, args: { paginationOpts: { cursor: string | null; numItems: number } }) => {
      const start = args.paginationOpts.cursor ? Number.parseInt(args.paginationOpts.cursor, 10) : 0;
      const end = Math.min(rows.length, start + args.paginationOpts.numItems);
      return {
        page: rows.slice(start, end),
        continueCursor: String(end),
        isDone: end >= rows.length,
      };
    },
  } as unknown as StudioConvexHttpClient;
}

async function main(): Promise<void> {
  const rows = Array.from({ length: 25 }, (_value, index) => readyRow(index));
  const live = rows[24];
  const snapshot = await readyPlanSnapshot(
    fakeConvex(rows),
    "owner-test",
    "channels:test" as Id<"channels">,
    async (key) => key === live.thumbnailKey ? exactHead(live) : null,
  );
  assert.equal(snapshot.databaseProvenCount, 25);
  assert.equal(snapshot.missingCount, 24);
  assert.deepEqual(snapshot.rows.map((row) => row._id), [live._id],
    "24 missing objects must not hide the next live artifact");

  const transient = await readyPlanSnapshot(
    fakeConvex([rows[0]]),
    "owner-test",
    "channels:test" as Id<"channels">,
    async () => { throw new Error("R2 transport unavailable"); },
  );
  assert.equal(transient.transientCount, 1);
  assert.equal(transient.rows.length, 0,
    "unknown HEAD state must never be treated as permission to replace a paid artifact");

  const duplicate = await readyPlanSnapshot(
    fakeConvex([live, live]),
    "owner-test",
    "channels:test" as Id<"channels">,
    async () => exactHead(live),
  );
  assert.equal(duplicate.rows.length, 1, "duplicate artifact identities cannot satisfy readiness");

  assert.deepEqual(starterPlanDispatchDecision({
    targetCount: 5,
    approvedMissingCount: 5,
    acceptedFingerprints: [],
    liveFingerprints: [],
  }), { missingCount: 5 },
  "fresh approval may replace historical artifacts that were already absent from its snapshot");
  assert.deepEqual(starterPlanDispatchDecision({
    targetCount: 5,
    approvedMissingCount: 1,
    acceptedFingerprints: ["a", "b", "c", "d"],
    liveFingerprints: ["a", "b", "c", "d"],
  }), { missingCount: 1 });
  assert.throws(() => starterPlanDispatchDecision({
    targetCount: 5,
    approvedMissingCount: 5,
    acceptedFingerprints: [],
    liveFingerprints: [],
    checkpointPhase: "starter-plan-child-finished",
  }), /artifact_repair_required/,
  "a completed paid child with insufficient output cannot be dispatched again");
  assert.throws(() => starterPlanDispatchDecision({
    targetCount: 5,
    approvedMissingCount: 1,
    acceptedFingerprints: ["accepted-now-missing"],
    liveFingerprints: [],
  }), /artifact_repair_required/,
  "loss of evidence admitted by the current plan requires a fresh approval");
  assert.throws(() => assertStarterPlanChildSucceeded({
    ok: false,
    error: new Error("child render failed"),
  }), /starter plan child failed: child render failed/);
  assert.doesNotThrow(() => assertStarterPlanChildSucceeded({ ok: true }));

  console.log("ready-plan paginated artifact scan tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
