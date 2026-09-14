import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import {
  SALAD_FLEET_MAX_GPU_SLOTS,
  SALAD_FLEET_RESERVATION_LEASE_MS,
  SALAD_FLEET_RESERVATION_VERSION,
} from "../src/lib/saladFleetReservation";

const reservationKey = v.string();
const safeTimestamp = (value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Salad fleet reservation timestamp is invalid");
};

/**
 * Organization-wide logical fence. This is intentionally service-only (the
 * authenticated Convex wrapper rejects owner/viewer calls without ownerId).
 * It closes the check-then-dispatch race before Salad's eventually-consistent
 * market/group APIs can observe a newly created worker.
 */
export const acquire = mutation({
  args: {
    reservationKey,
    // Deliberately not named `ownerId`: the Studio auth wrapper treats that
    // field as an owner-scoping assertion, while this mutation is a
    // service-only organization-wide fence.
    reservationOwnerId: v.string(),
    orderKey: v.string(),
    requestedGpuCount: v.number(),
    priority: v.union(v.literal("medium"), v.literal("high")),
    leaseToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    safeTimestamp(args.now);
    if (!args.reservationOwnerId.trim() || !args.orderKey.trim() || !args.leaseToken.trim() || args.leaseToken.length > 160) {
      throw new Error("Salad fleet reservation identity is invalid");
    }
    if (!Number.isSafeInteger(args.requestedGpuCount) || args.requestedGpuCount < 1 || args.requestedGpuCount > SALAD_FLEET_MAX_GPU_SLOTS) {
      throw new Error(`Salad fleet reservation GPU count must be 1..${SALAD_FLEET_MAX_GPU_SLOTS}`);
    }
    const existing = await ctx.db.query("saladFleetReservations")
      .withIndex("by_reservation_key", (q) => q.eq("reservationKey", args.reservationKey))
      .unique();
    if (existing) {
      if (existing.ownerId !== args.reservationOwnerId || existing.orderKey !== args.orderKey ||
          existing.requestedGpuCount !== args.requestedGpuCount || existing.priority !== args.priority) {
        throw new Error("Salad fleet reservation key was reused with different parameters");
      }
      if (existing.state === "held" && existing.expiresAt > args.now) {
        return { reservationId: existing._id, leaseToken: existing.leaseToken, reused: true, expiresAt: existing.expiresAt };
      }
      if (existing.state === "released") throw new Error("Salad fleet reservation was already released");
      // A bounded worker task cannot outlive this two-hour fence. Reclaiming an
      // expired row is safe and preserves one durable row per idempotency key.
      await ctx.db.patch(existing._id, {
        state: "held",
        leaseToken: args.leaseToken,
        expiresAt: args.now + SALAD_FLEET_RESERVATION_LEASE_MS,
        updatedAt: args.now,
        releasedAt: undefined,
        releaseReason: undefined,
      });
      return { reservationId: existing._id, leaseToken: args.leaseToken, reused: false, expiresAt: args.now + SALAD_FLEET_RESERVATION_LEASE_MS };
    }
    const active = await ctx.db.query("saladFleetReservations")
      .withIndex("by_state_expires", (q) => q.eq("state", "held").gt("expiresAt", args.now))
      .collect();
    const occupied = active.reduce((sum, row) => sum + row.requestedGpuCount, 0);
    if (occupied + args.requestedGpuCount > SALAD_FLEET_MAX_GPU_SLOTS) {
      throw new Error(`Salad fleet reservation capacity is occupied (${occupied}/${SALAD_FLEET_MAX_GPU_SLOTS}); requested ${args.requestedGpuCount} slots`);
    }
    const expiresAt = args.now + SALAD_FLEET_RESERVATION_LEASE_MS;
    const id = await ctx.db.insert("saladFleetReservations", {
      version: SALAD_FLEET_RESERVATION_VERSION,
      reservationKey: args.reservationKey,
      ownerId: args.reservationOwnerId,
      orderKey: args.orderKey,
      requestedGpuCount: args.requestedGpuCount,
      priority: args.priority,
      leaseToken: args.leaseToken,
      state: "held",
      expiresAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { reservationId: id, leaseToken: args.leaseToken, reused: false, expiresAt };
  },
});

/** Release only the exact fence token after receipt durability is proven. */
export const release = mutation({
  args: {
    reservationKey,
    leaseToken: v.string(),
    now: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    safeTimestamp(args.now);
    const row = await ctx.db.query("saladFleetReservations")
      .withIndex("by_reservation_key", (q) => q.eq("reservationKey", args.reservationKey))
      .unique();
    if (!row) throw new Error("Salad fleet reservation not found");
    if (row.state === "released") return { reused: true, releasedAt: row.releasedAt };
    if (row.leaseToken !== args.leaseToken) throw new Error("Salad fleet reservation lease token mismatch");
    const reason = args.reason.trim().slice(0, 160);
    if (!reason) throw new Error("Salad fleet reservation release reason is required");
    await ctx.db.patch(row._id, { state: "released", releasedAt: args.now, releaseReason: reason, updatedAt: args.now });
    return { reused: false, releasedAt: args.now };
  },
});

/** Service-only diagnostic used by the render desk; it never exposes tokens. */
export const listActive = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    safeTimestamp(args.now);
    const rows = await ctx.db.query("saladFleetReservations")
      .withIndex("by_state_expires", (q) => q.eq("state", "held").gt("expiresAt", args.now))
      .collect();
    return {
      observedAt: args.now,
      occupiedGpuSlots: rows.reduce((sum, row) => sum + row.requestedGpuCount, 0),
      reservations: rows.map((row) => ({
        reservationKey: row.reservationKey,
        ownerId: row.ownerId,
        orderKey: row.orderKey,
        requestedGpuCount: row.requestedGpuCount,
        priority: row.priority,
        expiresAt: row.expiresAt,
      })),
    };
  },
});
