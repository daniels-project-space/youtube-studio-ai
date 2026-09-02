import assert from "node:assert/strict";

import {
  assertPlanWeekPreparationManifestBinding,
  PLAN_WEEK_PREPARATION_VERSION,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";
import {
  claimPlanItem,
  completeDeferredFramePlanItem,
  finalizePlanBatch,
  recordPlanItemPreparation,
} from "../../../convex/contentPlan";

const ownerId = "owner-preparation";
const channelId = "channels:preparation";
const batchId = "planBatches:preparation";
const itemId = "contentPlan:preparation";
const channelSlug = "frozen-history";
const itemKey = "week-2026-09:0";
const requestKey = "week-2026-09";
const thumbnailKey = `owner/${ownerId}/channel/${channelSlug}/plan/${itemId}.jpg`;

const manifest: PlanWeekPreparationManifest = {
  version: PLAN_WEEK_PREPARATION_VERSION,
  ownerId,
  channelId,
  batchId,
  itemId,
  itemKey,
  requestKey,
  channelSlug,
  frozenAt: Date.now() - 1_000,
  plan: {
    topic: "The lock that changed a kingdom",
    title: "The Lock That Changed a Kingdom",
    description: "A practical history episode about an overlooked mechanism.",
    sceneSeed: "A battered iron lock opens over a crowded medieval market.",
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  },
  execution: {
    pipeline: [{ block: "topic_select" }, { block: "script_gen" }],
    moduleConfig: { script_gen: { maxSeconds: 360 } },
    seedStore: {
      channelName: "Frozen History",
      channelProgramRoute: { routeFingerprint: "a".repeat(64) },
    },
  },
  prompts: {
    script: "Build a causal narration with a satisfying payoff.",
    narration: "Read in the frozen channel voice.",
    shotlist: "Every shot advances the story.",
    visual: "Keep the iron lock readable in the opening frame.",
  },
};

const pointer = {
  version: PLAN_WEEK_PREPARATION_VERSION,
  manifestKey: planWeekPreparationKey(manifest),
  manifestSha256: planWeekPreparationManifestSha256(manifest),
};

assert.equal(pointer.manifestSha256.length, 64);
assert.equal(
  assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer,
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }).prompts.script,
  manifest.prompts.script,
  "an exact content-addressed preparation packet is admissible",
);
assert.throws(
  () => assertPlanWeekPreparationManifestBinding({
    manifest: { ...manifest, plan: { ...manifest.plan, title: "Changed after freezing" } },
    pointer,
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }),
  /binding mismatch/,
  "changing any frozen editorial input invalidates the original digest",
);
assert.throws(
  () => assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer: { ...pointer, manifestKey: "owner/wrong.json" },
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }),
  /binding mismatch/,
  "the manifest is namespaced to its exact owner/channel/batch/item",
);

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

