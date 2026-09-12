/**
 * Owner/week fan-out for plan-week-ahead. This task only admits and enqueues
 * already bounded per-channel planners; each child still performs its own
 * route, budget, provider, and artifact gates.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  buildPlanWeekBulkOrder,
  type PlanWeekBulkRequest,
} from "@/lib/planWeekBulk";

export type PlanWeekBulkArgs = PlanWeekBulkRequest;

export const planWeekBulkTask = task({
  id: "plan-week-bulk",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async (payload: PlanWeekBulkArgs, { ctx }) => {
    await bootstrapSecrets(() => undefined);
    const order = buildPlanWeekBulkOrder(payload);
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("plan-week bulk: NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new StudioConvexHttpClient(url);
    const channels = await convex.query(api.channels.listChannels, { ownerId: order.ownerId });
    const known = new Set(channels.map((channel) => String(channel._id)));
    const missing = order.channels
      .map((channel) => channel.channelId)
      .filter((channelId) => !known.has(channelId));
    if (missing.length) {
      throw new Error(`plan-week bulk channel ownership check failed for ${missing.join(", ")}`);
    }

    const admission = await convex.mutation(api.planWeekBulkOrders.admit, {
      ownerId: order.ownerId,
      requestKey: order.requestKey,
      fingerprint: order.fingerprint,
      contractVersion: order.contractVersion,
      channelIds: order.channels.map((channel) => channel.channelId as Id<"channels">),
      count: order.count,
      totalItems: order.totalItems,
      reservedCostUsd: order.reservedCostUsd,
      triggerRunId: ctx.run.id,
    });

    // Dispatches are independent by channel. Stable global idempotency seeds
    // make a lost parent response safe to retry without buying another child.
    const children = await Promise.all(order.channels.map(async (channel) => {
      const idempotencyKey = await idempotencyKeys.create(channel.idempotencySeed, {
        scope: "global",
      });
      const handle = await tasks.trigger("plan-week-ahead", {
        ownerId: order.ownerId,
        channelId: channel.channelId,
        count: channel.count,
        requestKey: channel.requestKey,
        budgetCapUsd: channel.reservation.totalUsd,
      }, {
        concurrencyKey: channel.channelId,
        idempotencyKey,
      });
      return { channelId: channel.channelId, triggerRunId: handle.id };
    }));
    const receipt = await convex.mutation(api.planWeekBulkOrders.markDispatched, {
      ownerId: order.ownerId,
      orderId: admission.orderId,
      fingerprint: order.fingerprint,
      children: children.map((child) => ({
        channelId: child.channelId as Id<"channels">,
        triggerRunId: child.triggerRunId,
      })),
    });
    return {
      ok: true,
      contractVersion: order.contractVersion,
      orderFingerprint: order.fingerprint,
      totalItems: order.totalItems,
      reservedCostUsd: order.reservedCostUsd,
      orderId: String(receipt.orderId),
      orderReused: admission.reused,
      children,
    };
  },
});
