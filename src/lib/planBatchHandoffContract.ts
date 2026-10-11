import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertPlanWeekPreparationPointer,
  planWeekPreparationKey,
  type PlanWeekPreparationPointer,
} from "@/lib/planWeekPreparationContract";
import { sha256Hex } from "@/lib/sha256";

export const PLAN_BATCH_HANDOFF_VERSION = "plan-batch-handoff/v1" as const;

export interface PlanBatchHandoffItem {
  itemId: string;
  itemKey: string;
  preparation: PlanWeekPreparationPointer;
  preparationFrozenAt: number;
}

export interface PlanBatchHandoff {
  version: typeof PLAN_BATCH_HANDOFF_VERSION;
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  requestKey: string;
  items: PlanBatchHandoffItem[];
  sha256: string;
}

type SourceItem = {
  _id: string;
  ownerId: string;
  channelId: string;
  batchId?: string;
  itemKey?: string;
  preparationState?: string;
  preparationVersion?: string;
  preparationManifestKey?: string;
  preparationManifestSha256?: string;
  preparationFrozenAt?: number;
};

/** Pure, exact binding of the ordered batch ledger to frozen item packets. */
export function buildPlanBatchHandoff(args: {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  requestKey: string;
  itemIds: string[];
  items: SourceItem[];
}): PlanBatchHandoff {
  if (!args.itemIds.length || args.itemIds.length > 12 ||
      new Set(args.itemIds).size !== args.itemIds.length ||
      args.items.length !== args.itemIds.length) {
    throw new Error("plan batch handoff item set is invalid");
  }
  const byId = new Map(args.items.map((item) => [String(item._id), item]));
  const items = args.itemIds.map((itemId): PlanBatchHandoffItem => {
    const item = byId.get(itemId);
    if (!item || item.ownerId !== args.ownerId || item.channelId !== args.channelId ||
        item.batchId !== args.batchId || !item.itemKey ||
        item.preparationState !== "inputs_frozen" ||
        !Number.isSafeInteger(item.preparationFrozenAt) ||
        (item.preparationFrozenAt ?? 0) <= 0) {
      throw new Error("plan batch handoff item identity or frozen state is invalid");
    }
    const preparation = assertPlanWeekPreparationPointer({
      version: item.preparationVersion,
      manifestKey: item.preparationManifestKey,
      manifestSha256: item.preparationManifestSha256,
    });
    if (preparation.manifestKey !== planWeekPreparationKey({
      ownerId: args.ownerId,
      channelSlug: args.channelSlug,
      batchId: args.batchId,
      itemId,
    })) {
      throw new Error("plan batch handoff preparation path is invalid");
    }
    return {
      itemId,
      itemKey: item.itemKey,
      preparation,
      preparationFrozenAt: item.preparationFrozenAt!,
    };
  });
  const payload = {
    version: PLAN_BATCH_HANDOFF_VERSION,
    ownerId: args.ownerId,
    channelId: args.channelId,
    channelSlug: args.channelSlug,
    batchId: args.batchId,
    requestKey: args.requestKey,
    items,
  };
  return { ...payload, sha256: sha256Hex(canonicalJson(payload)) };
}

export function assertPlanBatchHandoff(value: PlanBatchHandoff): PlanBatchHandoff {
  const { sha256, ...payload } = value;
  if (value.version !== PLAN_BATCH_HANDOFF_VERSION ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      sha256Hex(canonicalJson(payload)) !== sha256) {
    throw new Error("plan batch handoff digest is invalid");
  }
  buildPlanBatchHandoff({
    ...payload,
    itemIds: value.items.map((item) => item.itemId),
    items: value.items.map((item) => ({
      _id: item.itemId,
      ownerId: value.ownerId,
      channelId: value.channelId,
      batchId: value.batchId,
      itemKey: item.itemKey,
      preparationState: "inputs_frozen",
      preparationVersion: item.preparation.version,
      preparationManifestKey: item.preparation.manifestKey,
      preparationManifestSha256: item.preparation.manifestSha256,
      preparationFrozenAt: item.preparationFrozenAt,
    })),
  });
  return value;
}
