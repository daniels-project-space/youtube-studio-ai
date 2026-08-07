import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import {
  samePlanWeekProviderRenderReceipt,
  samePlanWeekArtifactReceipt,
  validatePlanWeekArtifactReceipt,
  validatePlanWeekProviderRenderReceipt,
  verifyPlanWeekProviderReceiptCryptography,
  type PlanWeekArtifactReceipt,
  type PlanWeekProviderRenderReceipt,
} from "@/lib/planWeekRenderReceipt";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";

async function requirePlannerService(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<void> {
  const identity = await ctx.auth.getUserIdentity() as { role?: unknown } | null;
  if (identity?.role !== "service") {
    throw new Error("plan-week render receipt writes require a studio service identity");
  }
}

async function assertScope(ctx: {
  db: {
    get: (id: never) => Promise<Record<string, unknown> | null>;
  };
}, args: {
  ownerId: string;
  channelId: unknown;
  batchId: unknown;
  itemId: unknown;
  requestKey: string;
  attempt: number;
  createdAt: number;
}): Promise<string> {
  const [channel, batch, item] = await Promise.all([
    ctx.db.get(args.channelId as never),
    ctx.db.get(args.batchId as never),
    ctx.db.get(args.itemId as never),
  ]);
  if (
    !channel ||
    !batch ||
    !item ||
    channel["ownerId"] !== args.ownerId ||
    batch["ownerId"] !== args.ownerId ||
    batch["channelId"] !== args.channelId ||
    batch["requestKey"] !== args.requestKey ||
    batch["contractVersion"] !== PLAN_WEEK_CONTRACT_VERSION ||
    typeof batch["channelSlug"] !== "string" ||
    item["ownerId"] !== args.ownerId ||
    item["channelId"] !== args.channelId ||
    item["batchId"] !== args.batchId ||
    item["generationAttempt"] !== args.attempt ||
    typeof item["generationProviderStartedAt"] !== "number" ||
    args.createdAt < item["generationProviderStartedAt"] ||
    args.createdAt > Date.now() + 60_000
  ) {
    throw new Error("plan-week render receipt scope mismatch");
  }
  const cleanKeyPart = (value: string) => value.replace(/^\/+|\/+$/g, "");
  return `owner/${cleanKeyPart(args.ownerId)}/channel/${cleanKeyPart(batch["channelSlug"] as string)}` +
    `/plan/${String(args.itemId)}.jpg`;
}

export const getByCheckpoint = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    checkpointKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    return ctx.db
      .query("planWeekRenderReceipts")
      .withIndex("by_checkpoint", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("channelId", args.channelId)
        .eq("checkpointKey", args.checkpointKey))
      .unique();
  },
});

export const recordProviderReceipt = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    requestKey: v.string(),
    checkpointKey: v.string(),
    providerReceipt: v.any(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const receipt = args.providerReceipt as PlanWeekProviderRenderReceipt;
    const expectedDestinationKey = await assertScope(ctx as never, {
      ...args,
      attempt: receipt.attempt,
      createdAt: receipt.createdAt,
    });
    const expected = {
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      batchId: String(args.batchId),
      itemId: String(args.itemId),
      requestKey: args.requestKey,
      checkpointKey: args.checkpointKey,
      destinationKey: expectedDestinationKey,
    };
    if (!validatePlanWeekProviderRenderReceipt(receipt, expected)) {
      throw new Error("invalid or unbound plan-week provider receipt");
    }
    if (!await verifyPlanWeekProviderReceiptCryptography(receipt)) {
      throw new Error("plan-week provider receipt failed canonical cryptographic verification");
    }
    const [checkpointReplay, requestReplay] = await Promise.all([
      ctx.db.query("planWeekRenderReceipts")
        .withIndex("by_checkpoint", (q) => q
          .eq("ownerId", args.ownerId)
          .eq("channelId", args.channelId)
          .eq("checkpointKey", args.checkpointKey))
        .unique(),
      ctx.db.query("planWeekRenderReceipts")
        .withIndex("by_request_hash", (q) => q
          .eq("ownerId", args.ownerId)
          .eq("requestKey", args.requestKey)
          .eq("providerRequestSha256", receipt.requestSha256))
        .unique(),
    ]);
    const replay = checkpointReplay ?? requestReplay;
    if (replay) {
      if (
        replay._id !== checkpointReplay?._id ||
        replay._id !== requestReplay?._id ||
        !samePlanWeekProviderRenderReceipt(replay.providerReceipt, receipt)
      ) {
        throw new Error("plan-week provider receipt idempotency mismatch");
      }
      return { receiptId: replay._id, reused: true };
    }
    const receiptId = await ctx.db.insert("planWeekRenderReceipts", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      batchId: args.batchId,
      itemId: args.itemId,
      attempt: receipt.attempt,
      requestKey: args.requestKey,
      checkpointKey: args.checkpointKey,
      destinationKey: receipt.destinationKey,
      providerRequestSha256: receipt.requestSha256,
      providerReceipt: receipt,
      createdAt: receipt.createdAt,
    });
    return { receiptId, reused: false };
  },
});

export const finalizeArtifactReceipt = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    requestKey: v.string(),
    checkpointKey: v.string(),
    artifactReceipt: v.any(),
  },
  handler: async (ctx, args) => {
    await requirePlannerService(ctx);
    const row = await ctx.db.query("planWeekRenderReceipts")
      .withIndex("by_checkpoint", (q) => q
        .eq("ownerId", args.ownerId)
        .eq("channelId", args.channelId)
        .eq("checkpointKey", args.checkpointKey))
      .unique();
    if (
      !row ||
      row.batchId !== args.batchId ||
      row.itemId !== args.itemId ||
      row.requestKey !== args.requestKey
    ) {
      throw new Error("plan-week provider receipt is missing for artifact finalization");
    }
    const artifact = args.artifactReceipt as PlanWeekArtifactReceipt;
    if (!validatePlanWeekArtifactReceipt(artifact, row.providerReceipt)) {
      throw new Error("invalid or unbound plan-week artifact receipt");
    }
    if (artifact.createdAt > Date.now() + 60_000) {
      throw new Error("plan-week artifact receipt has an invalid future timestamp");
    }
    if (row.artifactReceipt) {
      if (!samePlanWeekArtifactReceipt(row.artifactReceipt, artifact)) {
        throw new Error("plan-week artifact receipt replay mismatch");
      }
      return { receiptId: row._id, reused: true };
    }
    await ctx.db.patch(row._id, {
      artifactReceipt: artifact,
      finalizedAt: artifact.createdAt,
    });
    return { receiptId: row._id, reused: false };
  },
});

export const planWeekRenderReceiptGuardsForTests = {
  requirePlannerService,
};