async function main() {
  const batch = {
    _id: batchId,
    ownerId,
    channelId,
    channelSlug,
    requestKey,
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
  };
  const channel = { _id: channelId, ownerId };
  let item: Record<string, unknown> = {
    _id: itemId,
    ownerId,
    channelId,
    batchId,
    itemKey,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    description: manifest.plan.description,
    sceneSeed: manifest.plan.sceneSeed,
    generationState: "pending",
  };
  const context = {
    auth: {
      getUserIdentity: async () => ({
        role: "service",
        subject: "trigger-plan-week",
        owner_id: ownerId,
        issuer: "https://studio.test",
        tokenIdentifier: `test|${ownerId}`,
      }),
    },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === channelId ? channel : id === batchId ? batch : id === itemId ? item : null,
      patch: async (_id: string, patch: Record<string, unknown>) => {
        item = { ...item, ...patch };
      },
    },
  };
  const args = {
    ownerId,
    channelId,
    batchId,
    itemId,
    manifest,
    thumbnailSource: manifest.plan.thumbnailSource,
    ...pointer,
  };
  const first = await invoke<{ state: string; reused: boolean }>(recordPlanItemPreparation, context, args);
  assert.deepEqual(first, { state: "frozen", reused: false });
  assert.equal(item.preparationManifestSha256, pointer.manifestSha256);
  const replay = await invoke<{ state: string; reused: boolean }>(recordPlanItemPreparation, context, args);
  assert.deepEqual(replay, { state: "frozen", reused: true });
  await assert.rejects(
    invoke(recordPlanItemPreparation, context, { ...args, manifestSha256: "b".repeat(64) }),
    /binding mismatch/,
    "a service worker cannot substitute a different digest after the item is frozen",
  );
  await assert.rejects(
    invoke(recordPlanItemPreparation, context, { ...args, thumbnailSource: "rendered_video_frame" }),
    /binding mismatch/,
    "a frozen planner-artwork manifest cannot be relabeled as a rendered-frame plan",
  );

  // Lo-Fi retains a deterministic future key but explicitly blocks generic
  // planner artwork. It becomes schedulable only as a final-render-frame job.
  const lofiBatchId = "planBatches:lofi";
  const lofiItemId = "contentPlan:lofi";
  let lofiBatch: Record<string, unknown> = {
    _id: lofiBatchId,
    ownerId,
    channelId,
    channelSlug,
    requestKey,
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    itemIds: [lofiItemId],
    topicState: "complete",
    topicUsageCheckpointKey: "topics:lofi",
    accountingComplete: true,
    budgetExceeded: false,
    actualCostUsd: 0,
    reservedCostUsd: 1,
    status: "running",
  };
  let lofiItem: Record<string, unknown> = {
    _id: lofiItemId,
    ownerId,
    channelId,
    batchId: lofiBatchId,
    itemKey: "week-2026-09:lofi",
    topic: "A slow rain room for deep focus",
    title: "Slow Rain Room",
    description: "A seamless focus session built from one retained scene.",
    sceneSeed: "A rainy studio window glows at night.",
    generationState: "pending",
  };
  const lofiThumbnailKey = `owner/${ownerId}/channel/${channelSlug}/plan/${lofiItemId}.jpg`;
  const lofiManifest: PlanWeekPreparationManifest = {
    ...manifest,
    batchId: lofiBatchId,
    itemId: lofiItemId,
    itemKey: String(lofiItem.itemKey),
    plan: {
      topic: String(lofiItem.topic),
      title: String(lofiItem.title),
      description: String(lofiItem.description),
      sceneSeed: String(lofiItem.sceneSeed),
      thumbnailKey: lofiThumbnailKey,
      thumbnailSource: "rendered_video_frame",
    },
  };
  const lofiPointer = {
    version: PLAN_WEEK_PREPARATION_VERSION,
    manifestKey: planWeekPreparationKey(lofiManifest),
    manifestSha256: planWeekPreparationManifestSha256(lofiManifest),
  };
  const lofiContext = {
    auth: context.auth,
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === channelId ? channel : id === lofiBatchId ? lofiBatch : id === lofiItemId ? lofiItem : null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === lofiBatchId) lofiBatch = { ...lofiBatch, ...patch };
        else lofiItem = { ...lofiItem, ...patch };
      },
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => table === "contentPlan" ? [lofiItem] : [],
        }),
      }),
    },
  };
  await invoke(recordPlanItemPreparation, lofiContext, {
    ownerId,
    channelId,
    batchId: lofiBatchId,
    itemId: lofiItemId,
    manifest: lofiManifest,
    thumbnailSource: lofiManifest.plan.thumbnailSource,
    ...lofiPointer,
  });
  const blockedGenericClaim = await invoke<{ state: string }>(claimPlanItem, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId, itemId: lofiItemId, claimant: "test-lofi",
  });
  assert.equal(blockedGenericClaim.state, "blocked");
  const deferred = await invoke<{ state: string; reused: boolean }>(completeDeferredFramePlanItem, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId, itemId: lofiItemId, thumbnailKey: lofiThumbnailKey,
  });
  assert.deepEqual(deferred, { state: "ready", reused: false, thumbnailKey: lofiThumbnailKey });
  assert.equal(lofiItem.generationState, "deferred_to_final_render");
  assert.equal(lofiItem.usageCheckpointKey, undefined);
  assert.equal(lofiItem.thumbnailSource, "rendered_video_frame");
  const finalized = await invoke<{ status: string; planned: number; actualCostUsd: number }>(finalizePlanBatch, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId,
  });
  assert.deepEqual(finalized, { status: "ready", planned: 1, actualCostUsd: 0 });
}

main()
  .then(() => console.log("plan-week preparation tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
