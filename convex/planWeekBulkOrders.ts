import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";
import { PLAN_WEEK_CONTRACT_VERSION, planWeekContractReservation } from "../src/lib/planWeekContract";

const MAX_CHANNELS = 12;
const MAX_ITEMS = 60;
function requireFiniteUsd(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return Number(value.toFixed(6));
}

function assertAdmission(args: {
  contractVersion: string;
  channelIds: readonly string[];
  count: number;
  totalItems: number;
  reservedCostUsd: number;
}): void {
  if (args.contractVersion !== PLAN_WEEK_CONTRACT_VERSION) {
    throw new Error(`unsupported plan-week bulk contract: ${args.contractVersion}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 12) {
    throw new Error("plan-week bulk count must be an integer from 1 to 12");
  }
  if (args.channelIds.length < 1 || args.channelIds.length > MAX_CHANNELS ||
      new Set(args.channelIds).size !== args.channelIds.length) {
    throw new Error("plan-week bulk channel ids must be unique and bounded");
  }
  if (args.totalItems !== args.channelIds.length * args.count || args.totalItems > MAX_ITEMS) {
    throw new Error("plan-week bulk item count does not match its channel order");
  }
  const expected = Number((planWeekContractReservation(args.count).totalUsd * args.channelIds.length).toFixed(6));
  if (Math.abs(requireFiniteUsd(args.reservedCostUsd, "plan-week bulk reservation") - expected) > 0.000001) {
    throw new Error("plan-week bulk reservation does not match the active contract");
  }
}

/** Durable parent admission for the bounded owner/week fan-out. */
export const admit = mutation({
  args: {
    ownerId: v.string(),
    requestKey: v.string(),
    fingerprint: v.string(),
    contractVersion: v.string(),
    channelIds: v.array(v.id("channels")),
    count: v.number(),
    totalItems: v.number(),
    reservedCostUsd: v.number(),
    triggerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "plan-week bulk admission");
    const requestKey = args.requestKey.trim();
    const fingerprint = args.fingerprint.trim().toLowerCase();
    if (!requestKey || requestKey.length > 160 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error("plan-week bulk admission identity is invalid");
    }
    assertAdmission({ ...args, channelIds: args.channelIds.map(String) });
    const channels = await Promise.all(args.channelIds.map((channelId) => ctx.db.get(channelId)));
    if (channels.some((channel) => !channel || channel.ownerId !== args.ownerId)) {
      throw new Error("plan-week bulk channel ownership mismatch");
    }
    const existing = await ctx.db.query("planWeekBulkOrders")
      .withIndex("by_request", (q) => q.eq("ownerId", args.ownerId).eq("requestKey", requestKey))
      .unique();
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.contractVersion !== args.contractVersion ||
          existing.count !== args.count || existing.totalItems !== args.totalItems ||
          Math.abs(existing.reservedCostUsd - args.reservedCostUsd) > 0.000001 ||
          existing.channelIds.join(",") !== args.channelIds.join(",")) {
        throw new Error("plan-week bulk request key was reused with different parameters");
      }
      return { orderId: existing._id, reused: true, status: existing.status };
    }
    const now = Date.now();
    const children = args.channelIds
      .map((channelId) => String(channelId))
      .sort()
      .map((channelId) => ({
        channelId: args.channelIds.find((id) => String(id) === channelId)!,
        requestKey: `${requestKey}:channel:${channelId}`,
        count: args.count,
        status: "pending" as const,
      }));
    const orderId = await ctx.db.insert("planWeekBulkOrders", {
      ownerId: args.ownerId,
      requestKey,
      fingerprint,
      contractVersion: args.contractVersion,
      channelIds: children.map((child) => child.channelId),
      count: args.count,
      totalItems: args.totalItems,
      reservedCostUsd: requireFiniteUsd(args.reservedCostUsd, "plan-week bulk reservation"),
      triggerRunId: args.triggerRunId,
      status: "admitted",
      children,
      createdAt: now,
      updatedAt: now,
    });
    return { orderId, reused: false, status: "admitted" as const };
  },
});

/** Commit the exact Trigger child handles after all bounded dispatches succeed. */
export const markDispatched = mutation({
  args: {
    ownerId: v.string(),
    orderId: v.id("planWeekBulkOrders"),
    fingerprint: v.string(),
    children: v.array(v.object({
      channelId: v.id("channels"),
      triggerRunId: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "plan-week bulk dispatch receipt");
    const order = await ctx.db.get(args.orderId);
    if (!order || order.ownerId !== args.ownerId || order.fingerprint !== args.fingerprint) {
      throw new Error("plan-week bulk dispatch receipt identity mismatch");
    }
    const byChannel = new Map(args.children.map((child) => [String(child.channelId), child.triggerRunId]));
    if (byChannel.size !== order.children.length || order.children.some((child) => !byChannel.has(String(child.channelId)))) {
      throw new Error("plan-week bulk dispatch receipt is incomplete");
    }
    const children = order.children.map((child) => ({
      ...child,
      status: "queued" as const,
      triggerRunId: byChannel.get(String(child.channelId))!,
    }));
    if (order.status === "dispatched") {
      const same = order.children.every((child, index) => {
        const next = children[index];
        return child.status === next.status && child.triggerRunId === next.triggerRunId;
      });
      if (!same) throw new Error("plan-week bulk dispatch replay mismatch");
      return { orderId: order._id, reused: true, status: order.status };
    }
    await ctx.db.patch(order._id, { status: "dispatched", children, updatedAt: Date.now() });
    return { orderId: order._id, reused: false, status: "dispatched" as const };
  },
});

export const getByFingerprint = query({
  args: { ownerId: v.string(), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("planWeekBulkOrders")
      .withIndex("by_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", args.fingerprint))
      .unique();
    return row ?? null;
  },
});

export const planWeekBulkOrderGuardsForTests = { assertAdmission };
