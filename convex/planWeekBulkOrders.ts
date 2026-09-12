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
    const children = order.children.map((child) => {
      const triggerRunId = byChannel.get(String(child.channelId))!;
      if (child.triggerRunId && child.triggerRunId !== triggerRunId) {
        throw new Error("plan-week bulk dispatch replay mismatch");
      }
      return {
        ...child,
        // A child can start between tasks.trigger and this receipt mutation.
        // Preserve that terminal/running state while attaching the exact run id.
        status: child.status === "pending" ? "queued" as const : child.status,
        triggerRunId,
      };
    });
    const status = children.some((child) => child.status === "failed")
      ? "failed"
      : children.every((child) => child.status === "succeeded")
        ? "succeeded"
        : children.some((child) => child.status === "running")
          ? "running"
          : "dispatched";
    if (order.status === status && order.children.every((child, index) => {
      const next = children[index];
      return child.status === next.status && child.triggerRunId === next.triggerRunId;
    })) {
      return { orderId: order._id, reused: true, status: order.status };
    }
    await ctx.db.patch(order._id, { status, children, updatedAt: Date.now() });
    return { orderId: order._id, reused: false, status };
  },
});

export const markChildStarted = mutation({
  args: {
    ownerId: v.string(),
    fingerprint: v.string(),
    channelId: v.id("channels"),
    triggerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "plan-week bulk child start");
    const order = await ctx.db.query("planWeekBulkOrders")
      .withIndex("by_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", args.fingerprint))
      .unique();
    if (!order) throw new Error("plan-week bulk order not found");
    const child = order.children.find((entry) => String(entry.channelId) === String(args.channelId));
    if (!child || (child.triggerRunId && child.triggerRunId !== args.triggerRunId)) {
      throw new Error("plan-week bulk child start identity mismatch");
    }
    if (child.status === "succeeded") return { reused: true, status: order.status };
    if (child.status === "running" && child.triggerRunId === args.triggerRunId) {
      return { reused: true, status: order.status };
    }
    if (child.status === "failed" && child.triggerRunId !== args.triggerRunId) {
      throw new Error("plan-week bulk child terminal state cannot be claimed by another run");
    }
    if (child.status !== "pending" && child.status !== "queued" && child.status !== "failed") {
      throw new Error("plan-week bulk child is not startable");
    }
    const now = Date.now();
    const children = order.children.map((entry) => entry.channelId === args.channelId
      ? {
          ...entry,
          status: "running" as const,
          triggerRunId: args.triggerRunId,
          startedAt: now,
          finishedAt: undefined,
          error: undefined,
        }
      : entry);
    await ctx.db.patch(order._id, { status: "running", children, updatedAt: now });
    return { reused: false, status: "running" as const };
  },
});

export const markChildFinished = mutation({
  args: {
    ownerId: v.string(),
    fingerprint: v.string(),
    channelId: v.id("channels"),
    triggerRunId: v.string(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "plan-week bulk child completion");
    const order = await ctx.db.query("planWeekBulkOrders")
      .withIndex("by_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("fingerprint", args.fingerprint))
      .unique();
    if (!order) throw new Error("plan-week bulk order not found");
    const child = order.children.find((entry) => String(entry.channelId) === String(args.channelId));
    if (!child || (child.triggerRunId && child.triggerRunId !== args.triggerRunId)) {
      throw new Error("plan-week bulk child completion identity mismatch");
    }
    if (child.status === args.status) return { reused: true, status: order.status };
    if (child.status === "succeeded" || child.status === "failed") {
      throw new Error("plan-week bulk child terminal state cannot change");
    }
    const error = args.error?.trim().slice(0, 1_000) || undefined;
    if (args.status === "failed" && !error) throw new Error("failed bulk child requires an error");
    const now = Date.now();
    const children = order.children.map((entry) => entry.channelId === args.channelId
      ? {
          ...entry,
          status: args.status,
          triggerRunId: args.triggerRunId,
          finishedAt: now,
          error,
        }
      : entry);
    const status = children.some((entry) => entry.status === "failed")
      ? "failed"
      : children.every((entry) => entry.status === "succeeded")
        ? "succeeded"
        : "running";
    await ctx.db.patch(order._id, { status, children, updatedAt: now });
    return { reused: false, status };
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

/** Rehydrate the one deterministic owner/week order after a page reload. */
export const getByRequestKey = query({
  args: { ownerId: v.string(), requestKey: v.string() },
  handler: async (ctx, args) => {
    const requestKey = args.requestKey.trim();
    if (!requestKey || requestKey.length > 160) return null;
    const row = await ctx.db.query("planWeekBulkOrders")
      .withIndex("by_request", (q) => q.eq("ownerId", args.ownerId).eq("requestKey", requestKey))
      .unique();
    return row ?? null;
  },
});

export const planWeekBulkOrderGuardsForTests = { assertAdmission };
