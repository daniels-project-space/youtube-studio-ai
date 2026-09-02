import assert from "node:assert/strict";

import {
  assertPlanWeekPreparationManifestBinding,
  PLAN_WEEK_PREPARATION_VERSION,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";
import { recordPlanItemPreparation } from "../../../convex/contentPlan";

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
  const args = { ownerId, channelId, batchId, itemId, manifest, ...pointer };
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
}

main()
  .then(() => console.log("plan-week preparation tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
